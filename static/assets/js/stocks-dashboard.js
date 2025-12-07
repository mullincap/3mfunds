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
                    height: 700,
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
                  labels: {
                        formatter: function (value) {
                            return "$" + Number(value).toLocaleString();
                        },
                        style: { colors: "#aaa" },
                        title: { text: "Value", style: { color: "#ddd" } }
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
    btn.addEventListener("click", function() {

        // Update button appearance
        document.querySelectorAll(".btn-group button").forEach(b => {
            b.classList.remove("btn-primary");
            b.classList.add("btn-primary-light");
        });

        this.classList.add("btn-primary");
        this.classList.remove("btn-primary-light");

        // Determine range
        const label = this.textContent.trim();
        if (label === "1D") loadMainChart(1);
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
loadMainChart(1);
