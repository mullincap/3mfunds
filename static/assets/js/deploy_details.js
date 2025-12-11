document.addEventListener("DOMContentLoaded", function () {

    // =========================
    // PORTFOLIO BALANCE CHART
    // =========================
    new ApexCharts(document.querySelector("#balance-chart"), {
        chart: { type: "area", height: 350, toolbar: { show: false } },
        series: [{ name: "Balance", data: balance }],
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => "$" + v.toLocaleString() } },
        stroke: { curve: "smooth", width: 2 }
    }).render();

    // =========================
    // PORTFOLIO ROI CHART
    // =========================
    new ApexCharts(document.querySelector("#roi-chart"), {
        chart: { type: "line", height: 350, toolbar: { show: false } },
        series: [{ name: "Portfolio ROI %", data: roi }],
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => v.toFixed(2) + "%" } },
        stroke: { curve: "smooth", width: 2 }
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
        chart: { type: "line", height: 450, toolbar: { show: true } },
        series: assetSeriesFormatted,
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => v.toFixed(2) + "%" } },
        stroke: { curve: "smooth", width: 1.5 }
    }).render();

});
