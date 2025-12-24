from flask import Blueprint, jsonify
from db import connect_db
import pymysql

bp = Blueprint("job_health", __name__, url_prefix="/api/jobs")

@bp.route("/latest")
def latest():
    conn = connect_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    cursor.execute("""
        SELECT
          job_name,
          MAX(started_at) AS last_run,
          SUBSTRING_INDEX(
            GROUP_CONCAT(status ORDER BY id DESC),
            ',', 1
          ) AS status,
          SUBSTRING_INDEX(
            GROUP_CONCAT(duration_sec ORDER BY id DESC),
            ',', 1
          ) AS duration
        FROM job_runs
        GROUP BY job_name
        ORDER BY last_run ASC
    """)

    rows = cursor.fetchall()
    conn.close()

    # Optional: normalize output (safe for JSON)
    for r in rows:
        if r["last_run"]:
            r["last_run"] = r["last_run"].strftime("%Y-%m-%d %H:%M:%S")

    return jsonify(rows)
