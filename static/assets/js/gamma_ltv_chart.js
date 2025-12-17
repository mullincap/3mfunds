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
            dashArray: [0, 0, 10]
        },
        markers: { size: 0 },
        colors: [
            "#22c55e", // Equity (bars) - green
            "#bbf7d0", // Linear regression - light green
            "#3b82f6"  // 5D SMA - blue
        ],
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

})();
