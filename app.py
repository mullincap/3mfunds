from flask import Flask, render_template, jsonify, request
from db import connect_db
from decimal import Decimal
import pymysql
from datetime import datetime, timezone


from dotenv import load_dotenv
load_dotenv()


conn = connect_db()
cursor = conn.cursor()
cursor.execute("SELECT * FROM investments_timeseries LIMIT 3")
print(cursor.fetchall())

app = Flask(__name__)


# helpers
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
        fmt_currency=fmt_currency

    )


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




if __name__ == '__main__':
    app.run(debug=True)
