# analytics_returns.py

import pandas as pd
from db import connect_db


def load_hourly_returns():
    print("loading hourly returns")

    conn = connect_db()
    cur = conn.cursor()

    query = """
        SELECT
          FROM_UNIXTIME(
            UNIX_TIMESTAMP(timestamp_utc)
            - MOD(UNIX_TIMESTAMP(timestamp_utc), 3600)
          ) AS hour_ts,
          MAX(portfolio_value) AS portfolio_value
        FROM investments_timeseries
        GROUP BY hour_ts
        ORDER BY hour_ts
    """

    # --- execute manually ---
    cur.execute(query)
    rows = cur.fetchall()
    colnames = [desc[0] for desc in cur.description]

    conn.close()

    df = pd.DataFrame(rows, columns=colnames)

    print("raw df from SQL:")
    print(df.dtypes)

    if df.empty or len(df) < 2:
        return pd.DataFrame(columns=["date", "hour", "hourly_return"])

    # Explicit coercion
    df["hour_ts"] = pd.to_datetime(df["hour_ts"], errors="coerce", utc=True)
    df["portfolio_value"] = pd.to_numeric(df["portfolio_value"], errors="coerce")

    df = df.dropna(subset=["hour_ts", "portfolio_value"])
    df = df[df["portfolio_value"] > 0]

    if len(df) < 2:
        return pd.DataFrame(columns=["date", "hour", "hourly_return"])

    # Hour-over-hour returns
    df["hourly_return"] = df["portfolio_value"].pct_change()

    # Heatmap dimensions
    df["date"] = df["hour_ts"].dt.strftime("%Y-%m-%d")
    df["hour"] = df["hour_ts"].dt.hour

    df = df.dropna(subset=["hourly_return"])

    print(" Ze processed hourly returns:")
    print(df.head())
    
    print(df.to_string())

    return df[["date", "hour", "hourly_return"]]


if __name__ == "__main__":
    df = load_hourly_returns()
    print(df.head())
    print(df)
    print(df.groupby("hour")["hourly_return"].mean())
