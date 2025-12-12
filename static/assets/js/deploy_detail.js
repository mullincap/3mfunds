document.addEventListener("DOMContentLoaded", function () {

    // =========================
    // PORTFOLIO BALANCE CHART
    // =========================
    // Resolve CSS variable → actual color value
    const primaryColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary-color")
        .trim();

    new ApexCharts(document.querySelector("#deploy-roi-chart"), {
        chart: { type: "area", height: 500, toolbar: { show: false } },

        series: [{ name: "Portfolio ROI %", data: roi }],

        xaxis: { categories: ts, type: "datetime" },

        yaxis: {
            labels: {
                formatter: v => (v * 100).toFixed(2) + "%"
            }
        },

        stroke: {
            curve: "smooth",
            width: 2,
            colors: [primaryColor]          // <-- FIXED
        },

        fill: {
            type: "gradient",
            gradient: {
                shade: "dark",
                type: "vertical",
                shadeIntensity: 0.25,
                opacityFrom: 0.45,
                opacityTo: 0.0,
                stops: [0, 100]
            }
        },

        colors: [primaryColor],             // <-- FIXED
        dataLabels: { enabled: false }
    }).render();


    // =========================
    // ASSET-LEVEL ROI CHARTS
    // =========================
    const assetSeriesFormatted = Object.keys(assetSeries).map(key => {
        return {
            name: key.replace("_roi", "").toUpperCase(),
            data: assetSeries[key]
        };
    });

    new ApexCharts(document.querySelector("#asset-roi-chart"), {
        chart: { type: "line", height: 800, toolbar: { show: true } },
        series: assetSeriesFormatted,
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => (v*100).toFixed(2) + "%" } },
        stroke: { curve: "smooth", width: 1.5 }
    }).render();

});
