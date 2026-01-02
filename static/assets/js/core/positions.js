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
let totalMargin = null;
let avgPositionMargin = null;

// "pnl" | "time"
let pnlRadarOrderMode = "pnl";

let latestPositions = [];


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
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtUSDsigned(v) {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

function fmtUSDshort(v) {
  const sign = v >= 0 ? "+" : "-";
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

function fmtPct(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPctReg(v) {
  return `${v.toFixed(2)}%`;
}

function set(id, value, signedVal = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (signedVal !== null) {
    el.className = signedVal >= 0 ? "text-success" : "text-danger";
  }
}

function destroyChart(ref) {
  if (ref && typeof ref.destroy === "function") ref.destroy();
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
    fmtUSDshort(s.total_balance);

  document.getElementById("kpi-total-available").textContent =
    fmtUSDshort(s.total_available);

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
  totalMargin = 0;
  let maxPnl = null;
  let lev = 4;

  positions.forEach(p => {

    console.log(p);

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
  avgPositionMargin = 0;
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
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`;
  }

  // Neutral counts / sizes (NO +/-)
  set("sum-count", count);
  set("sum-exposure", `$${grossExposure.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`);
  set("sum-margin", `$${totalMargin.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`);

  document.getElementById("kpi-total-margin").textContent = fmtUSDshort(totalMargin);

  set("sum-winrate", winRate.toFixed(0) + "%");
  set("sum-concentration", pnlConcentration.toFixed(0) + "%");

  // Directional performance (KEEP +/-)
  set("sum-pnl", fmtUSDsigned(totalPnl), totalPnl);
  set("avg-margin", fmtUSDshort(avgPositionMargin));
  set("sum-efficiency", fmtPct(pnlEfficiency));
  set("sum-pnl-margin-pct", fmtPct(pnlMarginPct), pnlMarginPct);

}




/* ================================
   Charts
================================ */
function cleanSymbol(sym) {
  return sym.replace(/-?USDT$/i, "");
}

// Chart 1
let allocChart;

function renderAllocChart(rows) {
  destroyChart(allocChart);

  const total = rows.reduce((s, r) => s + Number(r.initialMargin || 0), 0);

  const labels = rows.map(r => cleanSymbol(r.instId));
  const values = rows.map(r =>
    total > 0 ? (Number(r.initialMargin) / total) * 100 : 0
  );

  allocChart = new ApexCharts(
    document.querySelector("#chart-alloc"),
    {
      chart: {
        type: "bar",
        animations: {enabled: false},
        height: 300,
        toolbar: { show: false }
      },

      title: { text: "Margin Allocation (%)", style: { color: "#ccc" } },
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: "70%",
          borderRadius: 2
        }
      },
      dataLabels: {
        enabled: true,
        formatter: v => v.toFixed(1) + "%",
        style: {
          colors: ["#ccc"],
          fontSize: "11px",
          fontWeight: 200
        },
        background: {
          enabled: false
        }
      },

      series: [{ data: values }],
      xaxis: {
        categories: labels,
        labels: {
          formatter: (val) => `${Math.round(val)}%`,
          style: { colors: "#aaa" }
        }
      },
      colors: ["rgba(255,255,255,0.1)"],
      grid: { borderColor: "rgba(255,255,255,0.08)" }
    }
  );

  allocChart.render();
}

// Chart 2 — PnL Contribution
let pnlChart;

function renderPnlChart(rows) {
  destroyChart(pnlChart);

  const labels = rows.map(r => cleanSymbol(r.instId));
  const values = rows.map(r => Number(r.unrealizedPnl || 0));

  // Fixed Window (auto-adjusted)

  // ---- CONFIG ----
  const BASE_PCT = 0.05;   // 5% of account
  const ROUND_TO = 500;

  // accountBalance should already exist in your page
  // example: pulled from API / header KPI
  const baseFromBalance = accountState.totalBalance * BASE_PCT;

  // round UP to nearest 500
  const baseLimit = Math.ceil(baseFromBalance / ROUND_TO) * ROUND_TO;

  // find largest absolute pnl
  const maxAbsPnl = Math.max(...values.map(v => Math.abs(v)));

  // grow range if needed
  let axisLimit = baseLimit;
  if (maxAbsPnl > baseLimit) {
    axisLimit =
      Math.ceil(maxAbsPnl / ROUND_TO) * ROUND_TO;
  }

  // ---- average PnL ----
  const avgPnl =
    values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;

  const avgColor = avgPnl >= 0 ? "#02f59d" : "#ef4444";

  pnlChart = new ApexCharts(
    document.querySelector("#chart-pnl"),
    {
      chart: {
        type: "bar",
        height: 400,
        animations: { enabled: false },
        toolbar: { show: false }
      },
      title: { text: "PnL Contribution ($)", style: { color: "#ccc" } },
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: "70%",
          borderRadius: 0,
        }
      },

      series: [{
        name: "PnL",
        data: values
      }],

      // ✅ dynamic per-bar coloring
      colors: [
        function ({ value }) {
          return value >= 0 ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68,0.5)";
        }
      ],

      dataLabels: {
        enabled: true,
        formatter: v => `${v >= 0 ? "+" : ""}$${Math.round(v)}`,
        style: {
          colors: ["#000000"],
          fontSize: "12px",
          fontWeight: 600
        },
        background: {
          enabled: false
        }
      },

      xaxis: {
        categories: labels,
        labels: {
         formatter: (val) => {
           const sign = val < 0 ? "-" : "";
           return `${sign}$${Math.abs(Math.round(val)).toLocaleString()}`;
         },
         style: { colors: "#aaa" }
       },
        axisBorder: { show: true },
        axisTicks: { show: true },
        min: -axisLimit,
        max: axisLimit,
      },

      yaxis: {
        labels: {
          style: { colors: "#aaa" }
        }
      },

      grid: {
        show: true,
        borderColor: "rgb(26,28,30)", // page background
        strokeDashArray: 0,
        xaxis: {
          lines: {
            show: true
          }
        },
        yaxis: {
          lines: {
            show: false
          }
        },
        padding: {
          left: 0,
          right: 0
        }
      },

      annotations: {
        xaxis: [
          {
            x: avgPnl,
            strokeDashArray: 4,
            borderColor: avgColor,
            label: {
              text: `$${Math.round(avgPnl)}`,
              position: "bottom",
              borderColor: "transparent",
              borderWidth: 0,
              offsetX: 10,
              offsetY:0,
              style: {
                color: "#ccc",
                background: "rgb(26,28,30)",
                fontSize: "11px",
                borderColor: "transparent",
                fontWeight: 200
              },
              offsetY: -5
            }
          },
          {
            x: 0,
            borderColor: "#fff"
          }
        ]
      },

      tooltip: {
        y: {
          formatter: v => `$${Math.round(v).toLocaleString()}`
        }
      }
    }
  );

  pnlChart.render();
}

// Chart 3
// Chart 3 — PnL Concentration
let roiChart;

function renderRoiChart(rows) {
  destroyChart(roiChart);

  const values = rows
    .map(r => Number(r.unrealizedPnlRatio) * 100)
    .filter(v => Number.isFinite(v));

  // bucket into 5% bins
  const bins = {};
  values.forEach(v => {
    const bucket = Math.floor(v / 5) * 5;
    bins[bucket] = (bins[bucket] || 0) + 1;
  });

  const sortedBins = Object.keys(bins)
    .map(Number)
    .sort((a, b) => a - b);

  const labels = sortedBins.map(b => `${b}%`);
  const data = sortedBins.map(b => bins[b]);

  roiChart = new ApexCharts(
    document.querySelector("#chart-roi"),
    {
      chart: {
        type: "bar",
        height: 400,
        animations: { enabled: false },
        toolbar: { show: false }
      },

      title: {
        text: "PnL Concentration",
        style: { color: "#ccc" }
      },

      plotOptions: {
        bar: {
          horizontal: false,
          borderRadius: 3,
          columnWidth: "55%"
        }
      },

      series: [
        {
          name: "Count",
          data
        }
      ],

      // ✅ COLOR PER BAR BASED ON SIGN
      colors: [
        ({ dataPointIndex }) => {
          const binValue = sortedBins[dataPointIndex];
          return binValue >= 0
            ? "rgba(34, 197, 94, 0.5)"   // green
            : "rgba(239, 68, 68, 0.5)"; // red
        }
      ],

      dataLabels: {
        enabled: true,
        formatter: v => `${v}`,
        style: {
          colors: ["#ccc"],
          fontSize: "11px",
          fontWeight: 200
        },
        background: {
          enabled: false
        }
      },

      xaxis: {
        categories: labels,
        labels: {
          style: { colors: "#aaa" }
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },

      yaxis: {
        min: 0,
        forceNiceScale: true,
        labels: {
          formatter: v => `${Math.round(v)}`,
          style: { colors: "#aaa" }
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },

      grid: {
        borderColor: "rgba(255,255,255,0.08)"
      }
    }
  );

  roiChart.render();
}

function cleanSymbol(sym) {
  return sym.replace(/-?USDT$/i, "");
}

function pnlColor(v) {
  return v >= 0 ? "#22c55e" : "#ef4444";
}

let pnlPolarChart;

function renderPnlPolar(rows) {
  if (pnlPolarChart) pnlPolarChart.destroy();

  const labels = rows.map(r => cleanSymbol(r.instId));
  const values = rows.map(r => Math.abs(Number(r.unrealizedPnl || 0)));

  pnlPolarChart = new ApexCharts(
    document.querySelector("#pnl-polar"),
    {
      chart: {
        type: "polarArea",
        height: 400,
        animations: { enabled: false }
      },
      series: values,
      labels,
      theme: { mode: "dark" },
      stroke: { colors: ["#111"] },
      fill: { opacity: 0.9 },
      colors: labels.map(() => "#8b5cf6"), // monochrome purple
      legend: {
        labels: { colors: "#aaa" }
      },
      yaxis: {
        labels: { show: false }
      }
    }
  );

  pnlPolarChart.render();
}

let pnlRadarChart;

function renderPnlRadar(rows) {
  if (pnlRadarChart) pnlRadarChart.destroy();

  // -----------------------------
  // ORDERING LOGIC (CONFIGURED)
  // -----------------------------
  let ordered = [...rows];

  if (pnlRadarOrderMode === "time") {
    // oldest → newest
    ordered.sort((a, b) => Number(a.createTime || 0) - Number(b.createTime || 0));
  } else {
    // default: by absolute pnl DESC
    ordered.sort(
      (a, b) =>
        Math.abs(Number(b.unrealizedPnl || 0)) -
        Math.abs(Number(a.unrealizedPnl || 0))
    );
  }

  const labels = ordered.map(r => cleanSymbol(r.instId));
  const values = ordered.map(r => Math.abs(Number(r.unrealizedPnl || 0)));

  pnlRadarChart = new ApexCharts(
    document.querySelector("#pnl-radar"),
    {
      chart: {
        type: "radar",
        height: 300,
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: false }
      },

      series: [
        {
          name: "PnL",
          data: values
        }
      ],

      labels,

      title: {
        text:
          pnlRadarOrderMode === "time"
            ? "ROI Distribution (by Rank)"
            : "ROI Distribution (by $)",
        style: { color: "#ccc" }
      },

      theme: { mode: "dark" },

      stroke: {
        width: 2,
        colors: ["#8b5cf6"]
      },

      fill: {
        opacity: 0.25
      },

      markers: {
        size: 4,
        colors: ["#8b5cf6"]
      },

      xaxis: {
        labels: {
          style: { colors: "#aaa" }
        },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },

      yaxis: {
        show: false
      }
    }
  );

  pnlRadarChart.render();
}

let pnlRadialChart;

function renderPnlRadial(rows) {
  if (pnlRadialChart) pnlRadialChart.destroy();

  const labels = rows.map(r => cleanSymbol(r.instId));
  const values = rows.map(r => Math.abs(Number(r.unrealizedPnl || 0)));

  pnlRadialChart = new ApexCharts(
    document.querySelector("#pnl-radial"),
    {
      chart: {
        type: "radialBar",
        height: 400,
        animations: { enabled: false }
      },
      series: values,
      labels,
      plotOptions: {
        radialBar: {
          hollow: { size: "30%" },
          track: {
            background: "#1f2933"
          },
          dataLabels: {
            name: { show: false },
            value: {
              show: false
            },
            total: {
              show: true,
              label: "Total",
              formatter: () =>
                values.reduce((a, b) => a + b, 0).toFixed(0)
            }
          }
        }
      },
      colors: [
        "#8b5cf6",
        "#60a5fa",
        "#22c55e",
        "#eab308",
        "#f97316",
        "#ef4444",
        "#14b8a6",
        "#a78bfa"
      ],
      stroke: { lineCap: "round" },
      legend: {
        show: false
      }
    }
  );

  pnlRadialChart.render();
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

    latestPositions = rows;

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
    window.latestPositions = rows;

    renderAllocChart(rows);
    renderPnlChart(rows);
    renderRoiChart(rows);
    renderPnlRadar(rows);


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

      // --- derived values ---
      const allocPct = totalMargin > 0 ? (p.initialMargin / totalMargin) * 100 : 0;

      // normalize bars
      const allocWidth = Math.min(allocPct, 100);

      // ROI intensity (caps at 40%)
      const roiIntensity = Math.min(Math.abs(pnlPct) / 40, 1);

      // PnL bar width relative to largest absolute PnL
      const maxAbsPnl = Math.max(...rows.map(r => Math.abs(Number(r.unrealizedPnl || 0))), 1);
      const pnlWidth = Math.min(Math.abs(pnl) / maxAbsPnl * 100, 100);

      tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${p.instId}</strong></td>

        <td>${p.leverage}×</td>

        <td>$${Number(p.averagePrice).toFixed(5)}</td>

        <td>${fmtUSDreg(p.initialMargin)}</td>

        <td class="${pnlClass}">${fmtPct(pnlPct)}</td>

        <td class="pnl-cell">
          <div class="pnl-bar ${pnl >= 0 ? "pos" : "neg"}" style="width:${pnlWidth}%"></div>
          <span class="pnl-text ${pnlClass}">
            ${fmtUSDsigned(pnl)}
          </span>
        </td>

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
                          color: "#aaa",
                          background: "rgb(26,28,30)"
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


    // ===============================
    // Y-axis bounds (smart adaptive)
    // ===============================
    const values = series.map(p => p[1]).filter(v => Number.isFinite(v));

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    const startValue = values[0];

    // Base minimum visual range (±20% from start)
    const baseMin = startValue * 0.95;
    const baseMax = startValue * 1.20;

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
    const padAbove = range * 0.05;
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
                animations: { enabled: false }
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
              width: [2, 2, 1, 2, 2],
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

  function refreshSafely() {
    const scrollY = window.scrollY;

    loadSessionEquity().finally(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: "auto" });
      });
    });
  }

  refreshSafely();

  setInterval(refreshSafely, 60_000);
});

document.addEventListener("DOMContentLoaded", () => {

  const tableBody = document.getElementById("positions-table-body");

  // Delegate click (works even when rows are re-rendered)
  tableBody.addEventListener("click", function (e) {
    const row = e.target.closest("tr");
    if (!row) return;

    const symbolCell = row.querySelector("td");
    if (!symbolCell) return;

    let symbol = symbolCell.innerText.trim();
    if (!symbol) return;

    // normalize symbol (remove -USDT if already present)
    symbol = symbol.replace(/-?USDT$/i, "");

    const tvUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}USDT`;
    window.open(tvUrl, "_blank");
  });
});

document.querySelectorAll('[data-mode]').forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;

    // Update global mode
    pnlRadarOrderMode = mode;

    // Toggle button styles
    document.querySelectorAll('[data-mode]').forEach(b => {
      b.classList.remove("btn-primary");
      b.classList.add("btn-primary-light");
    });

    btn.classList.remove("btn-primary-light");
    btn.classList.add("btn-primary");

    // Re-render using latest data
    if (window.latestPositions) {
      renderPnlRadar(window.latestPositions);
    }
  });
});

// document.getElementById("buy-btn").addEventListener("click", async () => {
//   const amountInput = document.getElementById("buy-amount");
//   const status = document.getElementById("buy-status");
//
//   const amount = amountInput.value;
//
//   if (!amount || Number(amount) <= 0) {
//     status.textContent = "Enter a valid amount";
//     return;
//   }
//
//   status.textContent = "Submitting…";
//
//   try {
//     const res = await fetch("/api/trade/open", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json"
//       },
//       body: JSON.stringify({ amount })
//     });
//
//     const data = await res.json();
//
//     if (!res.ok) {
//       status.textContent = data.error || "Error";
//       return;
//     }
//
//     status.textContent = "Order submitted ✔";
//   } catch (err) {
//     status.textContent = "Request failed";
//   }
// });
//
//
// document.getElementById("close-all-btn").addEventListener("click", async () => {
//   const status = document.getElementById("close-status");
//
//   if (!confirm("Close ALL open positions? This cannot be undone.")) {
//     return;
//   }
//
//   status.textContent = "Submitting close request…";
//
//   try {
//     const res = await fetch("/api/trade/close", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" }
//     });
//
//     const data = await res.json();
//
//     if (!res.ok) {
//       status.textContent = data.error || "Close failed";
//       return;
//     }
//
//     status.textContent = "Close command sent ✔";
//   } catch (err) {
//     status.textContent = "Request failed";
//   }
// });
