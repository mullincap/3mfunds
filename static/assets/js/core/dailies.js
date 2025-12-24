// gamma_ltv_chart.js
// ----------------------------------------------------
// Gamma LTV Equity chart + linear regression trend
// + Upper / Lower statistical limits
// + Daily performance table renderer (weekly collapsible)
// + Comparative KPIs
// + Channel / Regime KPI block
// ----------------------------------------------------

console.log("Gamma LTV JS loaded");

let gammaChart = null;

/* ================================
   Math helpers
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

    return x.map(xi => slope * xi + intercept);
}

function stdDev(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(
        arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length
    );
}

function rollingSMA(values, window = 5) {
    return values.map((_, i) => {
        if (i < window - 1) return null;
        const slice = values.slice(i - window + 1, i + 1);
        return slice.reduce((a, b) => a + b, 0) / window;
    });
}

/* ================================
   Formatting helpers
================================ */
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function fmtPct(v, signed = true) {
    if (!Number.isFinite(v)) return "—";
    return `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function formatShortDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function isoWeek(dateStr) {
    const d = new Date(dateStr);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
}

/* ================================
   ApexCharts init
================================ */
gammaChart = new ApexCharts(
    document.querySelector("#gamma-ltv-chart"),
    {
        chart: { height: 600, toolbar: { show: false } },
        series: [],
        stroke: {
            width: [0,3,2,2,2],
            curve: "smooth",
            dashArray: [0,0,10,6,6]
        },
        markers: { size: 0 },
        colors: ["#22c55e","#bbf7d0","#3b82f6","#d946ef","#22d3ee"],
        fill: { opacity: [0.7,1,1,1,1] },
        xaxis: { categories: [], labels: { show: false } },
        yaxis: {
          min: min=> min,
          labels: {
            formatter: v => "$" + v.toLocaleString()
          }
         },
        grid: { borderColor: "rgba(255,255,255,0.08)", strokeDashArray: 3 },
        tooltip: { shared: true },
        legend: { labels: { colors: "#ccc" } }
    }
);
gammaChart.render();

/* ================================
   Load everything
================================ */
(async function loadGammaLTV() {
    const res = await fetch("/api/gamma/ltv");
    const rows = await res.json();

    /* ---------- CORE SERIES ---------- */
    const labels = rows.map(r => r.snapshot_date);
    const equity = rows.map(r => Number(r.equity_0pct_reinv));

    const trend = linearRegression(equity);
    const sma5 = rollingSMA(equity, 5);

    const residuals = equity.map((v,i) => v - trend[i]);
    const sigma = stdDev(residuals);
    const K = 1.8;

    const upper = trend.map(v => v + K * sigma);
    const lower = trend.map(v => v - K * sigma);

    gammaChart.updateOptions({ xaxis: { categories: labels } });
    gammaChart.updateSeries([
        { name: "Equity", type: "bar", data: equity },
        { name: "Trendline (LR)", type: "line", data: trend },
        { name: "5D SMA", type: "line", data: sma5 },
        { name: "Upper Limit", type: "line", data: upper },
        { name: "Lower Limit", type: "line", data: lower }
    ]);

    /* ================= KPI LOGIC (UNCHANGED) ================= */
    const startEquity = equity.find(v => Number.isFinite(v));
    const endEquity = [...equity].reverse().find(v => Number.isFinite(v));
    const fundReturn = ((endEquity / startEquity) - 1) * 100;

    const dailyReturns = [];
    for (let i = 1; i < equity.length; i++) {
        dailyReturns.push(((equity[i] / equity[i-1]) - 1) * 100);
    }

    const sharpe = (() => {
        const mean = dailyReturns.reduce((a,b)=>a+b,0) / dailyReturns.length;
        const std = stdDev(dailyReturns);
        return std ? (mean / std) * Math.sqrt(365) : null;
    })();

    let peak = equity[0], maxDD = 0;
    equity.forEach(v => {
        peak = Math.max(peak, v);
        maxDD = Math.min(maxDD, (v/peak - 1) * 100);
    });

    const btcRet = ((86867 / 115306.09) - 1) * 100;
    const ethRet = ((2930.62 / 4451.33) - 1) * 100;

    setText("cmp-fund-ret", fmtPct(fundReturn));
    setText("cmp-btc-ret", fmtPct(btcRet));
    setText("cmp-eth-ret", fmtPct(ethRet));
    setText("cmp-alpha-btc", fmtPct(fundReturn - btcRet));
    setText("cmp-sharpe", sharpe?.toFixed(2) ?? "—");
    setText("cmp-dd", fmtPct(maxDD));

    /* ---------- CHANNEL / REGIME ---------- */
    const n = equity.length;
    const last = equity[n-1];

    const channelPos = ((last - lower[n-1]) / (upper[n-1] - lower[n-1])) * 100;
    const slope = (trend[n-1] - trend[0]) / trend[0] / n;
    const monthlyTrend = slope * 30 * 100;

    const upside = ((upper[n-1] - last) / last) * 100;
    const downside = ((last - lower[n-1]) / last) * 100;

    const deviation = ((last - trend[n-1]) / trend[n-1]) * 100;
    const z = (last - trend[n-1]) / sigma;

    let regime = "Neutral";
    if (monthlyTrend > 5 && z > 0) regime = "Expansion";
    if (monthlyTrend < -5) regime = "Contraction";

    setText("kpi-channel-pos", channelPos.toFixed(1) + "%");
    setText("kpi-regime", regime);
    setText("kpi-trend-strength", monthlyTrend.toFixed(2) + "%");
    setText("kpi-volatility", (sigma / last * 100).toFixed(2) + "%");
    setText("kpi-upside", upside.toFixed(2) + "%");
    setText("kpi-downside", downside.toFixed(2) + "%");
    setText("kpi-deviation", fmtPct(deviation));
    setText("kpi-zscore", z.toFixed(2));

    /* =========================================================
       WEEKLY COLLAPSIBLE TABLE (FIXED HEADERS)
    ========================================================= */
    const tbody = document.querySelector("#gamma-ltv-table-body");
    tbody.innerHTML = "";

    const weeks = {};
    rows.forEach((r, i) => {
        const w = isoWeek(r.snapshot_date);
        weeks[w] ??= [];
        weeks[w].push({ ...r, idx: i + 1 });
    });

    const weekKeys = Object.keys(weeks).sort().reverse();

    weekKeys.forEach((wk, wi) => {
        const days = weeks[wk];
        const avgRoi = days.reduce((a,d)=>a+Number(d.total_return),0)/days.length*100;
        const pnl = days.reduce((a,d)=>a+Number(d.pnl),0);
        const finalEquity = Number(days[days.length - 1].equity_0pct_reinv);

        const open = wi < 3;

        const pnlClass =
            pnl > 0 ? "week-pos" :
            pnl < 0 ? "week-neg" :
                      "week-flat";

        tbody.insertAdjacentHTML("beforeend", `
        <tr class="table-secondary week-toggle ${pnlClass}"data-week="${wk}"data-pnl="${pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat"}">
            <td colspan="10">
               ${wk}
              &nbsp; Avg Daily ROI ${avgRoi.toFixed(2)}%
              · PnL $${pnl.toLocaleString()}
              · Final Equity $${finalEquity.toLocaleString()}
            </td>
          </tr>

          <tr class="week-child ${open ? "" : "d-none"}" data-week="${wk}">
            <th></th><th>Date</th><th>Start</th><th>Invested</th><th>End</th>
            <th>PnL</th><th>Cum PnL</th><th>ROI</th><th>Cum ROI</th><th>DAR</th>
          </tr>
        `);

        days.forEach(d => {
            tbody.insertAdjacentHTML("beforeend", `
              <tr class="week-child ${open ? "" : "d-none"}" data-week="${wk}">
                <td>${d.idx}</td>
                <td>${formatShortDate(d.snapshot_date)}</td>
                <td>$${Number(d.equity_before).toLocaleString()}</td>
                <td>$${Number(d.invested_margin).toLocaleString()}</td>
                <td>$${Number(d.equity_0pct_reinv).toLocaleString()}</td>
                <td class="${d.pnl>=0?"text-success":"text-danger"}">
                  ${d.pnl>=0?"+":""}$${Math.abs(d.pnl).toLocaleString()}
                </td>
                <td>$${Number(d.cum_pnl).toLocaleString()}</td>
                <td>${(Number(d.total_return)*100).toFixed(2)}%</td>
                <td>${fmtPct(((d.equity_0pct_reinv/startEquity)-1)*100)}</td>
                <td>${fmtPct((((d.equity_0pct_reinv/startEquity)-1)*100)/d.idx,false)}</td>
              </tr>
            `);
        });
    });



    tbody.addEventListener("click", e => {
        const row = e.target.closest(".week-toggle");
        if (!row) return;

        const wk = row.dataset.week;
        document.querySelectorAll(`.week-child[data-week="${wk}"]`)
            .forEach(r => r.classList.toggle("d-none"));
    });

})();
