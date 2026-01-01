
async function loadHeaderAUM() {
  try {
    const res = await fetch("/kpis");
    const data = await res.json();

    if (!data.equity) return;

    const el = document.getElementById("header-aum");
    if (!el) return;

    el.textContent = `$${Number(data.equity).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

  } catch (err) {
    console.warn("Failed to load AUM:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadHeaderAUM();
});

setInterval(loadHeaderAUM, 180_000); // every 60s
