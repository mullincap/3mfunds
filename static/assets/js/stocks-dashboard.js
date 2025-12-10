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
//  STACKING LOGIC (runs on legend toggle)
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
            const pnlSeries       = safePairs(data.timestamps, data.returns_diff);

            // =========================================
            // UPDATE RETURN KPI WHEN RANGE CHANGES
            // =========================================
            if (portfolioSeries.length > 1) {

                let first = portfolioSeries[0][1];
                let last  = portfolioSeries[portfolioSeries.length - 1][1];

                let diff = last - first;
                let pct  = (diff / first) * 100;

                // Update Return Value
                document.getElementById("kpi-return-amount").innerText =
                    "$" + diff.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });

                // Update Return Percentage
                let pctElem = document.getElementById("kpi-return-pct");

                pctElem.innerHTML = `
                    <span class="${pct >= 0 ? "text-success" : "text-danger"} fw-semibold">
                        <i class="ti ti-chevron-${pct >= 0 ? "up" : "down"}"></i>
                        ${pct.toFixed(2)}%
                    </span>
                `;
            }

            // ======== your existing chart code continues here ========

            // Destroy prior chart
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
                  dashArray: [5, 0]     // Portfolio solid, Invested dashed
                },

                yaxis: {
                  min: undefined,
                  max: function (max) {
                      return max * 1.3;   // 33.33% expansion above the highest value
                  },
                  labels: {
                      formatter: function (value) {
                          return "$" + Number(value).toLocaleString();
                      },
                      style: { colors: "#aaa" }
                  },
                  title: {
                      text: "Value",
                      style: { color: "#ddd" }
                  }
              },

                xaxis: {
                    type: "datetime",
                    labels: { style: { colors: "#aaa" } }
                },
                tooltip: {
                    y: {
                        formatter: function (value) {
                            return "$" + Number(value).toLocaleString();
                        }
                    },
                    x: {
                        formatter: function (value) {
                            return new Date(value).toLocaleString();
                        }
                    }
                },

                legend: {
                    position: "bottom",
                    labels: { colors: "#ddd" }
                },

                dataLabels: { enabled: false }
            };

            chart2 = new ApexCharts(target, options);

            chart2.render().then(() => {

            });
        });
};


// =====================================================
//  RANGE BUTTON LOGIC (1D, 1W, 1M, etc.)
// =====================================================
document.querySelectorAll(".btn-group button").forEach(btn => {
    btn.addEventListener("click", function () {


        // Reset styles on buttons
        document.querySelectorAll(".btn-group button").forEach(b => {
            b.classList.remove("btn-primary");
            b.classList.add("btn-primary-light");
        });

        this.classList.add("btn-primary");
        this.classList.remove("btn-primary-light");

        let label = this.textContent.trim();

        console.log("Clicked:", label);

        // ⭐ Update KPI label
        document.getElementById("kpi-return-label").innerText = `${label} Return`;

        // Load correct window
        if (label === "1D") loadMainChart(1);
        else if (label === "3D") loadMainChart(3);
        else if (label === "1W") loadMainChart(7);
        else if (label === "1M") loadMainChart(30);
        else if (label === "3M") loadMainChart(90);
        else if (label === "6M") loadMainChart(180);
        else if (label === "1Y") loadMainChart(365);
    });
});





// =====================================================
//  DEFAULT LOAD — 1D
// =====================================================
loadMainChart(3);

const kpiLabel = document.getElementById("kpi-return-label");
if (kpiLabel) {
    kpiLabel.innerText = "3D Return";
};



// =====================================================
//  LOAD ADVANCED KPIS
// =====================================================
function loadKPIs() {
    fetch("/kpis")
        .then(r => r.json())
        .then(k => {

            // Runtime in days
            document.getElementById("kpi-runtime").innerText =
                k.runtime_days + " days";

            // Daily %
            document.getElementById("kpi-dpr").innerHTML =
                k.dpr_pct !== null
                ? `<span class="${k.dpr_pct >= 0 ? "text-success" : "text-danger"}">
                     ${k.dpr_pct.toFixed(2)}%
                   </span>`
                : "--";

            // Weekly %
            document.getElementById("kpi-wpr").innerHTML =
                k.wpr_pct !== null
                ? `<span class="${k.wpr_pct >= 0 ? "text-success" : "text-danger"}">
                     ${k.wpr_pct.toFixed(2)}%
                   </span>`
                : "--";

            // APR %
            // document.getElementById("kpi-apr").innerHTML =
            //     `<span class="${k.apr_pct >= 0 ? "text-success" : "text-danger"}">
            //         ${k.apr_pct.toFixed(2)}%
            //      </span>`;
            document.getElementById("kpi-maxdd").innerHTML =
                k.max_dd_pct !== null
                ? `<span class="text-danger">
                     ${Math.abs(k.lowest_daily_return).toFixed(2)}%
                   </span>`
                : "--";


            // This week (dollars)
            document.getElementById("kpi-week").innerText =
                k.rtw_dollars !== null
                ? "$" + Number(k.rtw_dollars).toLocaleString()
                : "--";

            // This month (dollars)
            document.getElementById("kpi-month").innerText =
                k.rtm_dollars !== null
                ? "$" + Number(k.rtm_dollars).toLocaleString()
                : "--";
        })
        .catch(err => console.error("KPI load error:", err));
}

// Call KPI loader on page load
loadKPIs();



// =====================================================
//  EARNINGS CHART
// =====================================================

document.addEventListener("DOMContentLoaded", function () {

    // Pull JSON from hidden divs
    const labelsEl = document.getElementById("earnings-labels");
    const valuesEl = document.getElementById("earnings-values");

    if (!labelsEl || !valuesEl) {
        console.warn("Earnings data not found in DOM.");
        return;
    }

    const earningsLabels = JSON.parse(labelsEl.dataset.json);
    const earningsValues = JSON.parse(valuesEl.dataset.json);

    // -- Earnings Chart Rendering --
    const element = document.getElementById("earnings");
    if (element) {
        const options = {
            series: [{
                name: "Daily Earnings",
                data: earningsValues
            }],
            chart: { type: "bar", height: 200 },

            colors: earningsValues.map((v, idx) =>
                idx === earningsValues.length - 1
                    ? "rgb(132, 90, 223)"        // highlight latest day
                    : "rgba(132, 90, 223, 0.3)"
            ),

            plotOptions: {
                bar: {
                    columnWidth: "25%",
                    distributed: true,
                    borderRadius: 7,
                }
            },
            dataLabels: { enabled: false },
            legend: { show: false },

            xaxis: {
                categories: earningsLabels,
                axisTicks: { show: false },
                axisBorder: { show: false },
                labels: { rotate: -45 }
            },

            yaxis: {
                labels: {
                    formatter: (v) => "$" + v.toFixed(0)
                }
            },

            grid: { borderColor: "rgba(255,255,255,0.06)" }
        };

        new ApexCharts(element, options).render();
    }
});
