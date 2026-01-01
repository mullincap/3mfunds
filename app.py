from flask import Flask, render_template, jsonify, request
from db import connect_db
from decimal import Decimal
import pymysql
from datetime import datetime, timezone, timedelta, time
import pytz
from math import floor
import numpy as np
from analytics import load_hourly_returns
from blofin import blofin_get_positions
from blofin_client import blofin_request
import subprocess
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)

withdrawals = 3300
# ============ HELPERS ==========================================


def to_float_safe(x):
    if x is None:
        return 0.0
    try:
        return float(str(x).replace('%', ''))  # handles "0.52%" and raw decimals
    except:
        return 0.0

def normalize_roi(val):
    if val is None:
        return None

    # Convert strings like "-8.5%" → -8.5
    s = str(val).replace("%", "").strip()

    try:
        num = float(s)
    except:
        return None

    # If ROI is whole number (like -8.5), convert to decimal (-0.085)
    # If already decimal (-0.085), keep it.
    if num <= -1 or num >= 1:
        num = num / 100.0

    return num

def parse_roi_decimal(val):
    """
    Normalize ROI values coming from DB/Sheets.

    Accepts:
      - "3.59%"  -> 0.0359
      - "3.59"   -> 0.0359
      - 0.0359   -> 0.0359
      - None / "" -> None
    """
    if val is None:
        return None

    s = str(val).replace('%', '').replace(',', '').strip()
    if s == "":
        return None

    try:
        num = float(s)
    except ValueError:
        return None

    # If the magnitude looks like a percent (e.g. 3.5), convert to decimal.
    if abs(num) > 1:
        num /= 100.0

    return num


def format_compact_currency(value):
    try:
        value = float(value)
    except Exception:
        return "$0"

    abs_val = abs(value)

    if abs_val >= 1_000_000:
        return f"${value/1_000_000:.2f}m"
    elif abs_val >= 1_000:
        return f"${value/1_000:.1f}k"
    else:
        return f"${value:.2f}"


def fmt_currency(v):
    if v < 0:
        return f"-${abs(v):,.2f}"
    return f"${v:,.2f}"


def get_daily_closes(tz):
    connection = connect_db()
    phx = pytz.timezone("America/Phoenix")
    utc = pytz.UTC

    with connection.cursor(pymysql.cursors.DictCursor) as cursor:
        cursor.execute("""
            SELECT timestamp_utc, portfolio_value
            FROM investments_timeseries
            WHERE timestamp_utc >= NOW() - INTERVAL 8 DAY
            ORDER BY timestamp_utc ASC
        """)
        rows = cursor.fetchall()

    # Group by day → pick last row of each day
    daily = {}
    for r in rows:
        ts_utc = r["timestamp_utc"]

        if ts_utc.tzinfo is None:
            ts_utc = utc.localize(ts_utc)

        ts_local = ts_utc.astimezone(tz)
        day_key = ts_local.strftime("%Y-%m-%d")
        daily[day_key] = r  # overwrite → ensures last row of day is the close

    # Convert to sorted list, newest first
    sorted_days = sorted(daily.items(), key=lambda x: x[0], reverse=True)

    results = []
    for idx, (day_key, rec) in enumerate(sorted_days):
        ts = rec["timestamp_utc"].astimezone(phx)
        value = rec["portfolio_value"]

        # Compute percent change vs previous day
        if idx + 1 < len(sorted_days):
            prev_value = sorted_days[idx + 1][1]["portfolio_value"]
            pct_change = ((value - prev_value) / prev_value) * 100 if prev_value else 0
        else:
            pct_change = 0

        results.append({
            "day": ts.strftime("%a"),            # Mon, Tue, Wed
            "date": ts.strftime("%b %d"),        # Dec 06
            "value": value,
            "pct": pct_change,
            "datetime_obj": ts                   # ← REAL datetime for template
        })

    return results[:7]   # 7 most recent days


def get_daily_earnings():
    connection = connect_db()
    phx = pytz.timezone("America/Phoenix")

    with connection.cursor(pymysql.cursors.DictCursor) as cursor:
        cursor.execute("""
            SELECT timestamp_utc, portfolio_value
            FROM investments_timeseries
            WHERE timestamp_utc >= NOW() - INTERVAL 30 DAY
            ORDER BY timestamp_utc ASC
        """)
        rows = cursor.fetchall()

    # Group closes by day
    closes = {}
    for r in rows:
        ts = r["timestamp_utc"].astimezone(phx)
        day_key = ts.strftime("%Y-%m-%d")
        closes[day_key] = r["portfolio_value"]  # last value becomes daily close

    # Convert to list sorted oldest → newest
    day_items = sorted(closes.items())

    earnings = []
    prev_val = None

    for day, value in day_items:
        if prev_val is not None:
            earnings.append({
                "day": day,
                "earn": value - prev_val
            })
        prev_val = value
    return earnings[-7:]  # last 7 days for chart




# ============ PAGES ==========================================


@app.route("/returns")
def returns_page():
    series_payload = []  # or {} depending on your JS expectations

    return render_template(
        "components/returns/returns.html",
        series_payload=series_payload
    )


@app.route("/api/returns/hourly", methods=["GET"])
def api_hourly_returns():
    try:
        df = load_hourly_returns()

        # Convert DataFrame → JSON-safe list
        data = [
            {
                "date": row["date"],
                "hour": int(row["hour"]),
                "hourly_return": float(row["hourly_return"])
            }
            for _, row in df.iterrows()
        ]

        return jsonify({
            "status": "ok",
            "count": len(data),
            "data": data
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route("/kpis")
def get_kpis():
    connection = connect_db()
    with connection.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute("""
            SELECT timestamp_utc, portfolio_value
            FROM investments_timeseries
            ORDER BY timestamp_utc ASC
        """)
        rows = cur.fetchall()

    if len(rows) < 2:
        return jsonify({"error": "Not enough data"}), 400

    # Convert timestamps to aware UTC
    for r in rows:
        r["timestamp_utc"] = r["timestamp_utc"].replace(tzinfo=timezone.utc)

    ts = [r["timestamp_utc"] for r in rows]
    eq = [float(r["portfolio_value"]) for r in rows]

    first_eq = eq[0]
    last_eq = eq[-1] + withdrawals
    now_ts = ts[-1]

    # -------------------------------
    # Helper: get equity at/before time
    # -------------------------------
    def equity_at_or_before(target):
        prior = [r for r in rows if r["timestamp_utc"] <= target]
        return float(prior[-1]["portfolio_value"]) if prior else None

    # ======================
    # 1. Runtime (Days)
    # ======================
    START_TIME = datetime(2025, 11, 22, 6, 0, 0, tzinfo=timezone.utc)
    runtime_days = max(0, int((now_ts - START_TIME).total_seconds() // 86400))

    # ======================
    # 2. Daily Return %
    # ======================
    ts_24h = now_ts - timedelta(hours=24)
    eq_24h = equity_at_or_before(ts_24h) + withdrawals

    total_return_pct = (last_eq / first_eq - 1) * 100
    eff_total_return_pct = (last_eq / first_eq - 1) * 100

    total_return = last_eq - first_eq
    eff_total_return = last_eq - first_eq

    dpr = total_return_pct / runtime_days if runtime_days > 0 else None

    # ======================
    # 3. Weekly Return %
    # ======================
    ts_7d = now_ts - timedelta(days=7)
    eq_7d = equity_at_or_before(ts_7d) + withdrawals
    wpr = dpr * 7 if dpr is not None else None
    mpr = dpr * 30 if dpr is not None else None

    # ======================
    # 4. Annual Percentage Return
    # ======================
    total_days = (now_ts - ts[0]).total_seconds() / 86400
    apr = ((last_eq / first_eq) ** (365 / total_days) - 1) * 100 if total_days > 0 else None

    # ======================
    # 4. Max Drawdown (%)
    # ======================
    running_max = eq[0]
    max_dd = 0.0

    for value in eq:
        running_max = max(running_max, value)
        dd = (value - running_max) / running_max   # negative %
        max_dd = min(max_dd, dd)

    max_dd_pct = max_dd * 100

    # ======================
    # 5. Returns This Week (Dollars)
    # ======================

    now_ts = datetime.now(timezone.utc)

    # Monday=0 ... Sunday=6
    days_since_sunday = (now_ts.weekday() + 1) % 7

    sunday_start = (
        now_ts
        - timedelta(days=days_since_sunday)
    ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    eq_sunday = equity_at_or_before(sunday_start) + withdrawals

    rtw_dollars = last_eq - eq_sunday if eq_sunday else None

    # -------------------------------------------
    # LOWEST DAILY RETURN (LDR)
    # -------------------------------------------

    # Build day → last equity of that day
    by_day = {}
    for t, e in zip(ts, eq):
        day = t.date()
        by_day[day] = e  # last value for the day

    # Sort by date
    daily_vals = [by_day[d] for d in sorted(by_day.keys())]

    daily_returns = []
    for i in range(1, len(daily_vals)):
        dr = (daily_vals[i] / daily_vals[i - 1] - 1) * 100
        daily_returns.append(dr)

    lowest_daily_return = min(daily_returns) if daily_returns else None

    # ======================
    # 6. Returns This Month (Dollars)
    # ======================
    month_start = datetime(now_ts.year, now_ts.month, 1, tzinfo=timezone.utc)
    eq_month = equity_at_or_before(month_start) + withdrawals

    rtm_dollars = last_eq - eq_month if eq_month else None

    return jsonify({
        "runtime_days": runtime_days,
        "dpr_pct": dpr,
        "wpr_pct": wpr,
        "mpr_pct": mpr,
        "apr_pct": apr,
        "rtw_dollars": rtw_dollars,
        "rtm_dollars": rtm_dollars,
        "equity": last_eq,
        "lowest_daily_return": lowest_daily_return,
        "eff_total_return_pct": eff_total_return_pct,
        "eff_total_return": eff_total_return
    })


# dashboards
@app.route("/admin")
def admin():

    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    cursor.execute("""
        SELECT invested_value, portfolio_value, total_returns
        FROM investments_timeseries
        ORDER BY timestamp_utc DESC
        LIMIT 1
    """)

    row = cursor.fetchone()

    # Default values
    invested = 0.0
    portfolio = 0.0
    returns = 0.0
    return_rate = 0.0

    if row:
        invested = float(row.get("invested_value", 0) or 0)
        portfolio = float(row.get("portfolio_value", 0) or 0) + withdrawals
        returns = float(row.get("total_returns", 0) or 0) + withdrawals

        if invested > 0:
            return_rate = (portfolio - invested) / invested * 100

    # Determine today's midnight (UTC)
    now = datetime.now(timezone.utc)
    midnight_utc = now.replace(hour=0, minute=0, second=0, microsecond=0)

    cursor.execute("""
        SELECT portfolio_value
        FROM investments_timeseries
        WHERE timestamp_utc >= %s
        ORDER BY timestamp_utc ASC
        LIMIT 1
    """, (midnight_utc,))

    midnight_row = cursor.fetchone()

    if midnight_row:
        midnight_portfolio = float(midnight_row["portfolio_value"]) + withdrawals

        kpi_today_change = portfolio - midnight_portfolio
        kpi_today_change_pct = (kpi_today_change / midnight_portfolio) * 100
    else:
        # If no row exists after midnight, fall back safely
        kpi_today_change = 0
        kpi_today_change_pct = 0

    print("kpi_today_change",kpi_today_change)
    print("kpi_today_change_pct",kpi_today_change_pct)

    tz_arg = request.args.get("tz", "phx")   # default Phoenix

    if tz_arg == "utc":
        tz = pytz.UTC
    else:
        tz = pytz.timezone("America/Phoenix")

    daily_closes = get_daily_closes(tz=tz)
    earnings = get_daily_earnings()

    # Convert day (YYYY-MM-DD) → 'Dec 02'
    earnings_labels = [
        datetime.strptime(e["day"], "%Y-%m-%d").strftime("%b %d")
        for e in earnings
    ]

    # Convert Decimal → float
    earnings_values = [float(e["earn"]) for e in earnings]


    # ===============================
    # FUND CASH (LATEST EQUITY)
    # ===============================
    cursor.execute("""
        SELECT fund, equity_after, invested_margin
        FROM fund_portfolio_daily
        WHERE (fund, snapshot_date) IN (
            SELECT fund, MAX(snapshot_date)
            FROM fund_portfolio_daily
            WHERE fund IN ('ALPHA', 'BETA')
            GROUP BY fund
        )
    """)

    fund_rows = cursor.fetchall()

    alpha_cash = 0.0
    beta_cash = 0.0

    for r in fund_rows:
        if r["fund"] == "ALPHA":
            alpha_cash = float(r["invested_margin"] or 0)
        elif r["fund"] == "BETA":
            beta_cash = float(r["invested_margin"] or 0)

    beta_cash += 1000

    rem_cash = portfolio - alpha_cash - beta_cash - withdrawals
    print("rem cash:", rem_cash)
    if rem_cash < 0: rem_cash = 0

    conn.close()

    return render_template(
        "components/dashboards/admin.html",
        kpi_invested=invested,
        kpi_portfolio=portfolio,
        kpi_returns=returns,
        kpi_returnrate=return_rate,
        kpi_returns_compact=format_compact_currency(returns),
        kpi_portfolio_compact=format_compact_currency(portfolio),
        kpi_invested_compact=format_compact_currency(invested),
        alpha_cash_compact=format_compact_currency(alpha_cash),
        beta_cash_compact=format_compact_currency(beta_cash),
        rem_cash_compact=format_compact_currency(rem_cash),
        withdrawals_compact=format_compact_currency(withdrawals),

        kpi_today_change=kpi_today_change,
        kpi_today_change_pct=kpi_today_change_pct,
        fmt_currency=fmt_currency,

        daily_closes=daily_closes,
        tz_selected=tz_arg,

        earnings_data=earnings,
        earnings_labels=earnings_labels,
        earnings_values=earnings_values
    )

@app.route("/")
@app.route("/index")
def index():

    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    # ===============================
    # LATEST PORTFOLIO SNAPSHOT
    # ===============================
    cursor.execute("""
        SELECT invested_value, portfolio_value, total_returns
        FROM investments_timeseries
        ORDER BY timestamp_utc DESC
        LIMIT 1
    """)

    row = cursor.fetchone()

    print("row:", row)

    invested = 0.0
    portfolio = 0.0
    returns = 0.0
    return_rate = 0.0

    if row:
        invested = float(row.get("invested_value", 0) or 0)
        portfolio = float(row.get("portfolio_value", 0) or 0)
        returns = float(row.get("total_returns", 0) or 0)

        portfolio += withdrawals
        returns += withdrawals

        if invested > 0:
            return_rate = (portfolio - invested) / invested * 100

    print("invested:", invested)
    print("portfolio:", portfolio)
    print("returns:", returns)
    print("return_rate:", return_rate)

    # ===============================
    # TODAY CHANGE (UTC MIDNIGHT)
    # ===============================
    now = datetime.now(timezone.utc)
    midnight_utc = now.replace(hour=0, minute=0, second=0, microsecond=0)

    cursor.execute("""
        SELECT portfolio_value
        FROM investments_timeseries
        WHERE timestamp_utc >= %s
        ORDER BY timestamp_utc ASC
        LIMIT 1
    """, (midnight_utc,))

    midnight_row = cursor.fetchone()

    if midnight_row:
        midnight_portfolio = float(midnight_row["portfolio_value"]) + withdrawals
        latest_portfolio = portfolio

        kpi_today_change = latest_portfolio - midnight_portfolio
        kpi_today_change_pct = (kpi_today_change / midnight_portfolio) * 100
    else:
        kpi_today_change = 0.0
        kpi_today_change_pct = 0.0

    # ===============================
    # TIMEZONE SELECTION
    # ===============================
    tz_arg = request.args.get("tz", "utc")

    if tz_arg == "utc":
        tz = pytz.UTC
    else:
        tz = pytz.timezone("America/Phoenix")

    daily_closes = get_daily_closes(tz=tz)
    earnings = get_daily_earnings()

    earnings_labels = [
        datetime.strptime(e["day"], "%Y-%m-%d").strftime("%b %d")
        for e in earnings
    ]
    earnings_values = [float(e["earn"]) for e in earnings]

    # ===============================
    # FUND CASH
    # ===============================
    cursor.execute("""
        SELECT fund, equity_after, invested_margin
        FROM fund_portfolio_daily
        WHERE (fund, snapshot_date) IN (
            SELECT fund, MAX(snapshot_date)
            FROM fund_portfolio_daily
            WHERE fund IN ('ALPHA', 'BETA')
            GROUP BY fund
        )
    """)

    fund_rows = cursor.fetchall()

    alpha_cash = 0.0
    beta_cash = 0.0

    for r in fund_rows:
        if r["fund"] == "ALPHA":
            alpha_cash = float(r["equity_after"] or 0)
        elif r["fund"] == "BETA":
            beta_cash = float(r["invested_margin"] or 0)

    beta_cash += 1000

    rem_cash = portfolio - alpha_cash - beta_cash - withdrawals
    print("rem cash:", rem_cash)
    if rem_cash < 0: rem_cash = 0

    conn.close()

    return render_template(
        "components/dashboards/index.html",

        # KPIs
        kpi_invested=invested,
        kpi_portfolio=portfolio,
        kpi_returns=returns + withdrawals,
        kpi_returnrate=return_rate,

        kpi_returns_compact=format_compact_currency(returns),
        kpi_portfolio_compact=format_compact_currency(portfolio),
        kpi_invested_compact=format_compact_currency(invested),

        # Fund cash
        alpha_cash_compact=format_compact_currency(alpha_cash),
        beta_cash_compact=format_compact_currency(beta_cash),
        rem_cash_compact=format_compact_currency(rem_cash),
        withdrawals_compact = format_compact_currency(withdrawals),

        # Today change
        kpi_today_change=kpi_today_change,
        kpi_today_change_pct=kpi_today_change_pct,
        fmt_currency=fmt_currency,

        # Charts
        daily_closes=daily_closes,
        tz_selected=tz_arg,

        earnings_data=earnings,
        earnings_labels=earnings_labels,
        earnings_values=earnings_values
    )


@app.route("/api/home/daily-equity")
def api_home_daily_equity():

    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    cursor.execute("""
        SELECT
            DATE(timestamp_utc) AS day,
            MAX(portfolio_value) AS portfolio_value
        FROM investments_timeseries
        WHERE timestamp_utc >= UTC_DATE() - INTERVAL 90 DAY
        GROUP BY DATE(timestamp_utc)
        ORDER BY day ASC
    """)

    rows = cursor.fetchall()
    conn.close()

    dates = []
    values = []

    for r in rows:
        # Format for chart labels: "Dec-18"
        dates.append(r["day"].strftime("%b-%d"))
        values.append(float(r["portfolio_value"]))

    return jsonify({
        "dates": dates,
        "values": values
    })

@app.route("/historical")
def historical():
    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    # ---------- Full series for chart ----------
    cursor.execute("""
        SELECT timestamp_utc, cum_roi
        FROM historical_roi
        ORDER BY timestamp_utc ASC
    """)
    all_rows = cursor.fetchall()

    chart_labels = [
        row["timestamp_utc"].strftime("%Y-%m-%d %H:%M")
        for row in all_rows
    ]
    chart_values = [float(row["cum_roi"]) for row in all_rows]

    series_payload = {
        "labels": chart_labels,
        "values": chart_values,
    }

    # ---------- Wednesday 19:00 UTC snapshot table ----------
    cursor.execute("""
        SELECT timestamp_utc, cum_roi
        FROM historical_roi
        WHERE WEEKDAY(timestamp_utc) = 2   -- 0=Mon,1=Tue,2=Wed
          AND HOUR(timestamp_utc) = 20
          AND MINUTE(timestamp_utc) = 0
        ORDER BY timestamp_utc ASC
    """)
    wed_rows = cursor.fetchall()
    conn.close()

    wed_summaries = []
    prev_cum = None
    for row in wed_rows:
        cum = float(row["cum_roi"])
        week_change = cum - prev_cum if prev_cum is not None else None

        wed_summaries.append({
            "date_utc": row["timestamp_utc"].strftime("%Y-%m-%d"),
            "cum_roi": cum,
            "week_change": week_change,
        })
        prev_cum = cum

    return render_template(
        "components/historical/historical.html",
        series_payload=series_payload,
        wed_summaries=wed_summaries,
    )


@app.route("/dailies")
def dailies():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("SELECT * FROM deploys ORDER BY timestamp_utc ASC")
    rows = cur.fetchall()

    cur.close()
    conn.close()

    # rows used for main table; deploys_list used for sidebar
    return render_template(
        "components/deploys/dailies.html",
        rows=rows,
        deploys_list=rows
    )

@app.route("/api/gamma/ltv")
def api_gamma_ltv():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("""
        SELECT
            snapshot_date,
            equity_before,
            invested_margin,
            pnl,
            cum_pnl,
            total_return,
            trade_bal,
            profit_bal,
            equity_0pct_reinv
        FROM gamma_ltv_daily
        ORDER BY snapshot_date ASC
    """)

    rows = cur.fetchall()
    conn.close()

    return jsonify(rows)



@app.route("/deploys")
def deploys():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("SELECT * FROM deploys ORDER BY timestamp_utc DESC")
    rows = cur.fetchall()

    cur.close()
    conn.close()

    # rows used for main table; deploys_list used for sidebar
    return render_template(
        "components/deploys/deploys.html",
        rows=rows,
        deploys_list=rows,
        show_deploy_sidebar=True
    )


@app.route("/deploys/<int:deploy_id>")
def deploy_detail(deploy_id):
    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    # --- Fetch Deploy Metadata ---
    cursor.execute("""
        SELECT *
        FROM deploys
        WHERE id = %s
        LIMIT 1
    """, (deploy_id,))
    deploy = cursor.fetchone()

    if not deploy:
        conn.close()
        return f"Deploy {deploy_id} not found", 404

    # --- Fetch all deploys for sidebar nav (descending so most recent on top) ---
    cursor.execute("""
        SELECT id, timestamp_utc
        FROM deploys
        ORDER BY timestamp_utc DESC
    """)
    deploys_list = cursor.fetchall()

    # --- Fetch Portfolio History Rows (expected ~216 rows) ---
    cursor.execute("""
        SELECT *
        FROM portfolio_history
        WHERE deploy_id = %s
        ORDER BY timestamp_utc ASC
    """, (deploy_id,))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        # No history rows; render page with empty charts
        return render_template(
            "components/deploys/detail.html",
            deploy=deploy,
            deploys_list=deploys_list,
            show_deploy_sidebar=True,
            timestamps=[],
            balance=[],
            roi=[],
            asset_series={},
            active_deploy_id=deploy_id,
        )

    # =============================
    # Format for charts
    # =============================
    timestamps = [r["timestamp_utc"].isoformat() for r in rows]
    balance = [float(r["portfolio_balance"]) for r in rows]
    roi = [float(r["portfolio_roi"]) for r in rows]


    # --------------------------------------------------------
    # DEPLOY-LEVEL KPIs
    # --------------------------------------------------------

    # 1. Total Return (%)
    initial_bal = balance[0]
    final_bal = balance[-1]
    total_return_pct = ((final_bal / initial_bal) - 1) * 100 if initial_bal else 0
    eff_total_returb_pct = ((final_bal / 20000) - 1) * 100 if initial_bal else 0

    # 2. Max Drawdown (%)
    equity_curve = [1 + r for r in roi]   # synthetic curve
    running_max = equity_curve[0]
    max_dd = 0.0

    for v in equity_curve:
        if v > running_max:
            running_max = v
        dd = (v - running_max) / running_max   # negative fraction
        if dd < max_dd:
            max_dd = dd

    max_dd_pct = max_dd * 100

    # 3. BTC Performance (%)
    btc_vals = [float(r["BTC_close"]) for r in rows]
    btc_perf_pct = ((btc_vals[-1] / btc_vals[0]) - 1) * 100 if btc_vals[0] else 0

    # 4. Volatility (std deviation of ROI curve)
    roi_floats = np.array([float(x) for x in roi])
    volatility = float(np.std(roi_floats))

    # 5. Stop Losses (-8.5%)
    STOP_LOSS_TARGET = -0.085
    stop_loss_count = 0

    for col in [c for c in rows[0].keys() if c.endswith("_roi")]:
        raw_val = rows[-1][col]
        normalized = parse_roi_decimal(raw_val)   # → always returns decimal or None

        if normalized is None:
            continue

        # check if it equals -0.085 within tolerance
        if abs(normalized - STOP_LOSS_TARGET) < 1e-6:
            stop_loss_count += 1

    # 6. Average ROI (%)
    avg_roi_pct = float(np.mean(roi_floats)) * 100

    lowest_roi_pct = min(roi) * 100 if roi else 0



    # ---------------------------------------
    # DETECT WHICH ASSET ROI COLUMNS ARE REAL
    # ---------------------------------------
    # All ROI-like columns except portfolio-level ones
    roi_columns = [
        c for c in rows[0].keys()
        if c.endswith("_roi") and c not in ("portfolio_roi", "portfolio_roi_lev")
    ]

    asset_series = {}

    # Build per-asset series, but only keep columns that have *any* non-null data
    for col in roi_columns:
        series = [parse_roi_decimal(r[col]) for r in rows]
        # keep only non-empty assets (at least one non-None value)
        if any(v is not None for v in series):
            asset_name = col.replace("_roi", "").upper()
            asset_series[asset_name] = series

    return render_template(
        "components/deploys/detail.html",
        deploy=deploy,
        deploys_list=deploys_list,
        show_deploy_sidebar=True,
        timestamps=timestamps,
        balance=balance,
        roi=roi,
        asset_series=asset_series,
            # NEW KPIs
        total_return_pct=total_return_pct,
        max_dd_pct=max_dd_pct,
        btc_perf_pct=btc_perf_pct,
        volatility=volatility,
        stop_loss_count=stop_loss_count,
        avg_roi_pct=avg_roi_pct,
        lowest_roi_pct=lowest_roi_pct

    )


# ============ DATA ==========================================

@app.route("/api/investments/timeseries")
def investments_timeseries():
    days = request.args.get("days", None)

    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    if days:
        cursor.execute("""
            SELECT timestamp_utc, invested_value, total_returns, portfolio_value
            FROM investments_timeseries
            WHERE timestamp_utc >= NOW() - INTERVAL %s DAY
            ORDER BY timestamp_utc ASC
        """, (int(days),))
    else:
        cursor.execute("""
            SELECT timestamp_utc, invested_value, total_returns, portfolio_value
            FROM investments_timeseries
            ORDER BY timestamp_utc ASC
        """)

    rows = cursor.fetchall()
    conn.close()

    timestamps = []
    invested = []
    portfolio = []
    returns = []
    pnl = []

    for r in rows:
        try:
            ts = r["timestamp_utc"].isoformat()
            i = float(r["invested_value"])
            p = float(r["portfolio_value"])
            t = float(r["total_returns"])
            d = p - i

            timestamps.append(ts)
            invested.append(i)
            portfolio.append(p)
            returns.append(t)
            pnl.append(d)

        except Exception as e:
            print("BAD ROW:", r, e)  # Debug output

    return jsonify({
        "timestamps": timestamps,
        "invested_value": invested,
        "portfolio_value": portfolio,
        "total_returns": returns,
        "returns_diff": pnl
    })


@app.route("/api/daily_closes_full")
def api_daily_closes_full():
    """
    Computes full OHLC-style daily metrics from investments_timeseries.
    Uses UTC days.
    """

    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    # Pull last 90 days of intraday data (adjust if needed)
    cur.execute("""
        SELECT timestamp_utc, portfolio_value
        FROM investments_timeseries
        WHERE timestamp_utc >= NOW() - INTERVAL 90 DAY
        ORDER BY timestamp_utc ASC
    """)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return jsonify([])

    # Attach UTC timezone
    for r in rows:
        if r["timestamp_utc"].tzinfo is None:
            r["timestamp_utc"] = r["timestamp_utc"].replace(tzinfo=timezone.utc)

    # Group rows by day
    days = {}  # key = YYYY-MM-DD, value = list of floats

    for r in rows:
        day_key = r["timestamp_utc"].strftime("%Y-%m-%d")
        days.setdefault(day_key, []).append(float(r["portfolio_value"]))

    # Sort days
    sorted_days = sorted(days.keys())

    output = []
    cumulative_pnl = 0.0
    cumulative_pct = 0.0
    initial_portfolio = days[sorted_days[0]][0]  # first value of entire dataset

    for day in sorted_days:
        values = days[day]

        start_balance = values[0]
        high = max(values)
        low = min(values)
        close_balance = values[-1]

        spread_usd = high - low
        volatility_pct = ((high - low) / start_balance) * 100 if start_balance else 0

        return_usd = close_balance - start_balance
        roi_pct = (return_usd / start_balance) * 100 if start_balance else 0

        # update cumulative values
        cumulative_pnl += return_usd
        cumulative_pct = ((close_balance / initial_portfolio) - 1) * 100

        output.append({
            "date": day,
            "start_balance": start_balance,
            "high": high,
            "low": low,
            "close_balance": close_balance,
            "spread_usd": spread_usd,
            "volatility_pct": volatility_pct,
            "return_usd": return_usd,
            "roi_pct": roi_pct,
            "cum_pnl_usd": cumulative_pnl,
            "cum_pnl_pct": cumulative_pct
        })

    return jsonify(output)

@app.route("/api/portfolio_stats")
def api_portfolio_stats():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    # 1 — Get latest deploy record
    cur.execute("SELECT * FROM deploys ORDER BY timestamp_utc DESC LIMIT 1")
    deploy = cur.fetchone()
    if not deploy:
        conn.close()
        return jsonify([])

    # Extract tickers: R1..R30
    tickers = []
    for i in range(1, 31):
        key = f"R{i}"
        if deploy.get(key):
            tickers.append(deploy[key])

    # 2 — Get latest portfolio_history snapshot
    cur.execute("""
        SELECT *
        FROM portfolio_history
        WHERE deploy_id = %s
        ORDER BY timestamp_utc DESC
        LIMIT 1
    """, (deploy["id"],))
    snap = cur.fetchone()
    conn.close()

    if not snap:
        return jsonify([])

    results = []

    # 3 — Map p1_roi → ticker from R1, p2_roi → R2, etc.
    for i, ticker in enumerate(tickers, start=1):
        roi_field = f"p{i}_roi"
        roi_val = snap.get(roi_field)

        # Normalize ROI
        if roi_val is None:
            roi = None
        elif isinstance(roi_val, str) and roi_val.endswith("%"):
            roi = float(roi_val.replace("%", ""))
        else:
            roi = float(roi_val)

        results.append({
            "symbol": ticker,
            "name": ticker,
            "roi_pct": roi,
            "roi_color": "green" if roi and roi > 0 else "red" if roi and roi < 0 else "gray"
        })

    # Sort best → worst
    results.sort(key=lambda x: (x["roi_pct"] is not None, x["roi_pct"]), reverse=True)

    return jsonify(results)

@app.route("/api/fund/<fund>/daily")
def api_fund_daily(fund):
    conn = connect_db()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                snapshot_date,
                equity_before,
                invested_margin,
                pnl,
                cum_pnl,
                total_return,
                equity_after,
                trade_bal,
                profit_bal,
                dar
            FROM fund_portfolio_daily
            WHERE fund = %s
            ORDER BY snapshot_date DESC
            LIMIT 100;
        """, (fund,))
        rows = cur.fetchall()

    return jsonify(rows)

@app.route("/api/positions")
def api_positions():
    data = blofin_get_positions()   # wrapper you already use
    return jsonify(data)

@app.route("/positions")
def positions():
    return render_template("components/positions/positions.html")

@app.route("/api/account/summary")
def api_account_summary():
    data = blofin_request("GET", "/api/v1/account/balance")

    acct = data.get("data", {})
    details = acct.get("details", [{}])[0]

    total_equity = float(acct.get("totalEquity", 0))
    available = float(details.get("available", 0))
    balance = float(details.get("balance", 0))

    margin_used = max(balance - available, 0)
    margin_pct = (margin_used / total_equity * 100) if total_equity else 0

    print("total_balance:",total_equity)
    print("total_available:",available)
    print("total_margin:",margin_used)
    print("margin_pct:",margin_pct)

    return jsonify({
        "total_balance": round(total_equity, 2),
        "total_available": round(available, 2),
        "total_margin": round(margin_used, 2),
        "margin_pct": round(margin_pct, 2),
    })


from routes.job_health import bp as job_health_bp
app.register_blueprint(job_health_bp)


@app.route("/admin/job-health")
def job_health_page():
    return render_template("components/admin/job_health.html")

@app.route("/api/deploys/cycle_curve")
def deploy_cycle_curve():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("""
        SELECT
            HOUR(timestamp_utc) AS hour_utc,
            AVG(portfolio_roi) AS avg_return
        FROM portfolio_history
        WHERE HOUR(timestamp_utc) BETWEEN 0 AND 24
        GROUP BY hour_utc
        ORDER BY hour_utc
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    return jsonify(rows)

@app.route("/interest")
def interest_page():
    series_payload = []  # or {} depending on your JS expectations

    return render_template(
        "components/interest/interest.html",
        series_payload=series_payload
    )

@app.route("/api/interest/oi")
def api_interest_oi():
    days = request.args.get("days", type=int)

    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    if days:
        cur.execute("""
            SELECT
                timestamp_utc,
                oi_chg_24h
            FROM oi_log
            WHERE timestamp_utc >= UTC_TIMESTAMP() - INTERVAL %s DAY
            ORDER BY timestamp_utc ASC
        """, (days,))
    else:
        cur.execute("""
            SELECT
                timestamp_utc,
                oi_chg_24h
            FROM oi_log
            ORDER BY timestamp_utc ASC
        """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    return jsonify(rows)

@app.route("/api/interest/kpis")
def api_interest_kpis():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("""
        SELECT
            chg_24h,
            oi_chg_24h,
            fr_avg,
            pc_oi_1_1d,
            timestamp_utc
        FROM oi_log
        ORDER BY timestamp_utc DESC
        LIMIT 1
    """)

    row = cur.fetchone()
    cur.close()
    conn.close()

    return jsonify(row)


@app.route("/api/positions/equity_session")
def api_equity_session():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    now = datetime.utcnow()

    session_start = datetime.combine(now.date(), time(6, 0))

    # if before 06:00 UTC → use yesterday
    if now < session_start:
        session_start -= timedelta(days=1)

    cur.execute("""
        SELECT
            timestamp_utc,
            portfolio_value
        FROM investments_timeseries
        WHERE timestamp_utc >= %s
        ORDER BY timestamp_utc ASC
    """, (session_start,))

    rows = cur.fetchall()
    cur.close()
    conn.close()

    return jsonify(rows)


@app.route("/api/trade/open", methods=["POST"])
def open_trade():
    # if "userid" not in session:
    #     return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    amount = data.get("amount")

    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except Exception:
        return jsonify({"error": "Invalid amount"}), 400

    cmd = [
        "python3",
        "mtrader2.py",
        "--mode", "open",
        "--amount", str(amount)
    ]

    try:
        # Run asynchronously so UI doesn't hang
        subprocess.Popen(
            ["python3", os.path.join(BASE_DIR, "mtrader2.py"), "--mode", "open", "--amount", str(amount)],
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        return jsonify({"status": "ok"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/trade/close", methods=["POST"])
def close_all_trades():
    if "userid" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        subprocess.Popen(
            [sys.executable, os.path.join(BASE_DIR, "mtrader2.py"), "--mode", "close"],
            cwd=BASE_DIR,
            env=os.environ.copy(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        return jsonify({"status": "closing"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/prices/daily-returns")
def daily_returns():
    start = request.args.get("start", "2025-09-22")

    conn = connect_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT symbol, date, close_price, daily_return
        FROM crypto_price_daily_returns
        WHERE date >= %s
        ORDER BY date ASC
    """, (start,))

    rows = cur.fetchall()
    cur.close()
    conn.close()

    data = {}

    for r in rows:
        sym = r["symbol"]
        data.setdefault(sym, []).append({
            "date": r["date"].isoformat(),
            "close": float(r["close_price"]),
            "ret": float(r["daily_return"]) if r["daily_return"] is not None else None
        })

    return jsonify(data)

# @app.route("/api/market/cumulative")
# def market_cumulative():
#     start = request.args.get("start", "2025-09-22")
#
#     conn = connect_db()
#     cur = conn.cursor()
#
#     cur.execute("""
#         SELECT symbol, day, close_price
#         FROM crypto_price_daily
#         WHERE day >= %s
#         ORDER BY symbol, day
#     """, (start,))
#
#     rows = cur.fetchall()
#     conn.close()
#
#     from collections import defaultdict
#
#     series = defaultdict(list)
#
#     for r in rows:
#         series[r["symbol"]].append((r["day"], float(r["close_price"])))
#
#     out = {}
#
#     for symbol, points in series.items():
#         base = points[0][1]
#
#         cum = []
#         for d, price in points:
#             ret = (price / base - 1.0) * 100
#             cum.append({
#                 "x": d.isoformat(),
#                 "y": round(ret, 4)
#             })
#
#         out[symbol] = cum
#
#     return jsonify(out)

@app.get("/api/market/cumulative")
def market_cumulative():
    start = request.args.get("start")

    conn = connect_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT symbol, date, return_pct
        FROM market_price_returns
        WHERE date >= %s
        ORDER BY symbol, date
    """, (start,))

    rows = cur.fetchall()
    cur.close()
    conn.close()

    series = {}

    for r in rows:
        sym = r["symbol"]
        series.setdefault(sym, []).append([
            r["date"].isoformat(),
            round(float(r["return_pct"]), 4)
        ])

    return jsonify(series)


@app.route("/api/market/returns")
def market_returns():
    start = request.args.get("start", "2025-09-22")

    conn = connect_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT symbol, date, return_pct
        FROM market_price_returns
        WHERE date >= %s
        ORDER BY symbol, date
    """, (start,))

    rows = cur.fetchall()
    conn.close()

    series = {}

    # group by symbol
    for r in rows:
        series.setdefault(r["symbol"], []).append(r["return_pct"])

    out = {}

    for sym, values in series.items():
        if not values:
            continue

        # since return_pct is already cumulative,
        # the last value is the total return
        out[sym] = round(values[-1], 4)

    return jsonify(out)


if __name__ == '__main__':
    app.run(debug=True)
