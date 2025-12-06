// =====================================================
//  GLOBAL VARIABLES
// =====================================================
var chart2 = null;


// =====================================================
//  RUN ONLY AFTER DOM IS READY
// =====================================================
window.onload = function () {

    /* =====================================================
       MINI SPARKLINE CHARTS
    ===================================================== */

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
    //  MAIN CHART LOADER — loads 1D, 1W, 1M, 3M, 6M, 1Y
    // =====================================================
    window.loadMainChart = function (days) {

        let target = document.getElementById("totalInvestmentsStats");
        if (!target) {
            console.warn("Missing #totalInvestmentsStats container.");
            return;
        }

        // Fetch downsampled data from Flask
        fetch(`/api/investments/timeseries?days=${days}`)
            .then(r => r.json())
            .then(data => {

                const portfolioSeries = data.timestamps.map((ts, i) =>
                    [new Date(ts).getTime(), data.portfolio_value[i]]
                );

                const investedSeries = data.timestamps.map((ts, i) =>
                    [new Date(ts).getTime(), data.invested_value[i]]
                );

                const returnsSeries = data.timestamps.map((ts, i) =>
                    [new Date(ts).getTime(), data.total_returns[i]]
                );

                const options = {
                    series: [
                        { name: "Portfolio Value", data: portfolioSeries },
                        { name: "Invested Value", data: investedSeries },
                        { name: "Total Returns", data: returnsSeries }
                    ],
                    chart: {
                        id: 'area-datetime',
                        type: 'area',
                        height: 700,
                        zoom: { autoScaleYaxis: true },
                        toolbar: { show: false }
                    },
                    dataLabels: {
                        enabled: false
                    },
                    xaxis: { type: 'datetime' },
                    stroke: { width: 2, curve: 'smooth' },
                    colors: ["#845adf", "#23b7e5", "#4ecc48"],
                    fill: {
                        type: 'gradient',
                        gradient: {
                            opacityFrom: 0.5,
                            opacityTo: 0.7,
                            stops: [0, 100]
                        }
                    }
                };

                target.innerHTML = ""; // Clear old chart
                chart2 = new ApexCharts(target, options);
                chart2.render();
            })
            .catch(err => console.error("Chart load error:", err));
    };


    // =====================================================
    //  BUTTON HANDLERS — 1D, 1W, 1M, 3M, 6M, 1Y
    // =====================================================
    document.querySelectorAll(".btn-group button").forEach(btn => {

        btn.addEventListener("click", function () {

            // Reset button styles
            document.querySelectorAll(".btn-group button").forEach(b => {
                b.classList.remove("btn-primary");
                b.classList.add("btn-primary-light");
            });

            this.classList.add("btn-primary");
            this.classList.remove("btn-primary-light");

            // Detect range
            let label = this.textContent.trim();
            if (label === "1D") loadMainChart(1);
            else if (label === "1W") loadMainChart(7);
            else if (label === "1M") loadMainChart(30);
            else if (label === "3M") loadMainChart(90);
            else if (label === "6M") loadMainChart(180);
            else if (label === "1Y") loadMainChart(365);
        });

    });


    // =====================================================
    //  LOAD DEFAULT VIEW — 1D
    // =====================================================
    loadMainChart(1);
};
