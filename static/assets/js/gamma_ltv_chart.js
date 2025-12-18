// gamma_ltv_chart.js
// ----------------------------------------------------
// Gamma LTV Equity chart + linear regression trend
// + Daily performance table renderer
// ----------------------------------------------------

console.log("Gamma LTV JS loaded");

let gammaChart = null;

/* ================================
   Linear regression (least squares)
================================ */
function linearRegression(y) {
    const n = y.length;
    const x = Array.from({ length: n }, (_, i) => i + 1);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return x.map(xi => Math.round((slope * xi + intercept) * 100) / 100);
}

/* ================================
   Rolling SMA
================================ */
function rollingSMA(values, window = 5) {
    return values.map((_, i) => {
        if (i < window - 1) return null;
        const slice = values.slice(i - window + 1, i + 1);
        return +(
            slice.reduce((a, b) => a + b, 0) / window
        ).toFixed(2);
    });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function pctReturn(start, end) {
  if (!start || !end) return null;
  return ((end / start) - 1) * 100;
}

function maxDrawdownPct(equity) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of equity) {
    if (v == null) continue;
    peak = Math.max(peak, v);
    const dd = (v / peak - 1) * 100; // negative
    maxDD = Math.min(maxDD, dd);
  }
  return maxDD; // negative number
}

function sharpeRatio(dailyReturnsPct) {
  // dailyReturnsPct: array of % returns per period (e.g. +2.1, -1.3)
  const r = dailyReturnsPct.filter(v => Number.isFinite(v));
  if (r.length < 2) return null;

  const mean = r.reduce((a, b) => a + b, 0) / r.length;

  console.log(mean);
  const variance = r.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (r.length - 1);
  const std = Math.sqrt(variance);

  if (!std) return null;

  // If your rows are daily, you can annualize (optional):
  // return (mean / std) * Math.sqrt(365);
  return (mean / std) * Math.sqrt(365) ;
}

function fmtPct2(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}







/* ================================
   ApexCharts init
================================ */
gammaChart = new ApexCharts(
    document.querySelector("#gamma-ltv-chart"),
    {
        chart: {
            height: 600,
            toolbar: { show: false },
            animations: { enabled: true }
        },
        series: [],
        stroke: {
            width: [0, 3, 2],
            curve: "smooth",
            dashArray: [0, 0, 10],
        },
        markers: { size: 0 },
        colors: [
            "#22c55e", // Equity (bars) - green
            "#bbf7d0", // Linear regression - light green
            "#3b82f6"  // 5D SMA - blue
        ],
        fill: {
          opacity: [0.7, 1, 1]   // 👈 THIS is the key line
        },
        xaxis: {
            categories: [],
            labels: { show: false }
        },
        yaxis: {
            min: 5000,
            labels: {
                formatter: v => "$" + v.toLocaleString()
            }
        },
        grid: {
            borderColor: "rgba(255,255,255,0.08)",
            strokeDashArray: 3
        },
        tooltip: {
            shared: true,
            y: {
                formatter: v => v ? "$" + v.toLocaleString() : "—"
            }
        },
        legend: {
            labels: { colors: "#ccc" }
        }
    }
);

gammaChart.render();

/* ================================
   Load chart + table (single fetch)
================================ */
(async function loadGammaLTV() {
    const res = await fetch("/api/gamma/ltv");
    const rows = await res.json();

    /* ---------- CHART ---------- */
    const labels = rows.map(r => r.snapshot_date);
    const equity = rows.map(r => Number(r.equity_0pct_reinv));
    const trend = linearRegression(equity);
    const sma5 = rollingSMA(equity, 5);

    gammaChart.updateOptions({
        xaxis: { categories: labels }
    });

    gammaChart.updateSeries([
        {
            name: "Equity",
            type: "bar",
            data: equity
        },
        {
            name: "Trendline (LR)",
            type: "line",
            data: trend
        },
        {
            name: "5D SMA",
            type: "line",
            data: sma5
        }
    ]);

    /* ---------- TABLE ---------- */
    const tbody = document.querySelector("#gamma-ltv-table-body");
    tbody.innerHTML = "";

    rows.forEach(r => {
        const pnl = Number(r.pnl);
        const pnlClass = pnl >= 0 ? "text-success" : "text-danger";

        tbody.insertAdjacentHTML("beforeend", `
            <tr>
                <td>${r.snapshot_date}</td>
                <td>$${Number(r.equity_before).toLocaleString()}</td>
                <td>$${Number(r.invested_margin).toLocaleString()}</td>
                <td class="${pnlClass}">
                    ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toLocaleString()}
                </td>
                <td>$${Number(r.cum_pnl).toLocaleString()}</td>
                <td>${(Number(r.total_return) * 100).toFixed(2)}%</td>
                <td>$${Number(r.equity_0pct_reinv).toLocaleString()}</td>
                <td>$${Number(r.trade_bal).toLocaleString()}</td>
                <td>$${Number(r.profit_bal).toLocaleString()}</td>
            </tr>
        `);
    });

    /* ---------- COMPARATIVE PERFORMANCE PANEL ---------- */

    // Fund series: use the equity you already plotted
    const fundStart = equity.find(v => Number.isFinite(v));
    const fundEnd = [...equity].reverse().find(v => Number.isFinite(v));
    const fundRet = pctReturn(fundStart, fundEnd);

    // Build daily % returns from equity series
    const fundDailyRets = [];
    for (let i = 1; i < equity.length; i++) {
      const prev = equity[i - 1];
      const cur = equity[i];
      if (Number.isFinite(prev) && Number.isFinite(cur) && prev !== 0) {
        fundDailyRets.push(((cur / prev) - 1) * 100);
      }
    }

    console.log(fundDailyRets);

    const fundSharpe = sharpeRatio(fundDailyRets);
    const fundMaxDD = maxDrawdownPct(equity);

    // BENCHMARKS OPTION A:
    // If your /api/gamma/ltv rows include btc_close / eth_close, use them
    let btc = rows.map(r => Number(r.btc_close));
    let eth = rows.map(r => Number(r.eth_close));

    const btcHasData = btc.some(v => Number.isFinite(v) && v > 0);
    const ethHasData = eth.some(v => Number.isFinite(v) && v > 0);

    // BENCHMARKS OPTION B (optional):
    // If you don’t have btc_close/eth_close in rows, fetch them here.
    // Create an endpoint that returns: { btc: [...], eth: [...] } aligned to your labels.
    // const BENCHMARK_URL = "/api/benchmarks/gamma-ltv"; // <-- you would implement this
    // if (!btcHasData || !ethHasData) {
    //   const bRes = await fetch(BENCHMARK_URL);
    //   const b = await bRes.json();
    //   btc = (b.btc || []).map(Number);
    //   eth = (b.eth || []).map(Number);
    // }

    // BTC OHLC
    // Sep 21, 2025	115,730.23	115,901.09	115,252.58	115,306.09	115,306.09

    // ETH OHLC
    // Sep 21, 2025	4,482.58	4,499.39	4,447.12	4,451.33	4,451.33



    const btcStart = 115306.09;
    const btcEnd = 86867.00;
    const btcRet = pctReturn(btcStart, btcEnd);

    const ethStart = 4451.33;
    const ethEnd = 2930.62;
    const ethRet = pctReturn(ethStart, ethEnd);

    const alphaVsBTC = (fundRet != null && btcRet != null) ? (fundRet - btcRet) : null;

    // Write to your right-side panel IDs (add these IDs in the HTML)
    setText("cmp-fund-ret", fmtPct2(fundRet));
    setText("cmp-btc-ret", fmtPct2(btcRet));
    setText("cmp-eth-ret", fmtPct2(ethRet));

    setText("cmp-alpha-btc", fmtPct2(alphaVsBTC));
    setText("cmp-sharpe", fundSharpe == null ? "—" : fundSharpe.toFixed(2));
    setText("cmp-dd", fmtPct2(fundMaxDD));





})();
