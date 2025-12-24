// =====================================================
//  GLOBAL VARIABLES
// =====================================================
let chart2 = null;
let chartCum = null;

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
//  STACKING LOGIC
// =====================================================
function updateStacking() {
    if (!chart2) return;

    const pnlVisible = chart2?.w?.globals?.seriesNames.includes("P/L vs Invested") &&
        chart2?.w?.globals?.seriesToggleState?.["P/L vs Invested"] !== false;

    chart2.updateOptions({
        chart: { stacked: pnlVisible }
    }, false, true);
}

function sma(data, period = 12) {
  return data.map((v, i, arr) => {
    if (i < period) return undefined;
    const slice = arr.slice(i - period, i);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function linearTrend(series) {
    // series = [[ts, value], ...]
    const n = series.length;
    if (n < 2) return [];

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = i;
        const y = series[i][1];
        sumX  += x;
        sumY  += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return series.map((p, i) => [
        p[0],                 // timestamp
        slope * i + intercept // fitted value
    ]);
}

function cumulativeSum(series) {
    let total = 0;
    return series.map(([ts, v]) => {
        total += v;
        return [ts, total];
    });
}

// =====================================================
//  MAIN CHART LOADER
// =====================================================
window.loadMainChart = function(days) {
    fetch(`/api/interest/oi?days=${days}`)
        .then(r => r.json())
        .then(data => {

            // raw series (÷100 applied here)
            // normalize API rows → arrays
            const timestamps = data.map(r => r.timestamp_utc);
            const oiValues   = data.map(r => r.oi_chg_24h / 100);

            // raw series
            const oiSeries = safePairs(timestamps, oiValues);

            // cumulative series
            const oiCumSeries = cumulativeSum(oiSeries);
            

            /* ================= FIRST CHART ================= */

            if (chart2) chart2.destroy();

            chart2 = new ApexCharts(
                document.getElementById("totalInvestmentsStats"),
                {
                    chart: {
                        height: 720,
                        type: "area",
                        toolbar: { show: false },
                        zoom: { autoScaleYaxis: true }
                    },
                    series: [{
                        name: "OI Change (24h)",
                        data: oiSeries
                    }],
                    fill: {
                        gradient: {
                            colors: ["#02f59d"],
                            shade: "dark",
                            type: "vertical",
                            opacityFrom: 0.5,
                            opacityTo: 0.05
                        }
                    },
                    stroke: { curve: "smooth", width: 2 },
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
            chart2.render();

            /* ================= SECOND (CUMULATIVE) CHART ================= */

            if (chartCum) chartCum.destroy();

            chartCum = new ApexCharts(
                document.getElementById("oiCumulativeChart"),
                {
                    chart: {
                        height: 500,
                        type: "area",
                        toolbar: { show: false },
                        zoom: { autoScaleYaxis: true }
                    },
                    series: [{
                        name: "Cumulative OI Change",
                        data: oiCumSeries
                    }],
                    fill: {
                        gradient: {
                            colors: ["#22c55e"],
                            shade: "dark",
                            type: "vertical",
                            opacityFrom: 0.5,
                            opacityTo: 0.05
                        }
                    },
                    stroke: { curve: "smooth", width: 2 },
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
            chartCum.render();
        });
};

// =====================================================
//  RANGE BUTTON LOGIC
// =====================================================
document.querySelectorAll(".btn-group button").forEach(btn => {
    btn.addEventListener("click", function () {

        document.querySelectorAll(".btn-group button").forEach(b => {
            b.classList.remove("btn-primary");
            b.classList.add("btn-primary-light");
        });

        this.classList.add("btn-primary");
        this.classList.remove("btn-primary-light");

        let label = this.textContent.trim();


        if (label === "1D") loadMainChart(1);
        else if (label === "3D") loadMainChart(3);
        else if (label === "1W") loadMainChart(7);
        else if (label === "1M") loadMainChart(30);
        else if (label === "3M") loadMainChart(90);
        else if (label === "6M") loadMainChart(180);
        else if (label === "1Y") loadMainChart(365);
    });
});

loadMainChart(30);



// =====================================================
//  KPI LOADER (UPDATED WITH TOTAL RETURN KPI)
// =====================================================
function loadKPIs() {

    function formatDollarChange(v) {
        if (v === null || v === undefined) return "--";

        const absVal = Math.abs(v).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        if (v > 0) {
            return `<span class="text-success" style="font-weight:400">+$${absVal}</span>`;
        } else if (v < 0) {
            return `<span class="text-danger" style="font-weight:400">-$${absVal}</span>`;
        }
        return `<span class="text-muted" style="font-weight:400">$0.00</span>`;
    }

    fetch("/kpis")
        .then(r => r.json())
        .then(k => {

            document.getElementById("kpi-runtime").innerText =
                k.runtime_days + " days";

            document.getElementById("kpi-dpr").innerHTML =
                k.dpr_pct !== null
                ? `<span class="${k.dpr_pct >= 0 ? "text-success" : "text-danger"}" style="font-weight:400">
                        ${k.dpr_pct.toFixed(1)}%
                   </span>`
                : "--";

            document.getElementById("kpi-wpr").innerHTML =
                k.wpr_pct !== null
                ? `<span class="${k.wpr_pct >= 0 ? "text-success" : "text-danger"}" style="font-weight:400">
                        ${k.wpr_pct.toFixed(1)}%
                   </span>`
                : "--";

            document.getElementById("kpi-mpr").innerHTML =
                k.wpr_pct !== null
                ? `<span class="${k.wpr_pct >= 0 ? "text-success" : "text-danger"}" style="font-weight:400">
                        ${k.mpr_pct.toFixed(1)}%
                   </span>`
                : "--";

            // document.getElementById("kpi-maxdd").innerHTML =
            //     k.max_dd_pct !== null
            //     ? `<span class="text-danger" style="font-weight:400">
            //             -${Math.abs(k.lowest_daily_return).toFixed(2)}%
            //        </span>`
            //     : "--";

            document.getElementById("kpi-week").innerHTML =
                formatDollarChange(k.rtw_dollars);

            document.getElementById("kpi-month").innerHTML =
                formatDollarChange(k.rtm_dollars);

            if (k.eff_total_return_pct !== null && k.eff_total_return_pct !== undefined) {
                let tr = k.eff_total_return_pct;
                let abs = Math.abs(tr).toFixed(1);
                let sign = tr >= 0 ? "+" : "-";
                let cls = tr >= 0 ? "text-success" : "text-danger";

                document.getElementById("kpi-total-return-rate").innerHTML = `
                    <span class="${cls}" style="font-weight:400">
                        ${sign}${abs}%
                    </span>
                `;
            }

            if (k.eff_total_return !== null && k.eff_total_return !== undefined) {
                let tr = k.eff_total_return;

                // Round to 2 decimals, then convert to comma format
                let abs = Number(Math.abs(tr).toFixed(2)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });

                let sign = tr >= 0 ? "+" : "-";
                let cls = tr >= 0 ? "text-success" : "text-danger";

                document.getElementById("kpi-total-return").innerHTML = `
                    <span class="${cls}" style="font-weight:400">
                        ${sign}$${abs}
                    </span>
                `;
            }
        });
}



// =====================================================
//  EARNINGS CHART
// =====================================================
document.addEventListener("DOMContentLoaded", function () {
    const labelsEl = document.getElementById("earnings-labels");
    const valuesEl = document.getElementById("earnings-values");

    if (!labelsEl || !valuesEl) return;

    const rawLabels = JSON.parse(labelsEl.dataset.json);
    const earningsValues = JSON.parse(valuesEl.dataset.json);

    const dayInitial = (str) =>
        new Date(str + " 2024")
            .toLocaleDateString("en-US", { weekday: "short" })[0];

    const earningsLabels = rawLabels.map(dayInitial);

    const element = document.getElementById("earnings");

    if (element) {
        new ApexCharts(element, {
            series: [{ name: "Daily Earnings", data: earningsValues }],
            chart: { type: "bar", height: 250, toolbar: { show: false }},
            colors: earningsValues.map((v, i) =>
                i === earningsValues.length - 1
                ? "rgb(132, 90, 223)"
                : "rgba(132, 90, 223, 0.25)"
            ),
            plotOptions: {
                bar: { columnWidth: "50%", borderRadius: 6, distributed: true }
            },
            dataLabels: { enabled: false },
            legend: { show: false },

            xaxis: {
                categories: earningsLabels,
                axisTicks: { show: false },
                axisBorder: { show: false },
                labels: { style: { colors: "#ccc", fontSize: "12px" } }
            },

            yaxis: {
                labels: {
                    formatter: (v) => {
                        const sign = v < 0 ? "-" : "";
                        const abs = Math.abs(v);
                        return abs >= 1000
                            ? `${sign}$${(abs/1000).toFixed(0)}k`
                            : `${sign}$${abs.toFixed(0)}`;
                    },
                    style: { colors: "#999", fontSize: "11px" }
                }
            },

            grid: {
                borderColor: "rgba(255,255,255,0.08)",
                strokeDashArray: 4
            },

            tooltip: {
                y: { formatter: (v) => "$" + v.toLocaleString() }
            }
        }).render();
    }
});


// =====================================================
//  DAILY CLOSES TABLE
// =====================================================
function loadDailyClosesTable() {
    fetch("/api/daily_closes_full")
        .then(r => r.json())
        .then(rows => {

            const tbody = document.getElementById("daily-closes-body");
            tbody.innerHTML = "";

            const fmtMoney = (v) => {
                const r = Math.round(v);
                const abs = Math.abs(r).toLocaleString();
                return r < 0 ? `-$${abs}` : `$${abs}`;
            };

            const fmtPct = (v) => {
                const pct = v.toFixed(1) + "%";
                if (v > 0) return `<span class="text-success"><i class="ti ti-arrow-narrow-up"></i> ${pct}</span>`;
                if (v < 0) return `<span class="text-danger"><i class="ti ti-arrow-narrow-down"></i> ${pct}</span>`;
                return `<span class="text-muted">${pct}</span>`;
            };

            const fmtPctMuted = (v) => {
                const pct = v.toFixed(1) + "%";
                if (v > 0) return `<span><i class="ti ti-arrow-narrow-up"></i> ${pct}</span>`;
                if (v < 0) return `<span><i class="ti ti-arrow-narrow-down"></i> ${pct}</span>`;
                return `<span class="text-muted">${pct}</span>`;
            };

            const last14 = rows.slice(-14);

            let sumReturn = 0, sumPnL = 0, sumcumROI = 0, sumcumReturn = 0;

            last14.forEach(r => {
                sumReturn += r.return_usd;
                sumPnL += r.cum_pnl_usd;
                sumcumROI += r.roi_pct;
                sumcumReturn += r.cum_pnl_pct;

                tbody.innerHTML += `
                    <tr>
                        <td>${r.date}</td>
                        <td>${fmtMoney(r.start_balance)}</td>
                        <td>${fmtMoney(r.close_balance)}</td>
                        <td>${fmtMoney(r.return_usd)}</td>
                        <td>${fmtMoney(r.cum_pnl_usd)}</td>
                        <td>${fmtPctMuted(r.roi_pct)}</td>
                        <td>${fmtPct(r.cum_pnl_pct)}</td>
                    </tr>
                `;
            });

            const avgReturn = Math.round(sumReturn / last14.length);
            const avgPnL = Math.round(sumPnL / last14.length);
            const avgCumRoi = (sumcumROI / last14.length).toFixed(2);
            const avgCumReturn = (sumcumReturn / last14.length).toFixed(2);

            tbody.innerHTML += `
                <tr style="background: rgba(255,255,255,0.03)">
                    <td><strong> Daily Average:</strong></td>
                    <td></td>
                    <td></td>
                    <td><strong>${fmtMoney(avgReturn)}</strong></td>
                    <td><strong>${fmtMoney(avgPnL)}</strong></td>
                    <td><strong>${avgCumRoi}%</strong></td>
                    <td><strong>${avgCumReturn}%</strong></td>
                </tr>
            `;
        });
}



// =====================================================
//  PORTFOLIO STATS TABLE
// =====================================================




const equityWrapper = document.getElementById("fund-equity-wrapper");


function rollingAverage(values, window = 5) {
    return values.map((_, i) => {
        if (i < window - 1) return null;
        const slice = values.slice(i - window + 1, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / window;
        return Math.round(avg * 100) / 100;
    });
}

// ===============================
// FUND COLORS
// ===============================
const FUND_COLORS = {
    ALPHA: "#7c3aed", // purple
    BETA:  "#2563eb", // blue
    GAMMA: "#16a34a"  // green
};

// ===============================
// INIT CHART (ONCE)
// ===============================
let equityChart = new ApexCharts(
    document.querySelector("#fund-equity-chart"),
    {
        chart: {
            height: 260,
            type: "line",
            toolbar: { show: false },
            animations: { enabled: true }
        },
        series: [],
        stroke: {
            width: [0, 3],
            curve: "smooth",
            dashArray: [0, 5] // dashed SMA
        },
        markers: { size: 0 },
        xaxis: {
            categories: [],
            labels: { show: false }
        },
        yaxis: {
            labels: {
                formatter: v => "$" + v.toLocaleString()
            }
        },
        grid: {
            strokeDashArray: 3,
            borderColor: "rgba(255,255,255,0.08)"
        },
        colors: ["#5e76ff", "#5e76ff80"], // will be overridden per fund
        plotOptions: {
            bar: {
                columnWidth: "55%",
                borderRadius: 3
            }
        },
        tooltip: {
            shared: true,
            y: {
                formatter: v => (v != null ? "$" + v.toLocaleString() : "—")
            }
        },
        legend: {
            labels: { colors: "#ccc" }
        }
    }
);

equityChart.render();

// ===============================
// TAB HANDLER
// ===============================
document.querySelectorAll('[data-fund]').forEach(tab => {
    tab.addEventListener("shown.bs.tab", async (e) => {
        const fund = e.target.dataset.fund.toUpperCase();
        const paneId = e.target.getAttribute("href");
        const fundColor = FUND_COLORS[fund] || "#5e76ff";

        // ===============================
        // SHOW / HIDE EQUITY CHART
        // ===============================
        if (fund === "OVERVIEW") {
            equityWrapper.style.display = "none";
            return; // ⛔ do not render chart
        } else {
            equityWrapper.style.display = "block";
        }

        const table = document
            .querySelector(paneId)
            .querySelector("table");

        // Apply fund accent styling
        table.classList.add("fund-accent");
        table.style.setProperty("--fund-color", fundColor);

        const tbody = document
            .querySelector(paneId)
            .querySelector(".fund-table-body");

        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted">
                    Loading ${fund}…
                </td>
            </tr>
        `;

        const res = await fetch(`/api/fund/${fund}/daily`);
        const rows = await res.json();

        // ===============================
        // CHART DATA
        // ===============================
        const labels = rows.map(r => r.snapshot_date).reverse();
        const equity = rows.map(r => Number(r.equity_after)).reverse();
        const equityTrend = rollingAverage(equity, 5);

        // Update axes + colors
        equityChart.updateOptions({
            xaxis: { categories: labels },
            colors: [
                fundColor,
                `${fundColor}80`
            ]
        });

        // Update series
        equityChart.updateSeries([
            {
                name: "Equity",
                type: "bar",
                data: equity
            },
            {
                name: "Trend (5D)",
                type: "line",
                data: equityTrend
            }
        ], true);

        // Ensure correct sizing after tab visibility
        setTimeout(() => {
            equityChart.resize();
        }, 50);

        // ===============================
        // TABLE RENDER
        // ===============================
        tbody.innerHTML = "";

        rows.forEach(r => {
            const pnlClass =
                r.pnl > 0 ? "text-success" :
                r.pnl < 0 ? "text-danger" :
                "text-muted";

            const retClass =
                r.total_return > 0 ? "text-success" :
                r.total_return < 0 ? "text-danger" :
                "text-muted";

            const darClass =
                r.dar > 0 ? "text-success" :
                r.dar < 0 ? "text-danger" :
                "text-muted";

            tbody.insertAdjacentHTML("beforeend", `
                <tr>
                    <td>${r.snapshot_date}</td>
                    <td>$${Number(r.equity_before).toLocaleString()}</td>
                    <td>$${Number(r.invested_margin).toLocaleString()}</td>
                    <td class="${pnlClass}">
                        ${r.pnl >= 0 ? "+" : ""}$${Number(r.pnl).toLocaleString()}
                    </td>
                    <td>$${Number(r.cum_pnl).toLocaleString()}</td>
                    <td class="${retClass}">
                        ${(r.total_return * 100).toFixed(2)}%
                    </td>
                    <td>$${Number(r.equity_after).toLocaleString()}</td>
                    <td>$${Number(r.trade_bal).toLocaleString()}</td>
                    <td>$${Number(r.profit_bal).toLocaleString()}</td>
                    <td class="${darClass}">
                        ${(r.dar * 100).toFixed(2)}%
                    </td>
                </tr>
            `);
        });
    });
});


import { computePositionStats, fmtUSD, fmtPct, fmtUSDreg, fmtUSDshort} from "./positions_shared.js";

async function loadHomePortfolio() {
  const tbody = document.getElementById("home-portfolio-body");

  tbody.innerHTML = "";


  if (!tbody) return;


  const res = await fetch("/api/positions");
  const positions = await res.json();

  if (!positions.length) {
    tbody.innerHTML = `<tr><td colspan="4"> No open positions</td></tr>`;
    return;
  }

  const stats = computePositionStats(positions);
  console.log("computePositionStats output:", stats);

  // ================================
  // HOME PORTFOLIO KPIs
  // ================================

  const elBalance = document.getElementById("home-open");
  const elMargin  = document.getElementById("home-margin");
  const elUsed    = document.getElementById("home-pnl-perc");
  const elPnl     = document.getElementById("home-pnl-usd");

  // Open positions count
  if (elBalance) {
    elBalance.textContent = stats.count + "/15";
  }

  // Total margin
  if (elMargin) {
    elMargin.textContent = fmtUSDshort(stats.totalMargin);
  }

  // Margin used % (PnL ÷ Margin is NOT correct here — use exposure later if needed)
  if (elUsed) {
    elUsed.textContent = fmtPct((stats.totalPnl*100) / stats.totalMargin) ;
  }

  // Total unrealized PnL
  if (elPnl) {
    elPnl.textContent = fmtUSD(stats.totalPnl);
  }

  if (!stats || !Array.isArray(stats.rows)) {
    console.warn("No portfolio rows to render");
    return;
  }

  stats.rows
    .sort((a, b) => b.pnl - a.pnl)
    .forEach(r => {
      const cls = r.pnl >= 0 ? "text-success" : "text-danger";

      const marginPct = stats.totalMargin
        ? (r.margin / stats.totalMargin) * 100
        : 0;

      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${r.symbol} </td>
          <td class="${cls}">${fmtUSD(r.pnl)}</td>
          <td class="${cls}">${fmtPct(r.pnlPct)}</td>
          <td>${marginPct.toFixed(1)}%</td>
        </tr>
      `);
    });
};


// loadKPIs();
// loadDailyClosesTable();
// loadHomePortfolio();




async function loadInterestKPIs() {
    const res = await fetch("/api/interest/kpis");
    const d = await res.json();

    if (!d) return;

    const set = (id, val, {
        isPct = true,
        divide100 = false,
        decimals = 2
    } = {}) => {

        const el = document.getElementById(id);
        if (!el || val == null) return;

        let num = Number(val);
        if (divide100) num = num / 100;

        const cls =
            num > 0 ? "text-success" :
            num < 0 ? "text-danger" :
                      "text-muted";

        el.classList.remove("text-success","text-danger","text-muted");
        el.classList.add(cls);

        el.textContent = isPct
            ? `${num > 0 ? "+" : ""}${(num * 100).toFixed(decimals)}%`
            : num.toFixed(decimals);
    };

    // Price change (÷100)
    set("kpi-chg-24h", d.chg_24h, {
        divide100: true
    });

    // OI change (÷100)
    set("kpi-oi-chg-24h", d.oi_chg_24h, {
        divide100: true
    });

    // Funding rate (RAW)
    set("kpi-fr-avg", d.fr_avg, {
        isPct: true,
        decimals: 4
    });

    // OI momentum (÷100)
    set("kpi-pc-oi", d.pc_oi_1_1d, {
        divide100: true
    });
}


loadInterestKPIs();
