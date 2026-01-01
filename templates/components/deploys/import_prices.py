from binance.client import Client
import pandas as pd
import datetime
import pymysql
import os

# ==============================
# CONFIG
# ==============================

TOP_ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP"]

INTERVAL = Client.KLINE_INTERVAL_5MINUTE
DAYS_BACK = 7   # how far back to fetch

# MySQL connection
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "YOUR_PASSWORD",
    "database": "defaultdb",
    "cursorclass": pymysql.cursors.DictCursor
}

# Binance client (no auth required for klines)
client = Client()

# ==============================
# Helpers
# ==============================

def fetch_klines(symbol: str, days: int):
    start = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    end = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    klines = client.get_historical_klines(
        symbol + "USDT",
        INTERVAL,
        start,
        end
    )

    df = pd.DataFrame(
        klines,
        columns=[
            "timestamp",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_asset_volume",
            "num_trades",
            "taker_buy_base",
            "taker_buy_quote",
            "ignore"
        ],
    )

    if df.empty:
        return df

    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df["timestamp"] = df["timestamp"].dt.tz_localize(None)

    df["close"] = df["close"].astype(float)

    return df[["timestamp", "close"]]


def insert_rows(symbol, df):
    if df.empty:
        return 0

    conn = pymysql.connect(**DB_CONFIG)
    cur = conn.cursor()

    sql = """
        INSERT INTO crypto_price_5m (symbol, timestamp_utc, close_price)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE
            close_price = VALUES(close_price)
    """

    rows = [
        (symbol, row["timestamp"], row["close"])
        for _, row in df.iterrows()
    ]

    cur.executemany(sql, rows)
    conn.commit()

    inserted = cur.rowcount
    cur.close()
    conn.close()

    return inserted


# ==============================
# Main
# ==============================

if __name__ == "__main__":
    print("Starting price ingestion...")

    total_rows = 0

    for sym in TOP_ASSETS:
        print(f"Fetching {sym}...")
        df = fetch_klines(sym, DAYS_BACK)

        count = insert_rows(sym, df)
        total_rows += count

        print(f"  → {len(df)} rows fetched, {count} inserted")

    print("Done.")
    print("Total rows written:", total_rows)
