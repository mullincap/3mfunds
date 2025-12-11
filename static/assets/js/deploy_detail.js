document.addEventListener("DOMContentLoaded", function () {

    // =========================
    // PORTFOLIO BALANCE CHART
    // =========================
    new ApexCharts(document.querySelector("#balance-chart"), {
        chart: { type: "area", height: 350, toolbar: { show: false } },
        series: [{ name: "Balance", data: balance }],
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => "$" + v.toLocaleString() } },
        stroke: { curve: "smooth", width: 2 },
        dataLabels: { enabled: false }
    }).render();

    // =========================
    // PORTFOLIO ROI CHART
    // =========================
    new ApexCharts(document.querySelector("#roi-chart"), {
        chart: { type: "area", height: 500, toolbar: { show: false } },
        series: [{ name: "Portfolio ROI %", data: roi }],
        xaxis: { categories: ts, type: "datetime" },
        yaxis: { labels: { formatter: v => (v*100).toFixed(2) + "%" } },
        stroke: { curve: "smooth", width: 2 },
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
