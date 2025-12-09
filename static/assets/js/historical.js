// ===============================
// HISTORICAL ROI CHART
// ===============================

document.addEventListener("DOMContentLoaded", function () {

    // ---- Load series from hidden div ----
    const div = document.getElementById("hist-series");
    if (!div) return;

    const payload = JSON.parse(div.dataset.json);
    const fullLabels = payload.labels;     // array of "YYYY-MM-DD HH:MM"
    const fullValues = payload.values;     // array of floats

    // Convert labels → timestamps (ms)
    const fullTS = fullLabels.map(ts => new Date(ts).getTime());

    console.log("Historical labels:", fullLabels.length);
    console.log("Historical values:", fullValues.length);

    // Chart instance
    let histChart = null;


    // ===============================
    // FILTER FUNCTION
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
            return { ts: fullTS, vals: fullValues };
        }

        let idx = fullTS.findIndex(t => t >= cutoff);
        if (idx === -1) idx = 0;

        return {
            ts: fullTS.slice(idx),
            vals: fullValues.slice(idx)
        };
    }


    // ===============================
    // RENDER CHART
    // ===============================
    function renderChart(range = "1Y") {

        const filtered = filterRange(range);

        const ts = filtered.ts;
        const vals = filtered.vals;

        const seriesData = ts.map((t, i) => ({
            x: t,
            y: vals[i]
        }));

        // --- Compute linear average line ---
        const totalPoints = vals.length;
        const finalValue = vals[vals.length - 1];

        const linearAvg = vals.map((_, i) => {
            return (i / (totalPoints - 1)) * finalValue;
        });

        const linearSeries = ts.map((t, i) => ({
            x: t,
            y: linearAvg[i]
        }));


        // Destroy existing chart
        if (histChart) histChart.destroy();

        const options = {
            chart: {
                id: "histROI",
                type: "area",
                height: 730,
                toolbar: { show: false },
                zoom: { autoScaleYaxis: true }
            },

            series: [
                {
                    name: "Cumulative ROI",
                    data: seriesData,
                    type: "area"
                },
                {
                    name: "Linear Avg",
                    data: linearSeries,
                    type: "line"
                }
            ],

            stroke: {
                curve: "smooth",
                width: [2, 2],
                colors: ["#00e676", "#2979ff"],
                dashArray: [0, 6]   // <- dashed blue line for linear avg
            },

            fill: {
                type: ["gradient", "solid"],

                gradient: {
                    shade: "dark",
                    type: "vertical",
                    shadeIntensity: 0.4,
                    opacityFrom: 0.4,
                    opacityTo: 0.0,
                    stops: [0, 90, 100]
                }
            },

            xaxis: {
                type: "datetime",
                labels: { style: { colors: "#aaa" } }
            },

            yaxis: {
                labels: {
                    formatter: val => val.toFixed(2) + "%",
                    style: { colors: "#ccc" }
                }
            },

            grid: {
                borderColor: "rgba(255,255,255,0.08)"
            },

            tooltip: {
                shared: true,
                intersect: false,
                x: {
                    formatter: ts => new Date(ts).toLocaleString("en-US")
                },
                y: {
                    formatter: val => val.toFixed(2) + "%"
                }
            },

            legend: {
                labels: { colors: "#ddd" }
            },
            dataLabels: { enabled: false }
        };

        histChart = new ApexCharts(document.querySelector("#hist-chart"), options);
        histChart.render();
    }


    // ====================================
    // RANGE BUTTON HANDLER
    // ====================================
    document.querySelectorAll(".hist-range-btn").forEach(btn => {
        btn.addEventListener("click", function () {

            // Update button visual state
            document.querySelectorAll(".hist-range-btn")
                .forEach(b => b.classList.remove("btn-primary"));

            document.querySelectorAll(".hist-range-btn")
                .forEach(b => b.classList.add("btn-primary-light"));

            this.classList.remove("btn-primary-light");
            this.classList.add("btn-primary");

            renderChart(this.dataset.range);
        });
    });

    // ====================================
    // DEFAULT RANGE → 1 YEAR
    // ====================================
    renderChart("1Y");

    // Pre-highlight the 1Y button
    document.querySelectorAll(".hist-range-btn").forEach(btn => {
        if (btn.dataset.range === "1Y") {
            btn.classList.add("btn-primary");
            btn.classList.remove("btn-primary-light");
        }
    });

});
