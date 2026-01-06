// Mullin Technologies
// ----------------------------------------------------
// Gamma LTV Equity chart + linear regression trend
// + Upper / Lower statistical limits
// + Daily performance table renderer (weekly collapsible)
// + Comparative KPIs
// + Channel / Regime KPI block
// ----------------------------------------------------

let gammaChart = null;

/* ================================
   Math helpers
================================ */

function linearRegression(y) {
    const n = y.length;
    const x = Array.from({ length: n }, (_, i) => i + 1);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return x.map(xi => slope * xi + intercept);
}

function stdDev(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(
        arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length
    );
}

function rollingSMA(values, window = 5) {
    return values.map((_, i) => {
        if (i < window - 1) return null;
        const slice = values.slice(i - window + 1, i + 1);
        return slice.reduce((a, b) => a + b, 0) / window;
    });
}

function endOfCurrentMonthUTC(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0
  ));
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/* ================================
   Formatting helpers
================================ */
function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  if (value === null || value === undefined || Number.isNaN(value)) {
    el.textContent = "—";
    return;
  }

  el.textContent = value;
}

function setTextSafe(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  if (value === null || value === undefined || Number.isNaN(value)) {
    el.textContent = "—";
    return;
  }

  el.textContent = value;
}

function fmtPct(v, signed = true) {
    if (!Number.isFinite(v)) return "—";
    return `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function formatShortDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function isoWeek(dateStr) {
    const d = new Date(dateStr);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function fmtPctUnsigned(v) {
  if (!Number.isFinite(v)) return "—";
  return (v * 100).toFixed(2) + "%"; // v is decimal return
}

function darClass(v) {
  if (!Number.isFinite(v)) return "text-muted";
  if (v > 0) return "text-success";
  if (v < 0) return "text-danger";
  return "text-muted";
}

function alphaFmt(assetRet, fundRet) {
  const a = fundRet - assetRet;
  const cls = a >= 0 ? "text-success" : "text-danger";
  return `<span class="${cls}">Δ ${a.toFixed(2)}%</span>`;
}

function alphaBadge(assetRet, fundRet) {
  if (!Number.isFinite(assetRet) || !Number.isFinite(fundRet)) return "";

  const alpha = fundRet - assetRet;
  const cls = alpha >= 0 ? "alpha-pos" : "alpha-neg";
  const sign = alpha >= 0 ? "+" : "";

  return `
    <span class="alpha-badge ${cls}">
      ${sign}${alpha.toFixed(2)}%
    </span>
  `;
}

/* ================================
   ApexCharts init
================================ */
gammaChart = new ApexCharts(
    document.querySelector("#gamma-ltv-chart"),
    {
        chart: { height: 600, toolbar: { show: false } },
        series: [],
        stroke: {
            width: [0,3,2,2,2],
            curve: "smooth",
            dashArray: [0,0,10,6,6]
        },
        markers: { size: 0 },
        colors: ["#22c55e","#bbf7d0","#3b82f6","#d946ef","#22d3ee"],
        fill: { opacity: [0.7,1,1,1,1] },
        xaxis: { categories: [], labels: { show: false } },
        yaxis: {
          title: {
            text: "Cumulative Fund Return (%)",
            style: { color: "#aaa" }
          },
          labels: {
            formatter: v => `${v.toFixed(1)}%`
          }
        },
        grid: { borderColor: "rgba(255,255,255,0.08)", strokeDashArray: 3 },
        tooltip: {
  shared: true,
  y: {
    formatter: v =>
      (v === null || v === undefined || Number.isNaN(v))
        ? "—"
        : `${v.toFixed(2)}%`
  }
},
        legend: { labels: { colors: "#ccc" } }
    }
);
gammaChart.render();

/* ================================
   Load everything
================================ */
(async function loadGammaLTV() {
  const res = await fetch("/api/gamma/ltv");
  const rows = await res.json();

  /* =====================================================
     CORE SERIES (REAL DATA ONLY)
  ===================================================== */
  const baseLabels = rows.map(r => r.snapshot_date);

  const equityRaw = rows.map(r => Number(r.equity_0pct_reinv));
  const baseEquity = equityRaw.find(v => Number.isFinite(v));

  const equity = equityRaw.map(v =>
    baseEquity > 0 ? ((v / baseEquity) - 1) * 100 : 0
  );

  const sma5 = rollingSMA(equity, 5);

  /* =====================================================
     PROJECTION WINDOW (TO MONTH END)
  ===================================================== */
  const lastDate = new Date(baseLabels[baseLabels.length - 1]);
  const endMonth = endOfCurrentMonthUTC(lastDate);

  const futureDates = [];
  let d = addDaysUTC(lastDate, 1);
  while (d <= endMonth) {
    futureDates.push(d.toISOString().slice(0, 10));
    d = addDaysUTC(d, 1);
  }

  const labels = baseLabels.concat(futureDates);
  const totalLen = labels.length;

  /* =====================================================
     LINEAR REGRESSION (IN-SAMPLE ONLY)
  ===================================================== */
  const n = equity.length;
  const x = Array.from({ length: n }, (_, i) => i + 1);

  const sumX  = x.reduce((a,b)=>a+b,0);
  const sumY  = equity.reduce((a,b)=>a+b,0);
  const sumXY = equity.reduce((s,y,i)=>s + (i+1)*y,0);
  const sumX2 = x.reduce((s,xi)=>s + xi*xi,0);

  const slope =
    (n * sumXY - sumX * sumY) /
    (n * sumX2 - sumX * sumX);

  const intercept = (sumY - slope * sumX) / n;

  const trend = Array.from(
    { length: totalLen },
    (_, i) => slope * (i + 1) + intercept
  );

  /* =====================================================
     CHANNEL (σ FROM REAL DATA ONLY)
  ===================================================== */
  const residuals = equity.map(
    (v, i) => v - (slope * (i + 1) + intercept)
  );

  const sigma = stdDev(residuals);
  const K = 1.8;

  const upper = trend.map(v => v + K * sigma);
  const lower = trend.map(v => v - K * sigma);

  /* =====================================================
     PAD NON-REAL SERIES
  ===================================================== */
  const pad = Array(futureDates.length).fill(null);

  const equityExt = equity.concat(pad);
  const smaExt = sma5.concat(pad);

  /* =====================================================
     CHART UPDATE
  ===================================================== */
  const yMax = upper[upper.length - 1] * 1.03;

  gammaChart.updateOptions({
    xaxis: { categories: labels },
    yaxis: {
      min: 0,
      max: yMax,
      title: { text: "Cumulative Fund Return (%)", style: { color: "#aaa" } },
      labels: { formatter: v => `${v.toFixed(1)}%` }
    },
    tooltip: {
      shared: true,
      y: {
        formatter: v =>
          (v === null || v === undefined || Number.isNaN(v))
            ? "—"
            : `${v.toFixed(2)}%`
      }
    }
  });

  gammaChart.updateSeries([
    { name: "Equity", type: "bar", data: equityExt },
    { name: "Trendline (LR)", type: "line", data: trend },
    { name: "5D SMA", type: "line", data: smaExt },
    { name: "Upper Limit", type: "line", data: upper },
    { name: "Lower Limit", type: "line", data: lower }
  ]);

    // gammaChart.updateSeries([
    //     { name: "Equity", type: "bar", data: equity },
    //     { name: "Trendline (LR)", type: "line", data: trend },
    //     { name: "5D SMA", type: "line", data: sma5 },
    //     { name: "Upper Limit", type: "line", data: upper },
    //     { name: "Lower Limit", type: "line", data: lower }
    // ]);

    /* ================= KPI LOGIC (FIXED) ================= */

    // ---- RAW equity (levels)
    const equityLevel = equityRaw.filter(v => Number.isFinite(v));
    const startEquity = equityLevel[0];
    const endEquity = equityLevel[equityLevel.length - 1];

    // --- Total days in sample
    const totalDays = equityLevel.length;

    // --- Fund return (%)
    const fundReturn = ((endEquity / startEquity) - 1) * 100;

    // --- Daily returns (log-safe)
    const dailyReturns = [];
    for (let i = 1; i < equityLevel.length; i++) {
      const prev = equityLevel[i - 1];
      const cur = equityLevel[i];
      if (prev > 0 && cur > 0) {
        dailyReturns.push((cur / prev) - 1);
      }
    }

    // --- Daily returns (raw)
    const equity_gamma = rows.map(r => (r.equity_0pct_reinv));
    const dailyReturnsRaw = [];
    for (let i = 1; i < equity_gamma.length; i++) {
      const prev = equity_gamma[i - 1];
      const cur = equity_gamma[i];
      if (prev > 0 && cur > 0) {
        dailyReturnsRaw.push((cur / prev) - 1);
      }
    }
    // --- Sharpe (annualized)
    const mean = dailyReturnsRaw.reduce((a,b)=>a+b,0) / dailyReturnsRaw.length;
    const std = stdDev(dailyReturnsRaw);
    const sharpe = std ? (mean / std) * Math.sqrt(365) : null;


    // --- CAGR
    const days = equity.length;
    const years = days / 365;

    const cagr = (startEquity > 0 && endEquity > 0 && years > 0)
      ? (Math.pow(endEquity / startEquity, 1 / years) - 1)
      : null;

    // --- SORTINO
    const downsideReturns = dailyReturns.filter(r => r < 0);

    let sortino = null;
    if (downsideReturns.length > 1) {
        const downsideStd = stdDev(downsideReturns);
        const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;

        if (downsideStd > 0) {
            sortino = (meanReturn / downsideStd) * Math.sqrt(365);
        }
    }

    // --- Max drawdown (correct)
    let peak = equityLevel[0];
    let maxDD = 0;

    for (const v of equityLevel) {
      peak = Math.max(peak, v);
      const dd = (v / peak - 1) * 100;
      maxDD = Math.min(maxDD, dd);
    }

    // ==============================
    // ADVANCED RISK / QUALITY METRICS
    // ==============================

    // --- Win / Loss breakdown
    let wins = 0, losses = 0;
    let gainSum = 0, lossSum = 0;

    dailyReturns.forEach(r => {
      if (r > 0) {
        wins++;
        gainSum += r;
      } else if (r < 0) {
        losses++;
        lossSum += Math.abs(r);
      }
    });

    const totalTrades = wins + losses;

    // Win rate
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : null;

    // Avg win / loss
    const avgWin  = wins > 0 ? gainSum / wins : null;
    const avgLoss = losses > 0 ? lossSum / losses : null;

    // --- Average daily return
    const avgDay =
      dailyReturns.length > 0
        ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
        : null;

    // Profit factor
    const profitFactor = lossSum > 0 ? gainSum / lossSum : null;


    // ------------------------------
    // CALMAR RATIO
    // ------------------------------
    const calmar = maxDD !== 0
      ? Math.abs((fundReturn / maxDD))
      : null;


    // ------------------------------
    // ULCER INDEX
    // ------------------------------
    let peakEq = equityLevel[0];
    let sumSqDD = 0;

    for (const v of equityLevel) {
      peakEq = Math.max(peakEq, v);
      const ddPct = ((v - peakEq) / peakEq) * 100;
      sumSqDD += ddPct * ddPct;
    }

    const ulcerIndex = Math.sqrt(sumSqDD / equityLevel.length);


    // ------------------------------
    // OPTIONAL: Omega Ratio (bonus)
    // ------------------------------
    const threshold = 0; // break-even
    let gainsAbove = 0;
    let lossesBelow = 0;

    dailyReturns.forEach(r => {
      if (r > threshold) gainsAbove += (r - threshold);
      else lossesBelow += (threshold - r);
    });

    const omega = lossesBelow > 0 ? gainsAbove / lossesBelow : null;






    // =====================
    // MARKET COMPARISONS
    // =====================
    const returns_resp = await fetch("/api/market/returns?start=2025-09-22");
    const ret_data = await returns_resp.json();

    const btcRet  = Number(ret_data.BTC);
    const ethRet  = Number(ret_data.ETH);
    const solRet  = Number(ret_data.SOL);
    const xrpRet  = Number(ret_data.XRP);
    const bnbRet  = Number(ret_data.BNB);

    const dxyRet  = Number(ret_data.DXY);
    const spyRet  = Number(ret_data.SPY);
    const qqqRet  = Number(ret_data.QQQ);
    const goldRet = Number(ret_data.GOLD);
    const xagRet  = Number(ret_data.XAG);

    const nvdaRet = Number(ret_data.NVDA);
    const aaplRet = Number(ret_data.AAPL);
    const tslaRet = Number(ret_data.TSLA);
    const amznRet = Number(ret_data.AMZN);
    const pltrRet = Number(ret_data.PLTR);

    // Core performance
    setText("cmp-total-days", totalDays.toLocaleString());
    setText("cmp-calmar", calmar ? calmar.toFixed(2) : "—");
    setText("cmp-profit-factor", profitFactor ? profitFactor.toFixed(2) : "—");
    setText("cmp-winrate", winRate !== null ? winRate.toFixed(1) + "%" : "—");

    setText("cmp-avg-day", avgDay !== null ? fmtPct(avgDay * 100) : "—");
    setText("cmp-avg-win", avgWin !== null ? fmtPct(avgWin * 100) : "—");
    setText("cmp-avg-loss", avgLoss !== null ? fmtPct(-avgLoss * 100) : "—");
    setText("cmp-ulcer", ulcerIndex.toFixed(2));

    // Optional advanced metric
    if (omega !== null) {
      setText("cmp-omega", omega.toFixed(2));
    }

    // ---- UI updates
    setText("cmp-fund-ret", fmtPct(fundReturn));
    setText("cmp-cagr", cagr !== null ? fmtPct(cagr * 100) : "—");
    setText("cmp-sortino", sortino !== null ? sortino.toFixed(2) : "—");

    document.getElementById("cmp-btc-ret").innerHTML =
      `${fmtPct(btcRet)} ${alphaBadge(btcRet, fundReturn)}`;

    document.getElementById("cmp-eth-ret").innerHTML =
      `${fmtPct(ethRet)} ${alphaBadge(ethRet, fundReturn)}`;

    document.getElementById("cmp-sol-ret").innerHTML =
      `${fmtPct(solRet)} ${alphaBadge(solRet, fundReturn)}`;

    document.getElementById("cmp-xrp-ret").innerHTML =
      `${fmtPct(xrpRet)} ${alphaBadge(xrpRet, fundReturn)}`;

    document.getElementById("cmp-bnb-ret").innerHTML =
      `${fmtPct(bnbRet)} ${alphaBadge(bnbRet, fundReturn)}`;

    document.getElementById("cmp-dxy-ret").innerHTML =
      `${fmtPct(dxyRet)} ${alphaBadge(dxyRet, fundReturn)}`;

    document.getElementById("cmp-spy-ret").innerHTML =
      `${fmtPct(spyRet)} ${alphaBadge(spyRet, fundReturn)}`;

    document.getElementById("cmp-qqq-ret").innerHTML =
      `${fmtPct(qqqRet)} ${alphaBadge(qqqRet, fundReturn)}`;

    document.getElementById("cmp-gold-ret").innerHTML =
      `${fmtPct(goldRet)} ${alphaBadge(goldRet, fundReturn)}`;

    document.getElementById("cmp-xag-ret").innerHTML =
      `${fmtPct(xagRet)} ${alphaBadge(xagRet, fundReturn)}`;

    document.getElementById("cmp-nvda-ret").innerHTML =
      `${fmtPct(nvdaRet)} ${alphaBadge(nvdaRet, fundReturn)}`;

    document.getElementById("cmp-aapl-ret").innerHTML =
      `${fmtPct(aaplRet)} ${alphaBadge(aaplRet, fundReturn)}`;

    document.getElementById("cmp-tsla-ret").innerHTML =
      `${fmtPct(tslaRet)} ${alphaBadge(tslaRet, fundReturn)}`;

    document.getElementById("cmp-amzn-ret").innerHTML =
      `${fmtPct(amznRet)} ${alphaBadge(amznRet, fundReturn)}`;

    document.getElementById("cmp-pltr-ret").innerHTML =
      `${fmtPct(pltrRet)} ${alphaBadge(pltrRet, fundReturn)}`;

    // --- Alpha vs BTC
    setText("cmp-alpha-btc", fmtPct(fundReturn - btcRet));

    // --- Risk metrics
    setText("cmp-sharpe", sharpe?.toFixed(2) ?? "—");
    setText("cmp-dd", fmtPct(maxDD));

    /* ---------- CHANNEL / REGIME ---------- */
    const last = equity[n-1];

    const channelPos = ((last - lower[n-1]) / (upper[n-1] - lower[n-1])) * 100;

    const monthlyTrend = slope * 100;

    const upside = ((upper[n-1] - last) / last) * 100;
    const downside = ((last - lower[n-1]) / last) * 100;

    const deviation = ((last - trend[n-1]) / trend[n-1]) * 100;
    const z = (last - trend[n-1]) / sigma;

    let regime = "Neutral";
    if (monthlyTrend > 5 && z > 0) regime = "Expansion";
    if (monthlyTrend < -5) regime = "Contraction";

    setText("kpi-channel-pos", channelPos.toFixed(1) + "%");
    setText("kpi-regime", regime);
    setText("kpi-trend-strength", monthlyTrend.toFixed(2) + "%");
    setText("kpi-volatility", (sigma / last * 100).toFixed(2) + "%");
    setText("kpi-upside", upside.toFixed(2) + "%");
    setText("kpi-downside", downside.toFixed(2) + "%");
    setText("kpi-deviation", fmtPct(deviation));
    setText("kpi-zscore", z.toFixed(2));

    /* =========================================================
       WEEKLY COLLAPSIBLE TABLE (FIXED HEADERS)
    ========================================================= */
    const tbody = document.querySelector("#gamma-ltv-table-body");
    tbody.innerHTML = "";

    const weeks = {};
    rows.forEach((r, i) => {
        const w = isoWeek(r.snapshot_date);
        weeks[w] ??= [];
        weeks[w].push({ ...r, idx: i + 1 });
    });

    const weekKeys = Object.keys(weeks).sort().reverse();

    weekKeys.forEach((wk, wi) => {
        const days = weeks[wk];
        const avgRoi = days.reduce((a,d)=>a+Number(d.total_return),0)/days.length*100;
        const pnl = days.reduce((a,d)=>a+Number(d.pnl),0);
        const finalEquity = Number(days[days.length - 1].equity_0pct_reinv);

        const open = wi < 1;

        const pnlClass =
            pnl > 0 ? "week-pos" :
            pnl < 0 ? "week-neg" :
                      "week-flat";

        tbody.insertAdjacentHTML("beforeend", `
        <tr class="table-secondary week-toggle ${pnlClass}"data-week="${wk}"data-pnl="${pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat"}">
            <td colspan="10">
               ${wk}
              &nbsp; Avg Daily ROI ${avgRoi.toFixed(2)}%
              · PnL $${pnl.toLocaleString()}
              · Final Equity $${finalEquity.toLocaleString()}
            </td>
          </tr>

          <tr class="week-child ${open ? "" : "d-none"}" data-week="${wk}">
            <th></th><th>Date</th><th>Start</th><th>Invested</th><th>End</th>
            <th>PnL</th><th>Cum PnL</th><th>ROI</th><th>Cum ROI</th><th>DAR</th>
          </tr>
        `);

        days.forEach(d => {
            tbody.insertAdjacentHTML("beforeend", `
              <tr class="week-child ${open ? "" : "d-none"}" data-week="${wk}">
                <td>${d.idx}</td>
                <td>${formatShortDate(d.snapshot_date)}</td>
                <td>$${Number(d.equity_before).toLocaleString()}</td>
                <td>$${Number(d.invested_margin).toLocaleString()}</td>
                <td>$${Number(d.equity_0pct_reinv).toLocaleString()}</td>
                <td class="${d.pnl>=0?"text-success":"text-danger"}">
                  ${d.pnl>=0?"+":""}$${Math.abs(d.pnl).toLocaleString()}
                </td>
                <td>$${Number(d.cum_pnl).toLocaleString()}</td>
                <td>${(Number(d.total_return)*100).toFixed(2)}%</td>
                <td class="${d.equity_0pct_reinv>=startEquity?"text-success":"text-danger"}">
                ${fmtPct(((d.equity_0pct_reinv/startEquity)-1)*100)}</td>
                <td>${fmtPct((((d.equity_0pct_reinv/startEquity)-1)*100)/d.idx,false)}</td>
              </tr>
            `);
        });
    });

    /* =========================================================
       WEEKLY + MONTHLY DAR TABLES
       DAR = (sum(total_return)) / (days)
    ========================================================= */

    // ---------- WEEKLY ----------
    const weeklyBody = document.querySelector("#gamma-weekly-dar-body");
    weeklyBody.innerHTML = "";

    const weeklyAgg = {};
    rows.forEach(r => {
      const wk = isoWeek(r.snapshot_date);
      weeklyAgg[wk] ??= { days: 0, total_return_sum: 0 };
      weeklyAgg[wk].days += 1;
      weeklyAgg[wk].total_return_sum += Number(r.total_return) || 0;
    });

    Object.keys(weeklyAgg).sort().reverse().forEach(wk => {
      const w = weeklyAgg[wk];
      const dar = w.days ? (w.total_return_sum / w.days) : null;

      const totalClass =
        w.total_return_sum > 0 ? "text-success" :
        w.total_return_sum < 0 ? "text-danger" :
        "";

      weeklyBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${wk}</td>
          <td>${w.days}</td>

          <!-- DAR (neutral) -->
          <td>${fmtPctUnsigned(dar)}</td>

          <!-- Total Return (colored) -->
          <td class="${totalClass}">
            ${fmtPctUnsigned(w.total_return_sum)}
          </td>
        </tr>
      `);
    });

    // ---------- MONTHLY ----------
    const monthlyBody = document.querySelector("#gamma-monthly-dar-body");
    monthlyBody.innerHTML = "";

    const monthlyAgg = {};
    rows.forEach(r => {
      const mk = monthKey(r.snapshot_date);
      monthlyAgg[mk] ??= { days: 0, total_return_sum: 0 };
      monthlyAgg[mk].days += 1;
      monthlyAgg[mk].total_return_sum += Number(r.total_return) || 0;
    });

    Object.keys(monthlyAgg).sort().reverse().forEach(mk => {
      const m = monthlyAgg[mk];
      const dar = m.days ? (m.total_return_sum / m.days) : null;

      const totalClass =
        m.total_return_sum > 0 ? "text-success" :
        m.total_return_sum < 0 ? "text-danger" :
        "";

      monthlyBody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${mk}</td>
          <td>${m.days}</td>

          <!-- DAR (neutral) -->
          <td>${fmtPctUnsigned(dar)}</td>

          <!-- Total Return (colored) -->
          <td class="${totalClass}">
            ${fmtPctUnsigned(m.total_return_sum)}
          </td>
        </tr>
      `);
    });


    // Weekly
    const weekly = extractTotalReturnFromTable("#gamma-weekly-dar-body");
    renderBarChart(
      "#weekly-bar-chart",
      weekly.labels,
      weekly.values,
      "Weekly Total Return"
    );

    // Monthly
    const monthly = extractTotalReturnFromTable("#gamma-monthly-dar-body");
    renderBarChart(
      "#monthly-bar-chart",
      monthly.labels,
      monthly.values,
      "Monthly Total Return"
    );

    tbody.addEventListener("click", e => {
        const row = e.target.closest(".week-toggle");
        if (!row) return;

        const wk = row.dataset.week;
        document.querySelectorAll(`.week-child[data-week="${wk}"]`)
            .forEach(r => r.classList.toggle("d-none"));
    });

})();


async function loadMarketChart() {
  const res = await fetch("/api/market/cumulative?start=2025-09-22");
  const data = await res.json();



  const COLORS = {
    BTC: "#f7931a",
    ETH: "#627eea",
    SOL: "#14f1a3",
    XRP: "#00aae4",
    BNB: "#f3ba2f",
    AAPL: "#60a5fa",
    NVDA: "#22c55e",
    TSLA: "#ef4444",
    AMZN: "#f97316",
    PLTR: "#8b5cf6",
    SPY: "#9ca3af",
    QQQ: "#6b7280",
    DXY: "#a78bfa",
    GOLD: "#facc15",
    XAG: "#C0C0C0",

  };

  function legendHeader(label) {
    return { name: `— ${label} —`, data: [], color: "transparent" };
  }

  const series = [
    legendHeader("Crypto"),
    ...["BTC","ETH","SOL","XRP","BNB"].filter(s => data[s]).map(sym => ({
      name: sym,
      data: data[sym],
      color: COLORS[sym]
    })),

    legendHeader("Equities"),
    ...["AAPL","NVDA","TSLA","AMZN","PLTR"].filter(s => data[s]).map(sym => ({
      name: sym,
      data: data[sym],
      color: COLORS[sym]
    })),

    legendHeader("Macros"),
    ...["SPY","QQQ","DXY","GOLD", "XAG"].filter(s => data[s]).map(sym => ({
      name: sym,
      data: data[sym],
      color: COLORS[sym]
    }))
  ];

  const options = {
    chart: {
      type: "area",
      height: 500,
      toolbar: { show: false },
      zoom: { enabled: false }
    },
    stroke: { width: 2, curve: "smooth" },
    fill: { opacity: 0.25 },
    xaxis: { type: "datetime" },
    yaxis: {
      title: { text: "Cumulative Return (%)", style: { color: "#aaa" } },
      labels: { formatter: v => `${v.toFixed(1)}%` }
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: v => `${v.toFixed(2)}%` }
    },
    legend: {
      position: "bottom",
      horizontalAlign: "center",
      fontSize: "12px",
      labels: { colors: "#bbb" },
      markers: { width: 10, height: 10, radius: 6 },
      itemMargin: { horizontal: 10, vertical: 6 }
    },
    grid: { borderColor: "rgba(255,255,255,0.08)" },
    dataLabels: { enabled: false }
  };

  const chart = new ApexCharts(
    document.querySelector("#market-chart"),
    { ...options, series }
  );

  await chart.render();

  // 👇 ONLY BTC visible at load
  Object.keys(data).forEach(sym => {
    if (sym !== "BTC") chart.hideSeries(sym);
  });
}

document.addEventListener("DOMContentLoaded", loadMarketChart);

function extractTotalReturnFromTable(tbodySelector) {
  const rows = document.querySelectorAll(`${tbodySelector} tr`);
  const labels = [];
  const values = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) return;

    const label = cells[0].innerText.trim();

    // column index 2 = "Total Return"
    const totalReturnText = cells[3].innerText.replace("%", "");

    const val = parseFloat(totalReturnText);
    if (!isNaN(val)) {
      labels.push(label);
      values.push(val);
    }
  });

  return {
  labels: labels.reverse(),
  values: values.reverse()
  };
}

function renderBarChart(el, labels, values, title) {

  const avg =
  values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;

  const avgLine = values.map(() => avg);

  const chart = new ApexCharts(document.querySelector(el), {
    chart: {
      type: "bar",
      height: 300,
      toolbar: { show: false }
    },
    series: [
      {
        name: "Total Return",
        type: "bar",
        data: values
      }
    ],
    xaxis: {
      categories: labels,
      labels: {
        rotate: -45,
        style: { colors: "#aaa" }
      }
    },
    yaxis: {
      labels: {
        formatter: v => `${v.toFixed(2)}%`
      },
      title: {
        text: "Total Return (%)",
        style: { color: "#aaa" }
      }
    },
    stroke: {
      width: [0, 2],
      curve: "straight",
      dashArray: [0, 6]   // 👈 dashed line
    },
    plotOptions: {
      bar: {
        columnWidth: "60%",
        borderRadius: 4,
        colors: {
          ranges: [
            { from: -1000, to: 0, color: "#ef4444" },   // red
            { from: 0, to: 1000, color: "#26BF94" }    // ✅ new green
          ]
        }
      }
    },
    annotations: {
      yaxis: [
        {
          y: avg,
          borderColor: "#ffffff",
          strokeDashArray: 6,
          label: {
            borderColor: "transparent",
            style: {
              color: "#fff",
              background: "rgba(0,0,0,0.6)",
              fontSize: "11px"
            },
            text: `Avg ${avg.toFixed(2)}%`
          }
        }
      ]
    },
    dataLabels: { enabled: false },
    grid: {
      borderColor: "rgba(255,255,255,0.08)"
    },
    tooltip: {
      y: {
        formatter: v => `${v.toFixed(2)}%`
      }
    },
    legend: {
      show: true,
      labels: {
        colors: "#bbb"
      }
    },
    tooltip: {
      y: {
        formatter: v => {
          const diff = v - avg;
          return `${v.toFixed(1)}% (${diff >= 0 ? "+" : ""}${diff.toFixed(1)} vs avg)`;
        }
      }
    },
    title: {
      text: title,
      align: "left",
      style: {
        color: "#bbb",
        fontSize: "13px"
      }
    }
  });

  chart.render();
}
