# blofin.py
import os
import json
import time
import hmac
import base64
import hashlib
import requests
from uuid import uuid4
from urllib.parse import urlencode

from dotenv import load_dotenv
load_dotenv()

BLOFIN_BASE_URL = "https://openapi.blofin.com"

BLOFIN_API_KEY = os.getenv('BLOFIN_API_KEY')
BLOFIN_API_SECRET = os.getenv('BLOFIN_API_SECRET')
BLOFIN_API_PASSPHRASE = os.getenv('BLOFIN_API_PASSPHRASE')

if not all([BLOFIN_API_KEY, BLOFIN_API_SECRET, BLOFIN_API_PASSPHRASE]):
    raise RuntimeError("Missing BloFin API env vars")


def _headers(request_path: str, method: str, body=None):
    ts = str(int(time.time() * 1000))
    nonce = str(uuid4())

    body_str = "" if body is None or method == "GET" else json.dumps(body, separators=(",", ":"))
    prehash = f"{request_path}{method}{ts}{nonce}{body_str}"

    sig_hex = hmac.new(
        BLOFIN_API_SECRET.encode(),
        prehash.encode(),
        hashlib.sha256
    ).hexdigest().encode()

    signature = base64.b64encode(sig_hex).decode()

    return {
        "ACCESS-KEY": BLOFIN_API_KEY,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-NONCE": nonce,
        "ACCESS-PASSPHRASE": BLOFIN_API_PASSPHRASE,
        "Content-Type": "application/json",
        "User-Agent": "3MFunds/1.0"
    }


def blofin_request(method: str, path: str, params=None):
    method = method.upper()
    params = params or {}

    qs = "?" + urlencode(params) if params else ""
    request_path = path + qs

    headers = _headers(request_path, method)

    url = BLOFIN_BASE_URL + request_path
    r = requests.get(url, headers=headers, timeout=10)

    r.raise_for_status()
    return r.json()


# ===============================
# FUTURES POSITIONS (THIS IS IT)
# ===============================

def blofin_get_positions():
    """
    Fetch open positions for UNIFIED account
    """
    path = "/api/v1/account/positions"

    res = blofin_request("GET", path)

    if res.get("code") != "0":
        raise RuntimeError(f"BloFin error: {res}")

    data = res.get("data", [])

    # BloFin sometimes nests positions
    if isinstance(data, dict) and "positions" in data:
        return data["positions"]

    if isinstance(data, list):
        return data

    return []
