// =====================================================
// GLOBAL CHART HANDLES
// =====================================================
let chartOI = null;
let chartOICum = null;

// =====================================================
// HELPERS
// =====================================================
function safePairs(ts, vals) {
    return ts.map((t, i) => [new Date(t).getTime(), Number(vals[i])])
             .filter(r => Number.isFinite(r[1]));
}

function cumulativeSum(series) {
    let acc = 0;
    return series.map(([ts, v]) => {
        acc += v;
        return [ts, acc];
    });
}

// =====================================================
// PRIMARY CHART LOADER (RAW OI CHANGE)
// =====================================================
async function loadOI(days) {
    const res = await fetch(`/api/interest/oi?days=${days}`);
    const rows = await res.json();
    if (!rows.length) return;

    const ts = rows.map(r => r.timestamp_utc);
    const oi = rows.map(r => r.oi_chg_24h / 100);

    const series = safePairs(ts, oi);

    if (chartOI) chartOI.destroy();
    document.getElementById("totalInvestmentsStats").innerHTML = "";

    chartOI = new ApexCharts(
        document.querySelector("#totalInvestmentsStats"),
        {
            chart: {
                type: "area",
                height: 720,
                toolbar: { show: false },
                zoom: { autoScaleYaxis: true }
            },
            series: [{
                name: "OI Change (24h)",
                data: series
            }],
            stroke: { curve: "smooth", width: 2 },
            fill: {
                type: "gradient",
                gradient: {
                    opacityFrom: 0.5,
                    opacityTo: 0.05
                }
            },
            xaxis: { type: "datetime" },
            yaxis: {
                labels: {
                    formatter: v => (v * 100).toFixed(2) + "%"
                }
            },
            tooltip: {
                y: {
                    formatter: v => (v * 100).toFixed(2) + "%"
                }
            },
            dataLabels: { enabled: false }
        }
    );

    chartOI.render();
}

// =====================================================
// CUMULATIVE CHART LOADER
// =====================================================
async function loadOICum(days) {
    const res = await fetch(`/api/interest/oi?days=${days}`);
    const rows = await res.json();
    if (!rows.length) return;

    const ts = rows.map(r => r.timestamp_utc);
    const oi = rows.map(r => r.oi_chg_24h / 100);

    const baseSeries = safePairs(ts, oi);
    const cumSeries  = cumulativeSum(baseSeries);

    if (chartOICum) chartOICum.destroy();
    document.getElementById("oiCumulativeChart").innerHTML = "";

    chartOICum = new ApexCharts(
        document.querySelector("#oiCumulativeChart"),
        {
            chart: {
                type: "area",
                height: 500,
                toolbar: { show: false },
                zoom: { autoScaleYaxis: true }
            },
            series: [{
                name: "Cumulative OI Change",
                data: cumSeries
            }],
            stroke: { curve: "smooth", width: 2 },
            fill: {
                type: "gradient",
                gradient: {
                    opacityFrom: 0.5,
                    opacityTo: 0.05
                }
            },
            xaxis: { type: "datetime" },
            yaxis: {
                labels: {
                    formatter: v => (v * 100).toFixed(2) + "%"
                }
            },
            tooltip: {
                y: {
                    formatter: v => (v * 100).toFixed(2) + "%"
                }
            },
            dataLabels: { enabled: false }
        }
    );

    chartOICum.render();
}

// =====================================================
// RANGE BUTTON BINDER (GENERIC + SAFE)
// =====================================================
function bindRange(selector, loaderFn) {
    document.querySelectorAll(`${selector} button`).forEach(btn => {
        btn.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();

            const group = btn.closest(selector);
            if (!group) return;

            group.querySelectorAll("button").forEach(b => {
                b.classList.remove("btn-primary");
                b.classList.add("btn-primary-light");
            });

            btn.classList.add("btn-primary");
            btn.classList.remove("btn-primary-light");

            const map = {
                "1D": 1,
                "3D": 3,
                "1W": 7,
                "1M": 30,
                "1Y": 365
            };

            const days = map[btn.textContent.trim()] ?? 30;
            loaderFn(days);
        });
    });
}

// =====================================================
// INIT
// =====================================================
document.addEventListener("DOMContentLoaded", () => {

    // Primary chart buttons
    bindRange(".chart-range-primary", loadOI);

    // Cumulative chart buttons
    bindRange(".chart-range-cum", loadOICum);

    // Initial loads
    loadOI(30);
    loadOICum(30);
});
