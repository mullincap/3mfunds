from flask import Flask, render_template, jsonify, request
from db import connect_db
from decimal import Decimal
import pymysql

from dotenv import load_dotenv
load_dotenv()


conn = connect_db()
cursor = conn.cursor()
cursor.execute("SELECT * FROM investments_timeseries LIMIT 3")
print(cursor.fetchall())

app = Flask(__name__)

#dashboards
@app.route('/')
@app.route('/index')
def index():
    return render_template('components/dashboards/index.html')


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
