import yfinance as yf
import pymysql
from datetime import datetime
from db import connect_db

SYMBOLS = {
    "SPY": "SPY",
    "QQQ": "QQQ",
    "GOLD": "GC=F",
    "DXY": "DX-Y.NYB"
}

START_DATE = "2025-09-22"

def upsert_prices(symbol, df):
    conn = connect_db()
    cur = conn.cursor()

    sql = """
    INSERT INTO market_price_daily (symbol, date, close_price, source)
    VALUES (%s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE close_price = VALUES(close_price)
    """

    rows = [
        (symbol, idx.date(), float(row["Close"]), "yahoo")
        for idx, row in df.iterrows()
        if not row["Close"] is None
    ]

    cur.executemany(sql, rows)
    conn.commit()
    cur.close()
    conn.close()

    print(f"{symbol}: {len(rows)} rows")

def main():
    for label, yf_symbol in SYMBOLS.items():
        print("Fetching", label)
        df = yf.download(
            yf_symbol,
            start=START_DATE,
            auto_adjust=True,
            progress=False
        )

        if df.empty:
            print("  → no data")
            continue

        upsert_prices(label, df)

if __name__ == "__main__":
    main()
