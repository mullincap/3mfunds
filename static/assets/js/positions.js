// positions.js
// ------------------------------------
// BloFin Open Positions Dashboard
// ------------------------------------

const REFRESH_MS = 10_000;
let sortMode = "pnl"; // "pnl" | "pct"

let accountState = {
  totalBalance: 0,
  availableBalance: 0,
  marginUsed: 0
};


/* ================================
   Helpers
================================ */
function fmtUSD(v) {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtUSDreg(v) {
  const sign = v >= 0 ? "+" : "-";
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtPct(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function set(id, value, signedVal = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (signedVal !== null) {
    el.className = signedVal >= 0 ? "text-success" : "text-danger";
  }
}

/* ================================
   Account Summary KPIs
================================ */
async function loadAccountSummary() {
  const res = await fetch("/api/account/summary");
  const s = await res.json();

  // 🔐 Store globally
  accountState.totalBalance = s.total_balance;
  accountState.availableBalance = s.total_available;
  accountState.marginUsed = s.total_margin;

  document.getElementById("kpi-total-balance").textContent =
    fmtUSDreg(s.total_balance);

  document.getElementById("kpi-total-available").textContent =
    fmtUSDreg(s.total_available);

  document.getElementById("kpi-total-margin").textContent =
    fmtUSDreg(s.total_margin);

  document.getElementById("kpi-margin-pct").textContent =
    s.margin_pct.toFixed(1) + "%";
}

/* ================================
   Summary KPIs (Positions-only)
================================ */
function updatePositionsSummary(positions) {
  const count = positions.length;

  let totalPnl = 0;
  let totalPct = 0;
  let winners = 0;
  let grossExposure = 0;
  let totalMargin = 0;
  let maxPnl = null;
  let lev = 4;

  positions.forEach(p => {
    const pnl = Number(p.unrealizedPnl || 0);
    const pct = Number(p.unrealizedPnlRatio || 0) * 100;
    const size = Number(p.positions || 0);
    const mark = Number(p.markPrice || 0);
    const margin = Number(p.initialMargin || 0);

    totalPnl += pnl;
    totalPct += pct;
    totalMargin += margin;
    grossExposure += margin * lev;

    if (pnl > 0) winners++;
    if (maxPnl === null || pnl > maxPnl) maxPnl = pnl;
  });

  const avgPct = count ? totalPct / count : 0;
  const winRate = count ? (winners / count) * 100 : 0;
  const pnlEfficiency = totalMargin ? (totalPnl / totalMargin) * 100 : 0;
  const pnlConcentration =
    totalPnl && maxPnl !== null ? (maxPnl / totalPnl) * 100 : 0;

  // 🔥 NEW KPI
  const marginUsed = accountState.marginUsed;
  const pnlMarginPct = marginUsed > 0
    ? (totalPnl / marginUsed) * 100
    : 0;

  /* ==========================
     KPIs
  ========================== */

  // Neutral counts / sizes (NO +/-)
  set("sum-count", count);
  set("sum-exposure", `$${grossExposure.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`);
  set("sum-margin", `$${totalMargin.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`);
  set("sum-winrate", winRate.toFixed(0) + "%");
  set("sum-concentration", pnlConcentration.toFixed(0) + "%");

  // Directional performance (KEEP +/-)
  set("sum-pnl", fmtUSD(totalPnl), totalPnl);
  set("sum-pnl-pct", fmtPct(avgPct));
  set("sum-efficiency", fmtPct(pnlEfficiency));
  set("sum-pnl-margin-pct", fmtPct(pnlMarginPct), pnlMarginPct);

}

/* ================================
   Load + Render Positions
================================ */


async function loadPositions() {
  const tbody = document.getElementById("positions-table-body");

  try {
    const res = await fetch("/api/positions");
    const rows = await res.json();

    if (!rows || !rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="text-center text-muted">
            No open positions
          </td>
        </tr>
      `;
      return;
    }

    // ---------- SORT ----------
    rows.sort((a, b) => {
      if (sortMode === "pct") {
        return (
          Number(b.unrealizedPnlRatio || 0) -
          Number(a.unrealizedPnlRatio || 0)
        );
      }
      return Number(b.unrealizedPnl || 0) - Number(a.unrealizedPnl || 0);
    });

    updatePositionsSummary(rows);

    // ---------- TABLE ----------
    tbody.innerHTML = "";

    const grossExposure = rows.reduce(
      (sum, p) => sum + Number(p.positions || 0) * Number(p.markPrice || 0),
      0
    );

    rows.forEach(p => {
      const pnl = Number(p.unrealizedPnl || 0);
      const pnlPct = Number(p.unrealizedPnlRatio || 0) * 100;
      const exposure = Number(p.margin || 0);

      const pnlClass = pnl >= 0 ? "text-success" : "text-danger";

      tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td><strong>${p.instId}</strong></td>
          <td>${p.positionSide.toUpperCase()}</td>
          <td>${Number(p.positions).toLocaleString()}</td>
          <td>$${Number(p.averagePrice).toLocaleString()}</td>
          <td>$${Number(p.markPrice).toLocaleString()}</td>
          <td>${p.leverage}×</td>
          <td>${p.marginMode}</td>
          <td>${fmtUSDreg(p.initialMargin)}</td>
          <td class="${pnlClass}">${fmtUSD(pnl)}</td>
          <td class="${pnlClass}">${fmtPct(pnlPct)}</td>
          <td>${p.liquidationPrice
            ? "$" + Number(p.liquidationPrice).toLocaleString()
            : "—"}</td>
        </tr>
      `);
    });

    // ---------- LAST UPDATED ----------
    const el = document.getElementById("last-updated");
    if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-danger">
          Failed to load positions
        </td>
      </tr>
    `;
  }
}

/* ================================
   Sort Toggles
================================ */
document.getElementById("sort-pnl")?.addEventListener("click", () => {
  sortMode = "pnl";
  loadPositions();
});

document.getElementById("sort-pct")?.addEventListener("click", () => {
  sortMode = "pct";
  loadPositions();
});

/* ================================
   Auto Refresh (Positions + Account)
================================ */
async function refreshAll() {
  await loadAccountSummary();   // 🔐 guarantees marginUsed is ready
  await loadPositions();
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);
