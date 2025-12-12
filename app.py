from flask import Flask, render_template, jsonify, request
from db import connect_db
from decimal import Decimal
import pymysql
from datetime import datetime, timezone, timedelta
import pytz
from dotenv import load_dotenv
from math import floor
import numpy as np
load_dotenv()


app = Flask(__name__)


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
        return f"${value/1_000:.2f}k"
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
    last_eq = eq[-1]
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
    eq_24h = equity_at_or_before(ts_24h)

    total_return_pct = (last_eq / first_eq - 1) * 100
    eff_total_return_pct = (last_eq / 20000 - 1) * 100

    total_return = last_eq - first_eq
    eff_total_return = last_eq - 20000

    dpr = total_return_pct / runtime_days if runtime_days > 0 else None

    # ======================
    # 3. Weekly Return %
    # ======================
    ts_7d = now_ts - timedelta(days=7)
    eq_7d = equity_at_or_before(ts_7d)
    wpr = dpr * 7 if dpr is not None else None

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
    weekday = now_ts.weekday()   # Monday=0 ... Sunday=6
    sunday_offset = (weekday + 1) % 7

    # Sunday 00:00 UTC
    sunday_start = datetime(
        now_ts.year, now_ts.month, now_ts.day,
        tzinfo=timezone.utc
    ) - timedelta(days=sunday_offset, hours=now_ts.hour, minutes=now_ts.minute)

    eq_sunday = equity_at_or_before(sunday_start)
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
    eq_month = equity_at_or_before(month_start)
    rtm_dollars = last_eq - eq_month if eq_month else None

    print(runtime_days)

    return jsonify({
        "runtime_days": runtime_days,
        "dpr_pct": dpr,
        "wpr_pct": wpr,
        "apr_pct": apr,
        "rtw_dollars": rtw_dollars,
        "rtm_dollars": rtm_dollars,
        "equity": last_eq,
        "lowest_daily_return": lowest_daily_return,
        "eff_total_return_pct": eff_total_return_pct,
        "eff_total_return": eff_total_return
    })


# dashboards
@app.route('/')
@app.route("/index")
def index():

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
        portfolio = float(row.get("portfolio_value", 0) or 0)
        returns = float(row.get("total_returns", 0) or 0)

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
        midnight_portfolio = float(midnight_row["portfolio_value"])
        latest_portfolio = float(row["portfolio_value"])

        kpi_today_change = latest_portfolio - midnight_portfolio
        kpi_today_change_pct = (kpi_today_change / midnight_portfolio) * 100
    else:
        # If no row exists after midnight, fall back safely
        kpi_today_change = 0
        kpi_today_change_pct = 0

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

    conn.close()

    return render_template(
        "components/dashboards/index.html",
        kpi_invested=invested,
        kpi_portfolio=portfolio,
        kpi_returns=returns,
        kpi_returnrate=return_rate,
        kpi_returns_compact=format_compact_currency(returns),
        kpi_portfolio_compact=format_compact_currency(portfolio),
        kpi_invested_compact=format_compact_currency(invested),

        kpi_today_change=kpi_today_change,
        kpi_today_change_pct=kpi_today_change_pct,
        fmt_currency=fmt_currency,

        daily_closes=daily_closes,
        tz_selected=tz_arg,

        earnings_data=earnings,
        earnings_labels=earnings_labels,
        earnings_values=earnings_values
    )


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
          AND HOUR(timestamp_utc) = 19
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


@app.route("/deploys")
def deploys():
    conn = connect_db()
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute("SELECT * FROM deploys ORDER BY timestamp_utc ASC")
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








if __name__ == '__main__':
    app.run(debug=True)
