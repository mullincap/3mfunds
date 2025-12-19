// ===============================
// HISTORICAL ROI CHART + KPIs
// ===============================

document.addEventListener("DOMContentLoaded", function () {
    const div = document.getElementById("hist-series");
    if (!div) return;

    const payload = JSON.parse(div.dataset.json);
    const fullLabels = payload.labels;
    const fullValues = payload.values;

    const fullTS = fullLabels.map(ts => new Date(ts).getTime());

    let histChart = null;

    // ===============================
    // RANGE FILTER
    // ===============================
    function filterRange(range) {
        let cutoff = null;
        const now = fullTS[fullTS.length - 1];

        const day = 24 * 3600 * 1000;

        switch (range) {
            case "1D": cutoff = now - 1 * day; break;
            case "3D": cutoff = now - 3 * day; break;
            case "1W": cutoff = now - 7 * day; break;
            case "1M": cutoff = now - 30 * day; break;
            case "3M": cutoff = now - 90 * day; break;
            case "6M": cutoff = now - 180 * day; break;
            case "1Y": cutoff = now - 365 * day; break;
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
    // REGRESSION + STATS
    // ===============================
    function regressionWithResiduals(values) {
        const n = values.length;
        if (n < 2) return null;

        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumX2 += i * i;
        }

        const denom = n * sumX2 - sumX * sumX;
        const b = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
        const a = (sumY - b * sumX) / n;

        const regression = values.map((_, i) => a + b * i);
        const residuals = values.map((v, i) => v - regression[i]);

        return { a, b, regression, residuals };
    }

    function stdDev(arr) {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(
            arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length
        );
    }

    // ===============================
    // KPI RENDER
    // ===============================
    function renderKPIs({ a, b, sigma }, vals, idx) {
        const current = vals[idx];
        const regVal = a + b * idx;

        const upper = regVal + 1.8 * sigma;
        const lower = regVal - 1.8 * sigma;

        const channelPos = ((current - lower) / (upper - lower)) * 100;
        const deviation = current - regVal;
        const zScore = deviation / sigma;

        const upside = upper - current;
        const downside = current - lower;

        const BARS_PER_DAY = 12 * 24;
        const trendStrength = b * BARS_PER_DAY; // % per month approx

        const regime =
            b > 0.02 ? "Expansion" :
            b < -0.02 ? "Contraction" :
            "Range-Bound";

        // ----- DOM UPDATES -----
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        set("kpi-channel-pos", `${channelPos.toFixed(1)}%`);
        set("kpi-regime", regime);
        set("kpi-trend", `${trendStrength.toFixed(2)}%`);
        set("kpi-vol", sigma.toFixed(2));

        set("kpi-upside", `${upside.toFixed(2)}%`);
        set("kpi-downside", `${downside.toFixed(2)}%`);
        set("kpi-deviation", `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}%`);
        set("kpi-zscore", `${zScore >= 0 ? "+" : ""}${zScore.toFixed(2)}σ`);
    }

    // ===============================
    // RENDER CHART
    // ===============================
    function renderChart(range = "1Y") {
        const { ts, vals } = filterRange(range);
        const n = ts.length;
        if (!n) return;

        const mainSeries = ts.map((t, i) => ({ x: t, y: vals[i] }));

        const reg = regressionWithResiduals(fullValues);
        if (!reg) return;

        const { a, b, residuals } = reg;
        const sigma = stdDev(residuals);
        const K = 1.8;

        const regressionSeries = fullTS
            .map((t, i) => ({ x: t, y: a + b * i }))
            .filter(p => p.x >= ts[0]);

        const upperSeries = fullTS
            .map((t, i) => ({ x: t, y: (a + b * i) + K * sigma }))
            .filter(p => p.x >= ts[0]);

        const lowerSeries = fullTS
            .map((t, i) => ({ x: t, y: (a + b * i) - K * sigma }))
            .filter(p => p.x >= ts[0]);

        renderKPIs({ a, b, sigma }, vals, vals.length - 1);

        if (histChart) histChart.destroy();

        histChart = new ApexCharts(document.querySelector("#hist-chart"), {
            chart: {
                height: 730,
                toolbar: { show: false },
                zoom: { autoScaleYaxis: true },
                events: {
                    mounted: c => {
                        c.hideSeries("Linear Avg");
                        c.hideSeries("Linear Regression");
                    }
                }
            },
            series: [
                { name: "Cumulative ROI", data: mainSeries },
                { name: "Linear Regression", data: regressionSeries },
                { name: "Upper Limit", data: upperSeries },
                { name: "Lower Limit", data: lowerSeries }
            ],
            colors: ["#22c55e", "#facc15", "#d946ef", "#22d3ee"],
            stroke: {
                curve: "smooth",
                dashArray: [0, 0, 6, 6]
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
        });

        histChart.render();
    }

    document.querySelectorAll(".hist-range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".hist-range-btn").forEach(b => {
                b.classList.remove("btn-primary");
                b.classList.add("btn-primary-light");
            });
            btn.classList.add("btn-primary");
            btn.classList.remove("btn-primary-light");
            renderChart(btn.dataset.range);
        });
    });

    renderChart("1Y");
});
