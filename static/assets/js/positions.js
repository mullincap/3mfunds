// positions.js
// ------------------------------------
// BloFin Open Positions Dashboard
// ------------------------------------

const REFRESH_MS = 10_000;
let sortMode = "pnl"; // "pnl" | "pct"

let accountState = {
  totalBalance: 0,
  availableBalance: 0,
  marginUsed: 0
};

let effectiveMargin = null;

/* ================================
   Helpers
================================ */
function fmtUSD(v) {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtUSDreg(v) {
  const sign = v >= 0 ? "+" : "-";
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtPct(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function set(id, value, signedVal = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (signedVal !== null) {
    el.className = signedVal >= 0 ? "text-success" : "text-danger";
  }
}

/* ================================
   Account Summary KPIs
================================ */
async function loadAccountSummary() {
  const res = await fetch("/api/account/summary");
  const s = await res.json();

  // 🔐 Store globally
  accountState.totalBalance = s.total_balance;
  accountState.availableBalance = s.total_available;
  accountState.marginUsed = s.total_margin;

  document.getElementById("kpi-total-balance").textContent =
    fmtUSDreg(s.total_balance);

  document.getElementById("kpi-total-available").textContent =
    fmtUSDreg(s.total_available);

  document.getElementById("kpi-margin-pct").textContent =
    s.margin_pct.toFixed(1) + "%";
}

/* ================================
   Summary KPIs (Positions-only)
================================ */
function updatePositionsSummary(positions) {
  const count = positions.length;

  let totalPnl = 0;
  let totalPct = 0;
  let winners = 0;
  let grossExposure = 0;
  let totalMargin = 0;
  let maxPnl = null;
  let lev = 4;

  positions.forEach(p => {

    const pnl = Number(p.unrealizedPnl || 0);
    const pct = Number(p.unrealizedPnlRatio || 0) * 100;
    const size = Number(p.positions || 0);
    const mark = Number(p.markPrice || 0);
    const margin = Number(p.initialMargin || 0);

    totalPnl += pnl;
    totalPct += pct;
    totalMargin += margin;
    grossExposure += margin * lev;

    if (pnl > 0) winners++;
    if (maxPnl === null || pnl > maxPnl) maxPnl = pnl;
  });

  const avgPct = count ? totalPct / count : 0;
  const winRate = count ? (winners / count) * 100 : 0;
  const pnlEfficiency = totalMargin ? (totalPnl / totalMargin) * 100 : 0;
  const pnlConcentration = totalPnl && maxPnl !== null ? (maxPnl / totalPnl) * 100 : 0;

  // ===============================
  // Effective Margin (including stopped positions)
  // ===============================

  const MAX_POSITIONS = 15;

  // Average margin per active position
  let avgPositionMargin = 0;
  if (positions.length > 0 && totalMargin > 0) {
    avgPositionMargin = totalMargin / positions.length;
  }

  // Number of stopped / inactive slots
  const stoppedCount = Math.max(0, MAX_POSITIONS - positions.length);

  // Synthetic margin assigned to stopped positions
  const stoppedMargin = stoppedCount * avgPositionMargin;

  // Effective margin = live margin + implied stopped margin
  // const effectiveMargin = totalMargin + stoppedMargin;
  effectiveMargin = totalMargin + stoppedMargin;
  window.effectiveMargin = effectiveMargin;


  // 🔥 NEW KPI
  const marginUsed = accountState.marginUsed;
  const pnlMarginPct = marginUsed > 0
    ? (totalPnl / marginUsed) * 100
    : 0;

  /* ==========================
     KPIs
  ========================== */
  const elEff = document.getElementById("kpi-effective-margin");

  if (elEff) {
    elEff.textContent = `$${effectiveMargin.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  
  // Neutral counts / sizes (NO +/-)
  set("sum-count", count);
  set("sum-exposure", `$${grossExposure.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`);
  set("sum-margin", `$${totalMargin.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`);

  document.getElementById("kpi-total-margin").textContent = fmtUSDreg(totalMargin);

  set("sum-winrate", winRate.toFixed(0) + "%");
  set("sum-concentration", pnlConcentration.toFixed(0) + "%");

  // Directional performance (KEEP +/-)
  set("sum-pnl", fmtUSD(totalPnl), totalPnl);
  set("sum-pnl-pct", fmtPct(avgPct));
  set("sum-efficiency", fmtPct(pnlEfficiency));
  set("sum-pnl-margin-pct", fmtPct(pnlMarginPct), pnlMarginPct);

}

/* ================================
   Load + Render Positions
================================ */


async function loadPositions() {
  const tbody = document.getElementById("positions-table-body");

  try {
    const res = await fetch("/api/positions");
    const rows = await res.json();

    if (!rows || !rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="text-center text-muted">
            No open positions
          </td>
        </tr>
      `;
      return;
    }

    // ---------- SORT ----------
    rows.sort((a, b) => {
      if (sortMode === "pct") {
        return (
          Number(b.unrealizedPnlRatio || 0) -
          Number(a.unrealizedPnlRatio || 0)
        );
      }
      return Number(b.unrealizedPnl || 0) - Number(a.unrealizedPnl || 0);
    });

    updatePositionsSummary(rows);

    // ---------- TABLE ----------
    tbody.innerHTML = "";

    const grossExposure = rows.reduce(
      (sum, p) => sum + Number(p.positions || 0) * Number(p.markPrice || 0),
      0
    );

    rows.forEach(p => {
      const pnl = Number(p.unrealizedPnl || 0);
      const pnlPct = Number(p.unrealizedPnlRatio || 0) * 100;
      const exposure = Number(p.margin || 0);

      const pnlClass = pnl >= 0 ? "text-success" : "text-danger";

      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td><strong>${p.instId}</strong></td>
          <td>${p.positionSide.toUpperCase()}</td>
          <td>${Number(p.positions).toLocaleString()}</td>
          <td>$${Number(p.averagePrice).toLocaleString()}</td>
          <td>$${Number(p.markPrice).toLocaleString()}</td>
          <td>${p.leverage}×</td>
          <td>${p.marginMode}</td>
          <td>${fmtUSDreg(p.initialMargin)}</td>
          <td class="${pnlClass}">${fmtUSD(pnl)}</td>
          <td class="${pnlClass}">${fmtPct(pnlPct)}</td>
          <td>${p.liquidationPrice
            ? "$" + Number(p.liquidationPrice).toLocaleString()
            : "—"}</td>
        </tr>
      `);
    });

    // ---------- LAST UPDATED ----------
    const el = document.getElementById("last-updated");
    if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-danger">
          Failed to load positions
        </td>
      </tr>
    `;
  }
}

/* ================================
   Sort Toggles
================================ */
document.getElementById("sort-pnl")?.addEventListener("click", () => {
  sortMode = "pnl";
  loadPositions();
});

document.getElementById("sort-pct")?.addEventListener("click", () => {
  sortMode = "pct";
  loadPositions();
});

/* ================================
   Auto Refresh (Positions + Account)
================================ */
async function refreshAll() {
  await loadAccountSummary();   // 🔐 guarantees marginUsed is ready
  await loadPositions();
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);



// (keep your existing global if you have it elsewhere; harmless if duplicated)
window.sessionEquityChart = window.sessionEquityChart || null;

async function loadSessionEquity() {
    const res = await fetch("/api/positions/equity_session");
    const rows = await res.json();

    if (!rows || !rows.length) return;

    // ===============================
    // Build series (filter bad points)
    // ===============================
    const series = rows
        .map(r => [new Date(r.timestamp_utc).getTime(), Number(r.portfolio_value)])
        .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

    if (series.length < 1) return;

    // ===============================
    // Session bounds (06:00 → 23:55) UTC
    // ===============================
    function getSessionBounds() {
        const now = new Date();

        const start = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            6, 0, 0, 0
        ));

        const end = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            23, 55, 0, 0
        ));

        if (now.getUTCHours() < 6) {
            start.setUTCDate(start.getUTCDate() - 1);
            end.setUTCDate(end.getUTCDate() - 1);
        }

        return { min: start.getTime(), max: end.getTime() };
    }

    const session = getSessionBounds();

    // ===============================
    // Trendline (linear regression on TIME)
    // Returns:
    //  - trendSeries: points from session.min → sessionEndTs (1-min step)
    //  - trendNow:    trend value at last actual timestamp
    //  - trendFinal:  trend value at session end (23:55)
    // ===============================
    function computeTrendExtended(series, sessionStartTs, sessionEndTs) {
        if (!Array.isArray(series) || series.length < 2) {
            return { trendSeries: [], trendNow: null, trendFinal: null };
        }

        const xs = series.map(p => p[0]); // timestamps (ms)
        const ys = series.map(p => p[1]); // values

        const n = xs.length;

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (let i = 0; i < n; i++) {
            const x = xs[i];
            const y = ys[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        const denom = (n * sumXX - sumX * sumX);
        if (!Number.isFinite(denom) || denom === 0) {
            return { trendSeries: [], trendNow: null, trendFinal: null };
        }

        // y = slope*x + intercept
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;

        const lastActualTs = xs[n - 1];
        const trendNow = slope * lastActualTs + intercept;
        const trendFinal = slope * sessionEndTs + intercept;

        const step = 60_000; // 1 minute
        const out = [];

        for (let t = sessionStartTs; t <= sessionEndTs; t += step) {
            out.push([t, slope * t + intercept]);
        }

        return { trendSeries: out, trendNow, trendFinal };
    }

    const trendObj = computeTrendExtended(series, session.min, session.max);
    const trendSeries = trendObj.trendSeries;
    const hasTrend = trendSeries.length >= 2;

    // ===============================
    // KPI COMPUTATION
    // ===============================
    const lastPoint = series[series.length - 1];
    const latestBalance = lastPoint?.[1];

    const latestTrend = hasTrend ? trendObj.trendNow : null;
    const finalTrend  = hasTrend ? trendObj.trendFinal : null;

    let pctDiff = null;
    if (latestBalance != null && latestTrend != null && latestTrend !== 0) {
        pctDiff = ((latestBalance - latestTrend) / latestTrend) * 100;
    }

    const fmt = v => "$" + Math.round(v).toLocaleString();

    const elBal = document.getElementById("kpi-balance");
    const elNow = document.getElementById("kpi-trend-now");
    const elFin = document.getElementById("kpi-trend-final");
    const elPct = document.getElementById("kpi-delta-pct");

    if (elBal) elBal.textContent = (latestBalance != null ? fmt(latestBalance) : "—");
    if (elNow) elNow.textContent = (latestTrend != null ? fmt(latestTrend) : "—");
    if (elFin) elFin.textContent = (finalTrend != null ? fmt(finalTrend) : "—");

    if (elPct) {
        if (pctDiff != null) {
            elPct.textContent = `${pctDiff >= 0 ? "+" : ""}${pctDiff.toFixed(2)}%`;
            elPct.classList.toggle("text-danger", pctDiff >= 0);
            elPct.classList.toggle("text-success", pctDiff < 0);
        } else {
            elPct.textContent = "—";
            elPct.classList.remove("text-success", "text-danger");
        }
    }

    function setCompareColor(el, value, reference) {
        if (!el || value == null || reference == null) return;

        el.classList.remove("text-success", "text-danger");

        if (value > reference) {
            el.classList.add("text-success");
        } else if (value < reference) {
            el.classList.add("text-muted");
        }
    }

    // Trend value (now) vs current balance
    if (elNow && latestTrend != null && latestBalance != null) {
        setCompareColor(elNow, latestTrend, latestBalance);
    }

    // Trend @ close vs current balance
    if (elFin && finalTrend != null && latestBalance != null) {
        setCompareColor(elFin, finalTrend, latestBalance);
    }



    // ===============================
    // Y-axis bounds (smart adaptive)
    // ===============================
    const values = series.map(p => p[1]).filter(v => Number.isFinite(v));

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    const startValue = values[0];

    // Base minimum visual range (±20% from start)
    const baseMin = startValue * 0.95;
    const baseMax = startValue * 1.2;

    // Include trend-at-close if higher
    let effectiveMax = maxVal;
    if (typeof finalTrend === "number" && !isNaN(finalTrend)) {
        effectiveMax = Math.max(effectiveMax, finalTrend);
    }

    // ===============================
    // Trend Velocity
    // ===============================
    let trendVelocity = null;

    if (trendSeries.length >= 2) {
        const t0 = trendSeries[0][0];
        const t1 = trendSeries[trendSeries.length - 1][0];
        const y0 = trendSeries[0][1];
        const y1 = trendSeries[trendSeries.length - 1][1];

        const slopePerMs = (y1 - y0) / (t1 - t0);
        trendVelocity = slopePerMs * 3600000; // per hour
    }

    const elVel = document.getElementById("kpi-trend-velocity");

    if (elVel) {
        elVel.classList.remove("text-success", "text-danger", "text-muted");

        if (trendVelocity == null || Math.abs(trendVelocity) < 1e-6) {
            elVel.textContent = "—";
            elVel.classList.add("text-muted");
        } else {
            const sign = trendVelocity > 0 ? "+" : "−";
            const arrow = trendVelocity > 0 ? "↑" : "↓";
            const value = Math.abs(trendVelocity);

            elVel.textContent =
                `${sign}$${Math.round(value).toLocaleString()}/hr`;

            elVel.classList.add(
                trendVelocity > 0 ? "text-success" : "text-danger"
            );
        }
    }

      // ===============================
      // Trend Confidence
      // ===============================
      function computeR2(series, trendSeries) {
          if (series.length < 2) return null;

          const ys = series.map(p => p[1]);
          const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

          let ssTot = 0;
          let ssRes = 0;

          for (let i = 0; i < series.length; i++) {
              const actual = series[i][1];
              const predicted = trendSeries[i]?.[1];
              if (predicted == null) continue;

              ssTot += Math.pow(actual - meanY, 2);
              ssRes += Math.pow(actual - predicted, 2);
          }

          return ssTot === 0 ? null : 1 - ssRes / ssTot;
      }

      function computeTrendConfidence(series) {
          if (series.length < 5) return null;

          let deltas = [];
          for (let i = 1; i < series.length; i++) {
              deltas.push(series[i][1] - series[i - 1][1]);
          }

          const mean = deltas.reduce((a,b)=>a+b,0)/deltas.length;
          const variance = deltas.reduce((a,b)=>a+(b-mean)**2,0)/deltas.length;
          const std = Math.sqrt(variance);

          if (std === 0) return 1;

          return Math.min(1, Math.abs(mean / std));
      }

      function computeTrendConfidence(series) {
          if (series.length < 5) return null;

          const n = series.length;
          const xs = Array.from({ length: n }, (_, i) => i);
          const ys = series.map(p => p[1]);

          // regression
          let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
          for (let i = 0; i < n; i++) {
              sumX += xs[i];
              sumY += ys[i];
              sumXY += xs[i] * ys[i];
              sumXX += xs[i] * xs[i];
          }

          const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
          const intercept = (sumY - slope * sumX) / n;

          // R² calculation
          let ssRes = 0;
          let ssTot = 0;
          const meanY = sumY / n;

          for (let i = 0; i < n; i++) {
              const yHat = slope * xs[i] + intercept;
              ssRes += Math.pow(ys[i] - yHat, 2);
              ssTot += Math.pow(ys[i] - meanY, 2);
          }

          if (ssTot === 0) return 0;

          const r2 = 1 - ssRes / ssTot;

          // Convert to percentage confidence
          return Math.max(0, Math.min(100, r2 * 100));
      }

      const trendConfidence = computeTrendConfidence(series);

      if (trendConfidence !== null) {
          const el = document.getElementById("kpi-trend-confidence");
          el.textContent = `${trendConfidence.toFixed(1)}%`;

          el.classList.toggle("text-success", trendConfidence > 60);
          el.classList.toggle("text-warning", trendConfidence <= 60 && trendConfidence > 35);
          el.classList.toggle("text-danger", trendConfidence <= 35);
      }
      // ===============================
      // Session Max Drawdown
      // ===============================
      function computeMaxDrawdown(series) {
          let peak = -Infinity;
          let maxDD = 0;

          for (const [, v] of series) {
              peak = Math.max(peak, v);
              const dd = (v - peak) / peak;
              if (dd < maxDD) maxDD = dd;
          }

          return maxDD;
      }

      const maxDD = computeMaxDrawdown(series);
      if (maxDD !== null) {
          document.getElementById("kpi-max-dd").textContent = (maxDD * 100).toFixed(2) + "%";
      }

      // ===============================
      // Accelerometer
      // ===============================
      function computeAcceleration(series) {
          if (!Array.isArray(series) || series.length < 3) return null;

          const deltas = [];

          for (let i = 2; i < series.length; i++) {
              const v1 = series[i - 1][1] - series[i - 2][1];
              const v2 = series[i][1] - series[i - 1][1];
              deltas.push(v2 - v1);
          }

          return deltas.reduce((a, b) => a + b, 0) / deltas.length;
      }

      // ------------------------------
      // APPLY KPI
      // ------------------------------
      const acceleration = computeAcceleration(series);
      const elAccel = document.getElementById("kpi-acceleration");

      if (elAccel) {
          elAccel.classList.remove("text-success", "text-danger", "text-muted");

          if (acceleration == null || Math.abs(acceleration) < 1e-6) {
              elAccel.textContent = "—";
              elAccel.classList.add("text-muted");
          } else {
              const sign = acceleration > 0 ? "↑" : "↓";
              const label = acceleration > 0 ? "Accelerating" : "Decelerating";

              elAccel.textContent = `${sign} ${label}`;

              elAccel.classList.add(
                  acceleration > 0 ? "text-success" : "text-danger"
              );
          }
      }

      // ===============================
      // Session Phases
      // ===============================
      const SESSION_PHASES = [
        { name: "Asia",       start: 0,  end: 8,  color: "rgba(56,189,248,0.06)" },
        { name: "London",     start: 8,  end: 13, color: "rgba(34,197,94,0.06)" },
        { name: "NY Overlap", start: 13, end: 16, color: "rgba(250,204,21,0.07)" },
        { name: "New York",   start: 16, end: 21, color: "rgba(239,68,68,0.06)" }
      ];

      function buildSessionAnnotations(sessionStartUTC) {
          const base = new Date(sessionStartUTC);

          return SESSION_PHASES.map(p => {
              const from = new Date(base);
              from.setUTCHours(p.start, 0, 0, 0);

              const to = new Date(base);
              to.setUTCHours(p.end, 0, 0, 0);

              return {
                  x: from.getTime(),
                  x2: to.getTime(),
                  fillColor: p.color,
                  opacity: 0.15,
                  label: {
                      text: p.name,
                      style: {
                          fontSize: "11px",
                          color: "#aaa"
                      }
                  }
              };
          });
      }

      function getSessionPhaseLabel() {
          const now = new Date();
          const h = now.getUTCHours();

          if (h >= 0 && h < 8) return "Asia";
          if (h >= 8 && h < 13) return "London";
          if (h >= 13 && h < 16) return "London–NY";
          if (h >= 16 && h < 21) return "New York";
          return "Late NY";
      }

      document.getElementById("kpi-session-phase").textContent = getSessionPhaseLabel();



      // ===============================
      // VWAP equity
      // ===============================


      function computeVWAP(series) {
          if (series.length < 2) return null;

          let sum = 0;
          let weight = 0;

          for (let i = 1; i < series.length; i++) {
              const dt = series[i][0] - series[i - 1][0];
              sum += series[i][1] * dt;
              weight += dt;
          }

          return weight > 0 ? sum / weight : null;
      }

      const vwapEquity = computeVWAP(series);
      const vwapSeries = series.map(([t]) => [t, vwapEquity]);

      // VWAP-equity vs current balance
      const elVWAP = document.getElementById("kpi-vwap-equity");
      if (elVWAP) elVWAP.textContent = `${vwapEquity >= 0 ? "" : ""}$${Math.round(vwapEquity).toLocaleString()}`;

      if (elVWAP && vwapEquity != null && latestBalance != null) {
          setCompareColor(elVWAP, vwapEquity, latestBalance);
      }
      // ===============================
      // Deviation Bands
      // ===============================

      function computeStdBands(series, trendSeries) {
          const residuals = [];

          for (let i = 0; i < series.length; i++) {
              if (!trendSeries[i]) continue;
              residuals.push(series[i][1] - trendSeries[i][1]);
          }

          const mean = residuals.reduce((a,b)=>a+b,0) / residuals.length;
          const variance = residuals.reduce((a,b)=>a + Math.pow(b - mean, 2), 0) / residuals.length;
          const std = Math.sqrt(variance);

          const upper = trendSeries.map(([t, y]) => [t, y + std]);
          const lower = trendSeries.map(([t, y]) => [t, y - std]);

          return { upper, lower, std };
      }

      const bands = computeStdBands(series, trendSeries);


      // ===============================
      // Session ROI
      // ===============================
      let sessionRoi = null;

      if (series.length >= 2) {
          const sessionStart = series[0][1];
          if (sessionStart && sessionStart !== 0) {
              sessionRoi = ((latestBalance - sessionStart) / sessionStart) * 100;
          }
      }

      if (sessionRoi != null) {
          const el = document.getElementById("kpi-session-roi");
          el.textContent = `${sessionRoi >= 0 ? "+" : ""}${sessionRoi.toFixed(2)}%`;
          el.classList.toggle("text-success", sessionRoi >= 0);
          el.classList.toggle("text-danger", sessionRoi < 0);
      }

      // ===============================
      // Session Profit ($)
      // ===============================
      let sessionProfit = null;

      if (series.length >= 2) {
          const sessionStart = series[0][1];
          sessionProfit = latestBalance - sessionStart;
      }

      if (sessionProfit != null) {
          const el = document.getElementById("kpi-session-profit");
          const sign = sessionProfit >= 0 ? "+" : "";
          el.textContent = `${sign}$${Math.round(sessionProfit).toLocaleString()}`;

          el.classList.toggle("text-success", sessionProfit >= 0);
          el.classList.toggle("text-danger", sessionProfit < 0);
      }

      // ===============================
      // Session Margin Ratio (effective margin)
      // ===============================

      let sessionMarginRatio = null;

      // effectiveMargin must already be computed earlier
      // (live margin + stopped slot margin)
      if (
          sessionProfit != null &&
          typeof effectiveMargin === "number" &&
          effectiveMargin > 0
      ) {
          sessionMarginRatio = (sessionProfit / effectiveMargin) * 100;
      }

      const elMarginRatio = document.getElementById("kpi-margin-roi");

      if (elMarginRatio) {
          if (sessionMarginRatio == null || !isFinite(sessionMarginRatio)) {
              elMarginRatio.textContent = "—";
              elMarginRatio.classList.remove("text-success", "text-danger");
          } else {
              elMarginRatio.textContent =
                  `${sessionMarginRatio >= 0 ? "+" : ""}${sessionMarginRatio.toFixed(2)}%`;

              elMarginRatio.classList.toggle("text-success", sessionMarginRatio >= 0);
              elMarginRatio.classList.toggle("text-danger", sessionMarginRatio < 0);
          }
      }




    // Expand bounds safely
    const expandedMin = Math.min(baseMin, minVal);
    const expandedMax = Math.max(baseMax, effectiveMax);

    // Add padding
    const range = expandedMax - expandedMin;
    const padAbove = range * 0.10;
    const padBelow = range * 0;

    const yMin = expandedMin - padBelow;
    const yMax = expandedMax + padAbove;

    // ===============================
    // Destroy previous chart
    // ===============================
    if (window.sessionEquityChart) {
        window.sessionEquityChart.destroy();
    }

    // ===============================
    // Create chart
    // ===============================
    window.sessionEquityChart = new ApexCharts(
        document.querySelector("#session-equity-chart"),
        {
            chart: {
                height: 800,
                type: "line",
                toolbar: { show: false },
                animations: { enabled: true }
            },

            series: [
                {
                    name: "Balance",
                    type: "area",
                    data: series
                },
                ...(hasTrend ? [{
                    name: "Trend",
                    type: "line",
                    data: trendSeries
                }] : []),
                {
                  name: "VWAP",
                  type: "line",
                  data: vwapSeries
                },
                {
                  name: "+1σ",
                  type: "line",
                  data: bands.upper
                },
                {
                  name: "-1σ",
                  type: "line",
                  data: bands.lower
                }
            ],

            stroke: {
              curve: "smooth",
              width: [2, 2, 1, 1],
              dashArray: [0, 6, 0, 2, 2]
            },


            colors: hasTrend ? ["#02f59d", "#ffffff", "#02f59d", "rgba(255,255,255,0.25)", "rgba(255,255,255,0.25)"] : ["#02f59d"],

            fill: {
                type: hasTrend ? ["gradient", "solid"] : ["gradient"],
                gradient: {
                    shade: "dark",
                    type: "vertical",
                    shadeIntensity: 0.25,
                    opacityFrom: 0.45,
                    opacityTo: 0.05,
                    stops: [0, 100]
                }
            },

            xaxis: {
                type: "datetime",
                min: session.min,
                max: session.max,
                labels: {
                    style: { colors: "#aaa" },
                    datetimeUTC: true,
                    formatter: (val) => {
                        const d = new Date(val);
                        return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
                    }
                }
            },

            yaxis: {
                min: yMin,
                max: yMax,
                forceNiceScale: false,
                labels: {
                    formatter: v => "$" + Math.round(v).toLocaleString(),
                    style: { colors: "#aaa" }
                }
            },

            tooltip: {
                shared: true,
                x: {
                    formatter: (val) => {
                        const d = new Date(val);
                        return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
                    }
                },
                y: {
                    formatter: v => "$" + v.toLocaleString()
                }
            },

            grid: {
                borderColor: "rgba(255,255,255,0.08)"
            },

            legend: {
                labels: { colors: "#ccc" }
            },
            annotations: {
                xaxis: buildSessionAnnotations(session.min)
            }
        }
    );

    window.sessionEquityChart.render();
}

document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("session-equity-chart");
    if (!el) return;

    loadSessionEquity();

    setInterval(() => {
        if (document.getElementById("session-equity-chart")) {
            loadSessionEquity();
        }
    }, 60_000);
});
