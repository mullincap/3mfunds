// ===============================
// HISTORICAL ROI CHART
// ===============================

document.addEventListener("DOMContentLoaded", function () {
    const div = document.getElementById("hist-series");
    if (!div) return;

    const payload = JSON.parse(div.dataset.json);
    const fullLabels = payload.labels;   // "YYYY-MM-DD HH:MM"
    const fullValues = payload.values;   // floats (%)

    // Convert labels → timestamps (ms)
    const fullTS = fullLabels.map(ts => new Date(ts).getTime());

    console.log("Historical labels:", fullLabels.length);
    console.log("Historical values:", fullValues.length);

    let histChart = null;

    // ===============================
    // RANGE FILTER
    // ===============================
    function filterRange(range) {
        let cutoff = null;
        const now = fullTS[fullTS.length - 1];

        switch (range) {
            case "1D": cutoff = now - 1 * 24 * 3600 * 1000; break;
            case "3D": cutoff = now - 3 * 24 * 3600 * 1000; break;
            case "1W": cutoff = now - 7 * 24 * 3600 * 1000; break;
            case "1M": cutoff = now - 30 * 24 * 3600 * 1000; break;
            case "3M": cutoff = now - 90 * 24 * 3600 * 1000; break;
            case "6M": cutoff = now - 180 * 24 * 3600 * 1000; break;
            case "1Y": cutoff = now - 365 * 24 * 3600 * 1000; break;
            default: cutoff = null;
        }

        if (!cutoff) {
            return { ts: fullTS.slice(), vals: fullValues.slice() };
        }

        let idx = fullTS.findIndex(t => t >= cutoff);
        if (idx === -1) idx = 0;

        return {
            ts: fullTS.slice(idx),
            vals: fullValues.slice(idx)
        };
    }

    // ===============================
    // LINEAR REGRESSION (on window)
    // ===============================
    function calcRegression(values) {
        const n = values.length;
        if (n < 2) {
            return { a: values[0] || 0, b: 0 };
        }

        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;

        for (let i = 0; i < n; i++) {
            const x = i;
            const y = values[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }

        const denom = (n * sumX2 - sumX * sumX);
        const b = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
        const a = (sumY - b * sumX) / n;

        return { a, b }; // y = a + b * i
    }

    // ===============================
    // RENDER CHART
    // ===============================
    function renderChart(range = "1Y") {

        // Apply window filter
        const filtered = filterRange(range);
        const ts = filtered.ts;
        const vals = filtered.vals;
        const n = ts.length;

        if (n === 0) return;

        // Main series (area)
        const mainSeries = ts.map((t, i) => ({
            x: t,
            y: vals[i]
        }));

        // ------- LINEAR AVG (window-based) -------
        const lastVal = vals[n - 1];
        const step = n > 1 ? lastVal / (n - 1) : 0;

        const linearAvgSeries = ts.map((t, i) => ({
            x: t,
            y: step * i
        }));


        // ============================================
        //   LIFETIME REGRESSION  (FIXED HERE)
        // ============================================

        // Compute regression using *full dataset*
        const { a, b } = calcRegression(fullValues);

        // Build full-regression series for the entire dataset
        const fullRegression = fullTS.map((t, i) => ({
            x: t,
            y: a + b * i
        }));

        // Slice regression to match current window
        const regressionSeries = fullRegression.filter(point => point.x >= ts[0]);


        // Destroy old chart
        if (histChart) histChart.destroy();

        const options = {
            chart: {
                id: "histROI",
                type: "line",
                height: 730,
                toolbar: { show: false },
                zoom: { autoScaleYaxis: true }
            },

            series: [
                {
                    name: "Cumulative ROI",
                    type: "area",
                    data: mainSeries
                },
                {
                    name: "Linear Avg",
                    type: "line",
                    data: linearAvgSeries,
                    color: "#38bdf8",
                    stroke: {
                        width: 2,
                        opacity: 1,
                    },
                    markers: {
                        size: 0,
                        strokeOpacity: 1,
                        fillOpacity: 1
                    }
                },
                {
                    name: "Linear Regression",
                    type: "line",
                    data: regressionSeries,
                    color: "#facc15",
                    stroke: {
                        width: 2,
                        opacity: 1,
                    },
                    markers: {
                        size: 0,
                        strokeOpacity: 1,
                        fillOpacity: 1
                    }
                }
            ],

            colors: [
                "#22c55e",
                "#38bdf8",
                "#facc15"
            ],

            stroke: {
                curve: "smooth",
                width: [2, 2, 2],
                dashArray: [0, 4, 0],
                opacity: 1
            },

            fill: {
                type: "gradient",
                gradient: {
                    shade: "dark",
                    type: "vertical",
                    shadeIntensity: 0.4,
                    opacityFrom: 0.35,
                    opacityTo: 0.0,
                    stops: [0, 90, 100]
                }
            },

            xaxis: { type: "datetime" },
            yaxis: {
                labels: {
                    formatter: v => v.toFixed(2) + "%"
                }
            },

            tooltip: {
                shared: true,
                y: { formatter: v => v.toFixed(2) + "%" }
            },

            legend: { labels: { colors: "#ddd" } }
        };

        histChart = new ApexCharts(document.querySelector("#hist-chart"), options);
        histChart.render();
    }

    // ====================================
    // RANGE BUTTON HANDLER
    // ====================================
    document.querySelectorAll(".hist-range-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".hist-range-btn").forEach(b => {
                b.classList.remove("btn-primary");
                b.classList.add("btn-primary-light");
            });

            this.classList.remove("btn-primary-light");
            this.classList.add("btn-primary");

            renderChart(this.dataset.range);
        });
    });

    // ====================================
    // DEFAULT RANGE → 1 YEAR
    // ====================================
    renderChart("1Y");

    // Highlight 1Y button on load
    document.querySelectorAll(".hist-range-btn").forEach(btn => {
        if (btn.dataset.range === "1Y") {
            btn.classList.add("btn-primary");
            btn.classList.remove("btn-primary-light");
        }
    });
});
