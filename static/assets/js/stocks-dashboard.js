// =====================================================
//  GLOBAL VARIABLES
// =====================================================
let chart2 = null;

// =====================================================
//  MINI SPARKLINE CHARTS
// =====================================================
function renderSparkline(id, color) {
    let el = document.getElementById(id);
    if (!el) return;

    el.innerHTML = "";

    let opts = {
        chart: {
            type: 'line',
            height: 40,
            width: 100,
            sparkline: { enabled: true }
        },
        stroke: {
            curve: 'smooth',
            width: 1.5
        },
        fill: {
            type: 'gradient',
            gradient: { opacityFrom: 0.9, opacityTo: 0.9, stops: [0, 98] }
        },
        series: [{ name: "Value", data: [20, 14, 19, 10, 23, 20, 22, 9, 12] }],
        yaxis: { show: false },
        xaxis: { show: false },
        tooltip: { enabled: false },
        colors: [color],
    };

    new ApexCharts(el, opts).render();
}

// Sparkline calls
renderSparkline("total-invested", "#845adf");
renderSparkline("total-investments", "rgb(14, 168, 186)");
renderSparkline("portfolio-value", "rgb(245, 184, 73)");
renderSparkline("returns-rate", "rgb(38, 191, 148)");


// =====================================================
//  SAFE SERIES BUILDER
// =====================================================
function safePairs(tsArray, dataArray) {
    return tsArray.map((ts, i) => [
        new Date(ts).getTime(),
        Number(dataArray[i])
    ]).filter(row => Number.isFinite(row[1]));
}


// =====================================================
//  STACKING LOGIC
// =====================================================
function updateStacking() {
    if (!chart2) return;

    const pnlVisible = chart2?.w?.globals?.seriesNames.includes("P/L vs Invested") &&
        chart2?.w?.globals?.seriesToggleState?.["P/L vs Invested"] !== false;

    chart2.updateOptions({
        chart: { stacked: pnlVisible }
    }, false, true);
}


// =====================================================
//  MAIN CHART LOADER
// =====================================================
window.loadMainChart = function(days) {
    fetch(`/api/investments/timeseries?days=${days}`)
        .then(r => r.json())
        .then(data => {

            const investedSeries  = safePairs(data.timestamps, data.invested_value);
            const portfolioSeries = safePairs(data.timestamps, data.portfolio_value);

            // ---------- KPI Update ----------
            if (portfolioSeries.length > 1) {
                let first = portfolioSeries[0][1];
                let last  = portfolioSeries[portfolioSeries.length - 1][1];

                let diff = last - first;
                let pct  = (diff / first) * 100;

                document.getElementById("kpi-return-amount").innerText =
                    "$" + diff.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });

                document.getElementById("kpi-return-pct").innerHTML = `
                    <span class="${pct >= 0 ? "text-success" : "text-danger"} fw-semibold">
                        <i class="ti ti-chevron-${pct >= 0 ? "up" : "down"}"></i>
                        ${pct.toFixed(2)}%
                    </span>
                `;
            }

            if (chart2) chart2.destroy();

            const target = document.getElementById("totalInvestmentsStats");
            target.innerHTML = "";

            const options = {
                series: [
                  {
                      name: "Invested Capital",
                      type: "area",
                      data: investedSeries
                  },
                  {
                      name: "Portfolio Value",
                      type: "area",
                      data: portfolioSeries
                  }
                ],

                chart: {
                    id: "investChart",
                    height: 720,
                    type: "area",
                    stacked: false,
                    toolbar: { show: false },
                    zoom: { autoScaleYaxis: true }
                },

                fill: {
                    gradient: {
                        colors: ["#4ecc48", "#23b7e5"],
                        shade: "dark",
                        type: "vertical",
                        shadeIntensity: 0.3,
                        opacityFrom: 0.5,
                        opacityTo: 0.05,
                        stops: [0, 90, 100]
                    },
                    opacity: [0.05, 1]
                },

                stroke: {
                  curve: "smooth",
                  width: [1,2],
                  dashArray: [5, 0]
                },

                yaxis: {
                    min: undefined,
                    max: max => max * 1.3,
                    labels: {
                        formatter: v => "$" + Math.round(v).toLocaleString(),
                        style: { colors: "#aaa" }
                    },
                    title: { text: "Value", style: { color: "#ddd" } }
                },

                xaxis: {
                    type: "datetime",
                    labels: { style: { colors: "#aaa" } }
                },

                tooltip: {
                    y: { formatter: v => "$" + Math.round(v).toLocaleString() }
                },

                legend: {
                    position: "bottom",
                    labels: { colors: "#ddd" }
                },

                dataLabels: { enabled: false }
            };

            chart2 = new ApexCharts(target, options);
            chart2.render();
        });
};


// =====================================================
//  RANGE BUTTON LOGIC
// =====================================================
document.querySelectorAll(".btn-group button").forEach(btn => {
    btn.addEventListener("click", function () {

        document.querySelectorAll(".btn-group button").forEach(b => {
            b.classList.remove("btn-primary");
            b.classList.add("btn-primary-light");
        });

        this.classList.add("btn-primary");
        this.classList.remove("btn-primary-light");

        let label = this.textContent.trim();
        document.getElementById("kpi-return-label").innerText = `${label} Return`;

        if (label === "1D") loadMainChart(1);
        else if (label === "3D") loadMainChart(3);
        else if (label === "1W") loadMainChart(7);
        else if (label === "1M") loadMainChart(30);
        else if (label === "3M") loadMainChart(90);
        else if (label === "6M") loadMainChart(180);
        else if (label === "1Y") loadMainChart(365);
    });
});

loadMainChart(3);
document.getElementById("kpi-return-label").innerText = "3D Return";


// =====================================================
//  KPI LOADER (UPDATED WITH TOTAL RETURN KPI)
// =====================================================
function loadKPIs() {

    function formatDollarChange(v) {
        if (v === null || v === undefined) return "--";

        const absVal = Math.abs(v).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        if (v > 0) {
            return `<span class="text-success" style="font-weight:400">+$${absVal}</span>`;
        } else if (v < 0) {
            return `<span class="text-danger" style="font-weight:400">-$${absVal}</span>`;
        }
        return `<span class="text-muted" style="font-weight:400">$0.00</span>`;
    }

    fetch("/kpis")
        .then(r => r.json())
        .then(k => {

            document.getElementById("kpi-runtime").innerText =
                k.runtime_days + " days";

            document.getElementById("kpi-dpr").innerHTML =
                k.dpr_pct !== null
                ? `<span class="${k.dpr_pct >= 0 ? "text-success" : "text-danger"}" style="font-weight:400">
                        ${k.dpr_pct.toFixed(2)}%
                   </span>`
                : "--";

            document.getElementById("kpi-wpr").innerHTML =
                k.wpr_pct !== null
                ? `<span class="${k.wpr_pct >= 0 ? "text-success" : "text-danger"}" style="font-weight:400">
                        ${k.wpr_pct.toFixed(2)}%
                   </span>`
                : "--";

            document.getElementById("kpi-maxdd").innerHTML =
                k.max_dd_pct !== null
                ? `<span class="text-danger" style="font-weight:400">
                        -${Math.abs(k.lowest_daily_return).toFixed(2)}%
                   </span>`
                : "--";

            document.getElementById("kpi-week").innerHTML =
                formatDollarChange(k.rtw_dollars);

            document.getElementById("kpi-month").innerHTML =
                formatDollarChange(k.rtm_dollars);

            if (k.eff_total_return_pct !== null && k.eff_total_return_pct !== undefined) {
                let tr = k.eff_total_return_pct;
                let abs = Math.abs(tr).toFixed(2);
                let sign = tr >= 0 ? "+" : "-";
                let cls = tr >= 0 ? "text-success" : "text-danger";

                document.getElementById("kpi-total-return-rate").innerHTML = `
                    <span class="${cls}" style="font-weight:400">
                        ${sign}${abs}%
                    </span>
                `;
            }

            if (k.eff_total_return !== null && k.eff_total_return !== undefined) {
                let tr = k.eff_total_return;

                // Round to 2 decimals, then convert to comma format
                let abs = Number(Math.abs(tr).toFixed(2)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });

                let sign = tr >= 0 ? "+" : "-";
                let cls = tr >= 0 ? "text-success" : "text-danger";

                document.getElementById("kpi-total-return").innerHTML = `
                    <span class="${cls}" style="font-weight:400">
                        ${sign}$${abs}
                    </span>
                `;
            }
        });
}

loadKPIs();


// =====================================================
//  EARNINGS CHART
// =====================================================
document.addEventListener("DOMContentLoaded", function () {
    const labelsEl = document.getElementById("earnings-labels");
    const valuesEl = document.getElementById("earnings-values");

    if (!labelsEl || !valuesEl) return;

    const rawLabels = JSON.parse(labelsEl.dataset.json);
    const earningsValues = JSON.parse(valuesEl.dataset.json);

    const dayInitial = (str) =>
        new Date(str + " 2024")
            .toLocaleDateString("en-US", { weekday: "short" })[0];

    const earningsLabels = rawLabels.map(dayInitial);

    const element = document.getElementById("earnings");

    if (element) {
        new ApexCharts(element, {
            series: [{ name: "Daily Earnings", data: earningsValues }],
            chart: { type: "bar", height: 250, toolbar: { show: false }},
            colors: earningsValues.map((v, i) =>
                i === earningsValues.length - 1
                ? "rgb(132, 90, 223)"
                : "rgba(132, 90, 223, 0.25)"
            ),
            plotOptions: {
                bar: { columnWidth: "50%", borderRadius: 6, distributed: true }
            },
            dataLabels: { enabled: false },
            legend: { show: false },

            xaxis: {
                categories: earningsLabels,
                axisTicks: { show: false },
                axisBorder: { show: false },
                labels: { style: { colors: "#ccc", fontSize: "12px" } }
            },

            yaxis: {
                labels: {
                    formatter: (v) => {
                        const sign = v < 0 ? "-" : "";
                        const abs = Math.abs(v);
                        return abs >= 1000
                            ? `${sign}$${(abs/1000).toFixed(0)}k`
                            : `${sign}$${abs.toFixed(0)}`;
                    },
                    style: { colors: "#999", fontSize: "11px" }
                }
            },

            grid: {
                borderColor: "rgba(255,255,255,0.08)",
                strokeDashArray: 4
            },

            tooltip: {
                y: { formatter: (v) => "$" + v.toLocaleString() }
            }
        }).render();
    }
});


// =====================================================
//  DAILY CLOSES TABLE
// =====================================================
function loadDailyClosesTable() {
    fetch("/api/daily_closes_full")
        .then(r => r.json())
        .then(rows => {

            const tbody = document.getElementById("daily-closes-body");
            tbody.innerHTML = "";

            const fmtMoney = (v) => {
                const r = Math.round(v);
                const abs = Math.abs(r).toLocaleString();
                return r < 0 ? `-$${abs}` : `$${abs}`;
            };

            const fmtPct = (v) => {
                const pct = v.toFixed(1) + "%";
                if (v > 0) return `<span class="text-success"><i class="ti ti-arrow-narrow-up"></i> ${pct}</span>`;
                if (v < 0) return `<span class="text-danger"><i class="ti ti-arrow-narrow-down"></i> ${pct}</span>`;
                return `<span class="text-muted">${pct}</span>`;
            };

            const last14 = rows.slice(-14);

            let sumReturn = 0, sumPnL = 0, sumcumROI = 0, sumcumReturn = 0;

            last14.forEach(r => {
                sumReturn += r.return_usd;
                sumPnL += r.cum_pnl_usd;
                sumcumROI += r.roi_pct;
                sumcumReturn += r.cum_pnl_pct;

                tbody.innerHTML += `
                    <tr>
                        <td>${r.date}</td>
                        <td>${fmtMoney(r.start_balance)}</td>
                        <td>${fmtMoney(r.close_balance)}</td>
                        <td>${fmtMoney(r.return_usd)}</td>
                        <td>${fmtMoney(r.cum_pnl_usd)}</td>
                        <td>${fmtPct(r.roi_pct)}</td>
                        <td>${fmtPct(r.cum_pnl_pct)}</td>
                    </tr>
                `;
            });

            const avgReturn = Math.round(sumReturn / last14.length);
            const avgPnL = Math.round(sumPnL / last14.length);
            const avgCumRoi = (sumcumROI / last14.length).toFixed(2);
            const avgCumReturn = (sumcumReturn / last14.length).toFixed(2);

            tbody.innerHTML += `
                <tr style="background: rgba(255,255,255,0.03)">
                    <td><strong>Averages</strong></td>
                    <td></td>
                    <td></td>
                    <td><strong>${fmtMoney(avgReturn)}</strong></td>
                    <td><strong>${fmtMoney(avgPnL)}</strong></td>
                    <td><strong>${avgCumRoi}%</strong></td>
                    <td><strong>${avgCumReturn}%</strong></td>
                </tr>
            `;
        });
}

loadDailyClosesTable();


// =====================================================
//  PORTFOLIO STATS TABLE
// =====================================================
document.addEventListener("DOMContentLoaded", function () {
    fetch("/api/portfolio_stats")
        .then(r => r.json())
        .then(rows => {

            const topRows = rows.slice(0, 15);
            const body = document.getElementById("portfolio-stats-body");
            body.innerHTML = "";

            if (topRows.length === 0) {
                body.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No active positions.</td></tr>`;
                return;
            }

            topRows.forEach((r, idx) => {

                const base = (r.roi_pct ?? 0) * 100;
                const lev = base * 4;

                const levColor =
                    lev > 0 ? "text-success"
                  : lev < 0 ? "text-danger"
                  : "text-muted";

                body.innerHTML += `
                    <tr>
                        <td>P${idx + 1}</td>
                        <td>${r.symbol}</td>
                        <td>${base.toFixed(1)}%</td>
                        <td class="${levColor}">${lev.toFixed(1)}%</td>
                    </tr>
                `;
            });

        });
});
