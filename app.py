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
    from datetime import datetime, timedelta

    days = request.args.get("days", None)

    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    if days is not None:
        days = int(days)
        sql = """
            SELECT timestamp_utc, invested_value, total_returns, portfolio_value
            FROM investments_timeseries
            WHERE timestamp_utc >= NOW() - INTERVAL %s DAY
            ORDER BY timestamp_utc ASC
        """
        cursor.execute(sql, (days,))
    else:
        sql = """
            SELECT timestamp_utc, invested_value, total_returns, portfolio_value
            FROM investments_timeseries
            ORDER BY timestamp_utc ASC
        """
        cursor.execute(sql)

    rows = cursor.fetchall()
    conn.close()

    return jsonify({
        "timestamps": [r["timestamp_utc"].isoformat() for r in rows],
        "invested_value": [float(r["invested_value"]) for r in rows],
        "total_returns": [float(r["total_returns"]) for r in rows],
        "portfolio_value": [float(r["portfolio_value"]) for r in rows]
    })

if __name__ == '__main__':
    app.run(debug=True)
