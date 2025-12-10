from flask import Flask, render_template, jsonify, request
from db import connect_db
from decimal import Decimal
import pymysql
from datetime import datetime, timezone, timedelta
import pytz
from dotenv import load_dotenv
from math import floor
load_dotenv()


app = Flask(__name__)


# ============ HELPERS ==========================================

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
    # dpr = (last_eq / eq_24h - 1) * 100 if eq_24h else None

    total_return_pct = (last_eq / first_eq - 1) * 100
    dpr = total_return_pct / runtime_days if runtime_days > 0 else None

    # ======================
    # 3. Weekly Return %
    # ======================
    ts_7d = now_ts - timedelta(days=7)
    eq_7d = equity_at_or_before(ts_7d)
    #wpr = (last_eq / eq_7d - 1) * 100 if eq_7d else None
    wpr = dpr * 7

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
        by_day.setdefault(day, e)

    # Sort by date
    daily_vals = [by_day[d] for d in sorted(by_day.keys())]

    daily_returns = []
    for i in range(1, len(daily_vals)):
        dr = (daily_vals[i] / daily_vals[i-1] - 1) * 100
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
        "lowest_daily_return": lowest_daily_return
    })




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

        if ts_utc.tzinfo is None: ts_utc = utc.localize(ts_utc)

        ts_local = ts_utc.astimezone(tz)

        # ts = r["timestamp_utc"].astimezone(phx)
        day_key = ts_local.strftime("%Y-%m-%d")
        daily[day_key] = r  # overwrite → ensures last row of day is the close

    # Convert to sorted list, newest first
    #sorted_days = sorted(daily.items(), key=lambda x: x[0], reverse=True)
    sorted_days = sorted(daily.items(), key=lambda x: x[0])   # oldest → newest

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

#dashboards
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
    #conn.close()

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

    # Determine today's midnight (UTC or Phoenix?)
    # You logged timestamps in UTC, so compute midnight UTC.
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

    #earnings_labels = [e['date'] for e in earnings]
    #earnings_values = [e['earn'] for e in earnings]
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
        kpi_returns_compact = format_compact_currency(returns),
        kpi_portfolio_compact = format_compact_currency(portfolio),
        kpi_invested_compact = format_compact_currency(invested),

        kpi_today_change= kpi_today_change,
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

    return render_template("components/portfolios/deploys.html", rows=rows)













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
            i  = float(r["invested_value"])
            p  = float(r["portfolio_value"])
            t  = float(r["total_returns"])
            d  = p - i

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



if __name__ == '__main__':
    app.run(debug=True)
