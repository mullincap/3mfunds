let GLOBAL_RETURNS_DATA = [];

/* ================================
   SETTINGS
================================ */
const SETTINGS = {
    ZERO_RISK_OFF_HOURS: true,   // toggle on/off
    RISK_OFF_START: 0,           // 12am
    RISK_OFF_END: 6              // up to 6am (exclusive)
};

/* ================================
   CONFIG
================================ */
const START_HOUR = 1; // 1am start for BOTH charts

/* ================================
   Label Formatting
================================ */
function formatHourLabel(hour) {
    const h = Number(hour);
    const period = h >= 12 ? "pm" : "am";
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    return `${displayHour}${period}`;
}

function formatDateLabel(dateStr) {
    const [year, month, day] = dateStr.split("-");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${monthNames[Number(month) - 1]}-${day}`;
}

function pct(v) {
    return (v * 100).toFixed(2) + "%";
}

function hrsToDays(hrs) {
    if (hrs === null || hrs === undefined) return "—";
    if (hrs < 24) return `${hrs} hrs`;
    return `${(hrs / 24).toFixed(1)} days`;
}

function sharpeColor(value) {
    if (value >= 2) return "text-emerald";
    if (value >= 1) return "text-green";
    if (value >= 0.5) return "text-yellow";
    return "text-red";
}

function calmarColor(value) {
    if (value >= 3) return "text-emerald";
    if (value >= 1.5) return "text-green";
    if (value >= 0.75) return "text-yellow";
    return "text-red";
}

/* ================================
   Hour Order Helper
================================ */
function getOrderedHours(startHour = 0) {
    return [
        ...Array.from({ length: 24 - startHour }, (_, i) => i + startHour),
        ...Array.from({ length: startHour }, (_, i) => i)
    ];
}

/* ================================
   RISK OFF TOGGLE
================================ */
function applyRiskOffHours(data) {
    if (!SETTINGS.ZERO_RISK_OFF_HOURS) return data;

    return data.map(d => {
        const h = Number(d.hour);
        const isRiskOff =
            h >= SETTINGS.RISK_OFF_START &&
            h < SETTINGS.RISK_OFF_END;

        return {
            ...d,
            hourly_return: isRiskOff ? 0 : d.hourly_return
        };
    });
}

/* ================================
   Cumulative PnL + Drawdown Engine
================================ */
function computeCumulativeStats(data) {
    let cumulative = 0;
    let peak = 0;

    let maxDD = 0;
    let ddStart = 0;
    let ddTrough = 0;
    let ddEnd = null;

    let recoveryIndex = null;

    let currentPeakIndex = 0;
    let inDrawdown = false;

    const series = data
        .sort((a, b) =>
            a.date === b.date
                ? a.hour - b.hour
                : a.date.localeCompare(b.date)
        )
        .map((d, i) => {
            cumulative += d.hourly_return;

            // 🔑 New peak → possible recovery
            if (cumulative >= peak) {

                // If we were in the max drawdown and recovery not yet recorded
                if (inDrawdown && recoveryIndex === null) {
                    recoveryIndex = i;
                    ddEnd = i;
                }

                peak = cumulative;
                currentPeakIndex = i;
                inDrawdown = false;

            } else {
                const dd = cumulative - peak;

                // 🔻 New worst drawdown
                if (dd < maxDD) {
                    maxDD = dd;
                    ddStart = currentPeakIndex;
                    ddTrough = i;
                    ddEnd = null;
                    recoveryIndex = null; // reset recovery for new max DD
                }

                inDrawdown = true;
            }

            return {
                x: `${d.date} ${formatHourLabel(d.hour)}`,
                cumulative,
                drawdown: cumulative - peak
            };
        });

    // If never recovered, drawdown lasts to end
    if (ddEnd === null) ddEnd = series.length - 1;

    return {
        series,
        totalReturn: cumulative,
        maxDrawdown: maxDD,
        maxDrawdownDuration: ddEnd - ddStart,
        ddRecoveryTime:
            recoveryIndex !== null ? recoveryIndex - ddTrough : null,
        ddStart,
        ddTrough,
        ddEnd
    };
}

/* ================================
   KPI Row
================================ */
function r2Color(v) {
    if (v >= 0.8) return "text-emerald";
    if (v >= 0.6) return "text-green";
    if (v >= 0.4) return "text-yellow";
    return "text-red";
}


function renderKPIs(stats) {
    const totalEl = document.getElementById("kpi-total-return");
    const maxDDEl = document.getElementById("kpi-max-dd");
    const ddDurEl = document.getElementById("kpi-dd-duration");
    const ddRecEl = document.getElementById("kpi-dd-recovery");

    if (!totalEl) return; // failsafe

    totalEl.textContent = pct(stats.totalReturn);
    maxDDEl.textContent = pct(stats.maxDrawdown);
    ddDurEl.textContent = hrsToDays(stats.maxDrawdownDuration);
    ddRecEl.textContent =
        stats.ddRecoveryTime !== null
            ? hrsToDays(stats.ddRecoveryTime)
            : "Unrecovered";
}

function renderRiskKPIs({ sharpe, calmar, sortino, hitRate, rsq }) {
    const sharpeEl = document.querySelector("#kpi-sharpe");
    const calmarEl = document.querySelector("#kpi-calmar");
    const sortinoEl = document.querySelector("#kpi-sortino");
    const hitEl = document.querySelector("#kpi-hit-rate");
    const r2El = document.querySelector("#kpi-r2");

    if (r2El) {
        r2El.textContent = rsq.toFixed(2);
        r2El.className = "kpi-value " + r2Color(rsq);
    }

    if (sharpeEl) {
        sharpeEl.textContent = sharpe.toFixed(1);
        sharpeEl.className = "kpi-value " + sharpeColor(sharpe);
    }

    if (calmarEl) {
        calmarEl.textContent = calmar.toFixed(1);
        calmarEl.className = "kpi-value " + calmarColor(calmar);
    }

    if (sortinoEl) {
        sortinoEl.textContent = sortino.toFixed(1);
        sortinoEl.className = "kpi-value " + calmarColor(sortino);
    }

    if (hitEl) {
        hitEl.textContent = hitRate.toFixed(3)*100 + '%';
        // hitEl.className = "kpi-value " + calmarColor(hitRate);
    }

}

function computeRiskMetrics(data) {
    const returns = data
        .map(d => d.hourly_return)
        .filter(v => typeof v === "number");

    if (returns.length < 2) {
        return {
            sharpe: 0,
            annualVol: 0,
            annualReturn: 0,
            calmar: 0
        };
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

    const variance =
        returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
        (returns.length - 1);

    const std = Math.sqrt(variance);

    const HOURS_PER_YEAR = 24 * 365;

    const annualReturn = mean * HOURS_PER_YEAR;
    const annualVol = std * Math.sqrt(HOURS_PER_YEAR);

    const sharpe =
        std === 0 ? 0 : (mean / std) * Math.sqrt(HOURS_PER_YEAR);

    return {
        sharpe,
        annualVol,
        annualReturn,
        calmar: null // filled once max DD is known
    };
}

/* ================================
   Risk Metrics (Hourly)
================================ */
function computeRiskMetrics2(data) {
    // Use hourly returns, exclude zeros (risk-off)
    const returns = data
        .map(d => d.hourly_return)
        .filter(r => r !== 0 && !isNaN(r));

    if (returns.length === 0) {
        return {
            sortino: 0,
            hitRate: 0
        };
    }

    const mean =
        returns.reduce((a, b) => a + b, 0) / returns.length;

    // Downside deviation
    const downside = returns.filter(r => r < 0);
    const downsideVariance =
        downside.length
            ? downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
              downside.length
            : 0;

    const downsideStd = Math.sqrt(downsideVariance);

    const HOURS_PER_YEAR = 24 * 365;

    const sortino =
        downsideStd === 0
            ? 0
            : (mean / downsideStd) * Math.sqrt(HOURS_PER_YEAR);

    // Hit Rate
    const wins = returns.filter(r => r > 0).length;
    const hitRate = wins / returns.length;

    return {
        sortino,
        hitRate
    };
}


/* ================================
   Linear Regression Helper
================================ */
function computeLinearRegression(yValues) {
    const n = yValues.length;
    if (n === 0) return [];

    let sumX = 0,
        sumY = 0,
        sumXY = 0,
        sumX2 = 0;

    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += yValues[i];
        sumXY += i * yValues[i];
        sumX2 += i * i;
    }

    const slope =
        (n * sumXY - sumX * sumY) /
        (n * sumX2 - sumX * sumX);

    const intercept = (sumY - slope * sumX) / n;

    return yValues.map((_, i) => slope * i + intercept);
}


/* ================================
   Cumulative PnL + Drawdown
================================ */
function computeCumulativePnL(data) {
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let maxDDIndex = 0;

    const series = data
        .sort((a, b) => {
            if (a.date === b.date) return a.hour - b.hour;
            return a.date.localeCompare(b.date);
        })
        .map((d, i) => {
            cumulative += d.hourly_return;
            peak = Math.max(peak, cumulative);

            const drawdown = cumulative - peak;
            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown;
                maxDDIndex = i;
            }

            return {
                x: `${d.date} ${formatHourLabel(d.hour)}`,
                cumulative,
                drawdown
            };
        });

    return {
        series,
        maxDrawdown,
        maxDDIndex
    };
}

/* ================================
   Cumulative PnL Chart (with Max DD)
================================ */
/* ================================
   Cumulative PnL Chart (with Trendline + Max DD)
================================ */
function renderCumulativePnLChart(data) {

    const { series, maxDrawdown, maxDDIndex } = computeCumulativePnL(data);

    const cumulativeValues = series.map(d => d.cumulative);
    const trendline = computeLinearRegression(cumulativeValues);
    const rSquared = computeRSquared(cumulativeValues, trendline);

    const r2Color =
        rSquared >= 0.8 ? "#22c55e" :
        rSquared >= 0.6 ? "#4ade80" :
        rSquared >= 0.4 ? "#facc15" :
        "#f87171";

    const options = {
        chart: {
            type: "area",
            height: 800,
            toolbar: { show: false }
        },

        // 🔑 Institutional header
        title: {
            text: "Cumulative PnL",
            align: "left",
            style: {
                fontSize: "14px",
                fontWeight: 600,
                color: "#e5e7eb"
            }
        },

        subtitle: {
            text: `Trend R²: ${rSquared.toFixed(2)}`,
            align: "right",
            style: {
                fontSize: "12px",
                fontWeight: 500,
                color: r2Color
            }
        },

        series: [
            {
                name: "Cumulative PnL",
                data: cumulativeValues
            },
            {
                name: "Trend",
                data: trendline
            },
            {
                name: "Drawdown",
                data: series.map(d => d.drawdown)
            }
        ],

        colors: [
            "#4ade80", // cumulative
            "#94a3b8", // trendline
            "#f87171"  // drawdown
        ],

        stroke: {
            curve: "smooth",
            width: [2, 1.5, 0],
            dashArray: [0, 6, 0] // dashed trendline
        },

        fill: {
            type: ["gradient", "gradient", "solid"],
            gradient: {
                shadeIntensity: 0.6,
                opacityFrom: 0.35,
                opacityTo: 0.05
            },
            opacity: [0.35, 0.1, 0.25]
        },

        xaxis: {
            categories: series.map(d => d.x),
            labels: { show: false }
        },

        yaxis: {
            labels: {
                formatter: v => (v * 100).toFixed(2) + "%",
                style: { colors: "#9ca3af" }
            }
        },

        tooltip: {
            shared: true,
            y: {
                formatter: v => (v * 100).toFixed(2) + "%"
            }
        },

        legend: {
            labels: { colors: "#9ca3af" }
        },

        grid: {
            borderColor: "rgba(255,255,255,0.03)"
        },

        dataLabels: { enabled: false }
    };

    new ApexCharts(
        document.querySelector("#cumulative-pnl-chart"),
        options
    ).render();

    return rSquared;
}


/* ================================
   Hourly Average Computation
================================ */
function computeHourlyAverages(data) {
    const buckets = {};

    data.forEach(d => {
        const h = d.hour;
        if (!buckets[h]) buckets[h] = { sum: 0, count: 0 };
        buckets[h].sum += d.hourly_return;
        buckets[h].count += 1;
    });

    return Object.keys(buckets).map(h => ({
        rawHour: Number(h),
        hour: formatHourLabel(h),
        value: buckets[h].sum / buckets[h].count
    }));
}

/* ================================
   Weekday Helpers
================================ */
function getWeekday(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "long" });
}

const WEEKDAY_ORDER = [
    "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday", "Sunday"
];

/* ================================
   Weekday Average Computation
================================ */
function computeWeekdayAverages(data) {
    const buckets = Object.fromEntries(
        WEEKDAY_ORDER.map(d => [d, { sum: 0, count: 0 }])
    );

    data.forEach(d => {
        const h = Number(d.hour);

        // 🔒 Respect risk-off toggle here too
        if (
            SETTINGS.ZERO_RISK_OFF_HOURS &&
            h >= SETTINGS.RISK_OFF_START &&
            h < SETTINGS.RISK_OFF_END
        ) {
            return;
        }

        const day = getWeekday(d.date);
        buckets[day].sum += d.hourly_return;
        buckets[day].count += 1;
    });

    return WEEKDAY_ORDER.map(day => ({
        day,
        value: buckets[day].count
            ? buckets[day].sum / buckets[day].count
            : 0
    }));
}

/* ================================
   Weekday Avg Chart (Institutional Lollipop)
================================ */
function renderWeekdayAvgChart(weekdayAvg) {
    const values = weekdayAvg.map(d => d.value);

    const options = {
        chart: {
            type: "bar",
            height: 200,
            toolbar: { show: false }
        },

        series: [{
            name: "Avg Hourly ROI",
            data: values
        }],

        xaxis: {
            categories: weekdayAvg.map(d => d.day),
            labels: {
                style: {
                    colors: "#9ca3af",
                    fontSize: "12px",
                    fontWeight: 500
                }
            }
        },

        yaxis: {
            labels: {
                show: false,
                formatter: v => (v * 100).toFixed(2) + "%",
                style: { colors: "#9ca3af" }
            }
        },

        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: "12%",          // 🔑 thin stem
                borderRadius: 3,
                colors: {
                    ranges: [
                        { from: -1, to: -0.0001, color: "#f87171" },
                        { from: -0.0001, to: 0.0001, color: "#6b7280" },
                        { from: 0.0001, to: 1, color: "#4ade80" }
                    ]
                }
            }
        },

        markers: {
            size: 7,                         // 🔑 lollipop head
            strokeWidth: 0,
            colors: values.map(v =>
                v > 0 ? "#4ade80" :
                v < 0 ? "#f87171" :
                "#6b7280"
            )
        },

        dataLabels: { enabled: false },

        grid: {
            borderColor: "rgba(255,255,255,0.04)",
            strokeDashArray: 3
        },

        annotations: {
            yaxis: [{
                y: 0,
                borderColor: "#64748b",
                strokeDashArray: 4,
                label: {
                    // text: "Break-even",
                    style: {
                        color: "#9ca3af",
                        background: "transparent",
                        fontSize: "11px"
                    }
                }
            }]
        },

        tooltip: {
            y: {
                formatter: v => (v * 100).toFixed(2) + "%"
            }
        }
    };

    new ApexCharts(
        document.querySelector("#weekday-avg-chart"),
        options
    ).render();
}

/* ================================
   R² (Trend Confidence)
================================ */
function computeRSquared(actual, predicted) {
    if (!actual.length || actual.length !== predicted.length) return 0;

    const mean =
        actual.reduce((a, b) => a + b, 0) / actual.length;

    let ssTot = 0;
    let ssRes = 0;

    for (let i = 0; i < actual.length; i++) {
        ssTot += Math.pow(actual[i] - mean, 2);
        ssRes += Math.pow(actual[i] - predicted[i], 2);
    }

    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}


/* ================================
   Hourly Avg Bar Chart
================================ */
function renderHourlyAvgChart(hourlyAvg) {
    const orderedHours = getOrderedHours(START_HOUR);

    const orderedData = orderedHours.map(h => {
        const found = hourlyAvg.find(d => d.rawHour === h);
        return {
            hour: formatHourLabel(h),
            value: found ? found.value : 0
        };
    });

    const options = {
        chart: { type: "bar", height: 350, toolbar: { show: false } },
        series: [{ name: "Avg Return", data: orderedData.map(d => d.value) }],
        xaxis: {
            categories: orderedData.map(d => d.hour),
            labels: { rotate: -45, style: { fontSize: "11px", colors: "#9ca3af" } }
        },
        yaxis: {
            labels: {
                show: false,
                formatter: v => (v * 100).toFixed(2) + "%",
                style: { colors: "#9ca3af" }
            }
        },
        plotOptions: {
            bar: {
                columnWidth: "55%",
                borderRadius: 4,
                colors: {
                    ranges: [
                        { from: -1, to: -0.0001, color: "#f87171" },
                        { from: -0.0001, to: 0.0001, color: "#6b7280" },
                        { from: 0.0001, to: 1, color: "#4ade80" }
                    ]
                }
            }
        },
        grid: { borderColor: "rgba(255,255,255,0.03)", strokeDashArray: 3 },
        dataLabels: { enabled: false },
        tooltip: { y: { formatter: v => (v * 100).toFixed(2) + "%" } },
        annotations: {
            yaxis: [{
                y: 0,
                borderColor: "#64748b",
                strokeDashArray: 4
            }]
        }
    };

    new ApexCharts(
        document.querySelector("#hourly-avg-chart"),
        options
    ).render();
}

/* ================================
   Daily Average Computation
================================ */
function computeDailyAverages(data) {
    const buckets = {};

    data.forEach(d => {
        const date = d.date;
        if (!buckets[date]) buckets[date] = { sum: 0, count: 0 };
        buckets[date].sum += d.hourly_return;
        buckets[date].count += 1;
    });

    return Object.keys(buckets)
        .sort()
        .map(date => ({
            date,
            value: buckets[date].sum / buckets[date].count
        }));
}

/* ================================
   Daily Avg Chart
================================ */
function renderDailyAvgChart(dailyAvg) {
    const options = {
        chart: { type: "bar", height: 250, toolbar: { show: false } },
        series: [{ name: "Avg Daily Return", data: dailyAvg.map(d => d.value) }],
        xaxis: {
            categories: dailyAvg.map(d => d.date),
            labels: {
                rotate: -45,
                style: { colors: "#9ca3af", fontSize: "11px" },
                formatter: value => formatDateLabel(value)
            }
        },
        yaxis: {
            labels: {
                show: false,
                formatter: v => (v * 100).toFixed(2) + "%",
                style: { colors: "#9ca3af" }
            }
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                columnWidth: "55%",
                colors: {
                    ranges: [
                        { from: -1, to: 0, color: "#f87171" },
                        { from: 0, to: 1, color: "#4ade80" }
                    ]
                }
            }
        },
        grid: { borderColor: "rgba(255,255,255,0.03)", strokeDashArray: 3 },
        dataLabels: { enabled: false },
        tooltip: { y: { formatter: v => (v * 100).toFixed(2) + "%" } }
    };

    new ApexCharts(
        document.querySelector("#daily-avg-chart"),
        options
    ).render();
}

/* ================================
   Heatmap Loader
================================ */
async function loadHeatmap() {
    const res = await fetch("/api/returns/hourly");
    const json = await res.json();

    if (json.status !== "ok" || !json.data?.length) {
        console.error("No data returned from API");
        return;
    }

    // Apply risk-off logic first
    GLOBAL_RETURNS_DATA = applyRiskOffHours(json.data);

    const dates = [...new Set(GLOBAL_RETURNS_DATA.map(d => d.date))].sort();

    // --------------------------------------------------
    // Build grid with NULL defaults (CRITICAL)
    // --------------------------------------------------
    const grid = {};
    for (let h = 0; h < 24; h++) {
        grid[h] = {};
        dates.forEach(date => {
            grid[h][date] = null; // 🔑 must be null, NOT 0
        });
    }

    // Populate only real values
    GLOBAL_RETURNS_DATA.forEach(d => {
        const v = Number(d.hourly_return);

        // Treat near-zero as neutral (transparent)
        if (Math.abs(v) < 0.002) {
            grid[d.hour][d.date] = null;
        } else {
            grid[d.hour][d.date] = v;
        }
    });

    const orderedHours = getOrderedHours(START_HOUR);

    // --------------------------------------------------
    // Build heatmap series with explicit NULL enforcement
    // --------------------------------------------------
    let series = orderedHours.map(hour => ({
        name: formatHourLabel(hour),
        data: dates.map(date => {
            const v = grid[hour][date];
            return {
                x: date,
                y: (v === null || v === undefined) ? null : v
            };
        })
    }));

    // Apex renders heatmap bottom-up
    series = series.reverse();

    // --------------------------------------------------
    // Heatmap options (institutional-grade)
    // --------------------------------------------------
    const heatmapOptions = {
        chart: {
            type: "heatmap",
            height: 700,
            toolbar: { show: false }
        },
        plotOptions: {
            heatmap: {
                enableShades: false,          // 🔑 disables rainbow interpolation
                shadeIntensity: 0.99,
                nullColor: "#1a1c1e", // card-body color
                colorScale: {
                    ranges: [
                        { from: -1,    to: -0.03, color: "#7f1d1d" },
                        { from: -0.03, to: -0.01, color: "#b91c1c" },
                        { from: -0.01, to: -0.002, color: "#ef4444" },
                        { from: -0.01, to: -0.002, color: "#ef4444" },
                        { from: -0.002, to: 0.002, color: "#1a1c1e" },
                        { from:  0.002, to:  0.01, color: "#22c55e" },
                        { from:  0.01,  to:  0.03, color: "#16a34a" },
                        { from:  0.03,  to:  1,     color: "#15803d" }
                    ]
                }
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            type: "category",
            tickAmount: 10,
            labels: {
                rotate: -45,
                style: {
                    colors: "#9ca3af",
                    fontSize: "11px"
                },
                formatter: value => formatDateLabel(value)
            }
        },
        tooltip: {
            y: {
                formatter: v =>
                    v === null ? "—" : `${(v * 100).toFixed(2)}%`
            }
        },
        series
    };

    // --------------------------------------------------
    // Render heatmap
    // --------------------------------------------------
    new ApexCharts(
        document.querySelector("#heatmap"),
        heatmapOptions
    ).render();

    // --------------------------------------------------
    // Render companion charts + KPIs
    // --------------------------------------------------
    renderHourlyAvgChart(computeHourlyAverages(GLOBAL_RETURNS_DATA));
    renderDailyAvgChart(computeDailyAverages(GLOBAL_RETURNS_DATA));
    renderWeekdayAvgChart(computeWeekdayAverages(GLOBAL_RETURNS_DATA));

    const rSquared = renderCumulativePnLChart(GLOBAL_RETURNS_DATA);
    const stats = computeCumulativeStats(GLOBAL_RETURNS_DATA);
    const risk = computeRiskMetrics(GLOBAL_RETURNS_DATA);
    const risk2 = computeRiskMetrics2(GLOBAL_RETURNS_DATA);
    // Calmar = Annual Return / |Max Drawdown|
    risk.calmar =
        stats.maxDrawdown !== 0
            ? risk.annualReturn / Math.abs(stats.maxDrawdown)
            : 0;

    risk.sharpe.toFixed(1);
    risk.calmar.toFixed(1);

    risk.sortino = risk2.sortino;
    risk.rsq = rSquared;

    risk.sortino.toFixed(1);
    risk.hitRate = risk2.hitRate;


    renderKPIs(stats);
    renderRiskKPIs(risk);
}

/* ================================
   Boot
================================ */
loadHeatmap();
