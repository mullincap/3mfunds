import pymysql
import os

print("connecting to db")
def connect_db():
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        port=int(os.getenv("DB_PORT")),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        ssl={"ssl": {}},  # DO requires SSL
    )
