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

  document.getElementById("kpi-total-margin").textContent =
    fmtUSDreg(s.total_margin);

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
  const pnlConcentration =
    totalPnl && maxPnl !== null ? (maxPnl / totalPnl) * 100 : 0;

  // 🔥 NEW KPI
  const marginUsed = accountState.marginUsed;
  const pnlMarginPct = marginUsed > 0
    ? (totalPnl / marginUsed) * 100
    : 0;

  /* ==========================
     KPIs
  ========================== */

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
            elPct.classList.toggle("text-success", pctDiff >= 0);
            elPct.classList.toggle("text-danger", pctDiff < 0);
        } else {
            elPct.textContent = "—";
            elPct.classList.remove("text-success", "text-danger");
        }
    }

    // ===============================
    // Y-axis bounds (baseline ±20% + expand if exceeded)
    // ===============================
    // ===============================
    // Y-axis bounds (smart adaptive)
    // ===============================
    const values = series.map(p => p[1]).filter(v => Number.isFinite(v));

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    const startValue = values[0];

    // Base minimum visual range (±20% from start)
    const baseMin = startValue * 0.9;
    const baseMax = startValue * 1.2;

    // Include trend-at-close if higher
    let effectiveMax = maxVal;
    if (typeof finalTrend === "number" && !isNaN(finalTrend)) {
        effectiveMax = Math.max(effectiveMax, finalTrend);
    }

    // Expand bounds safely
    const expandedMin = Math.min(baseMin, minVal);
    const expandedMax = Math.max(baseMax, effectiveMax);

    // Add padding
    const range = expandedMax - expandedMin;
    const padAbove = range * 0.10;
    const padBelow = range * 0.05;

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
                }] : [])
            ],

            stroke: {
                curve: "smooth",
                width: hasTrend ? [2, 2] : [2],
                dashArray: hasTrend ? [0, 6] : [0]
            },

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

            colors: hasTrend ? ["#02f59d", "#ffffff"] : ["#02f59d"],

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
