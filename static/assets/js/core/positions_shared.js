// static/assets/js/positions_shared.js
/* ================================
   Helpers
================================ */
export function fmtUSD(v) {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}
export function fmtUSDshort(v) {
  const sign = v >= 0 ? "+" : "-";
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

export function fmtUSDreg(v) {
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function fmtPct(v) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/* ================================
   Shared Position Stats
================================ */
export function computePositionStats(positions) {
  let totalPnl = 0;
  let totalPct = 0;
  let winners = 0;
  let grossExposure = 0;
  let totalMargin = 0;
  let maxPnl = null;

  const rows = [];

  positions.forEach(p => {
    const pnl = Number(p.unrealizedPnl || 0);
    const pct = Number(p.unrealizedPnlRatio || 0) * 100;
    const size = Number(p.positions || 0);
    const mark = Number(p.markPrice || 0);
    const margin = Number(p.initialMargin || 0);

    const exposure = size * mark;

    totalPnl += pnl;
    totalPct += pct;
    totalMargin += margin;
    grossExposure += exposure;

    if (pnl > 0) winners++;
    if (maxPnl === null || pnl > maxPnl) maxPnl = pnl;

    rows.push({
      symbol: p.instId,
      pnl,
      pnlPct: pct,
      margin
    });
  });

  const count = positions.length;

  return {
    /* ===== existing KPIs (unchanged) ===== */
    count,
    totalPnl,
    avgPct: count ? totalPct / count : 0,
    winRate: count ? (winners / count) * 100 : 0,
    grossExposure,
    totalMargin,
    pnlEfficiency: totalMargin ? (totalPnl / totalMargin) * 100 : 0,
    pnlConcentration:
      totalPnl && maxPnl !== null ? (maxPnl / totalPnl) * 100 : 0,

    /* ===== NEW (required for Home dashboard) ===== */
    rows
  };
}
