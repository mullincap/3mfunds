import os, time, json, hmac, hashlib, base64
import requests
from uuid import uuid4
from urllib.parse import urlencode

BLOFIN_BASE_URL = "https://openapi.blofin.com"

BLOFIN_API_KEY = os.getenv("BLOFIN_API_KEY")
BLOFIN_API_SECRET = os.getenv("BLOFIN_API_SECRET")
BLOFIN_API_PASSPHRASE = os.getenv("BLOFIN_API_PASSPHRASE")


def blofin_headers(request_path, method, body=None):
    ts = str(int(time.time() * 1000))
    nonce = str(uuid4())
    body_str = "" if not body or method == "GET" else json.dumps(body, separators=(",", ":"))

    prehash = f"{request_path}{method}{ts}{nonce}{body_str}"

    sig = hmac.new(
        BLOFIN_API_SECRET.encode(),
        prehash.encode(),
        hashlib.sha256
    ).hexdigest()

    return {
        "ACCESS-KEY": BLOFIN_API_KEY,
        "ACCESS-SIGN": base64.b64encode(sig.encode()).decode(),
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-NONCE": nonce,
        "ACCESS-PASSPHRASE": BLOFIN_API_PASSPHRASE,
        "Content-Type": "application/json"
    }


def blofin_request(method, path, params=None, body=None):
    params = params or {}
    qs = "?" + urlencode(params) if params else ""
    request_path = path + qs

    headers = blofin_headers(request_path, method, body)
    url = BLOFIN_BASE_URL + request_path

    r = requests.request(method, url, headers=headers, json=body, timeout=10)
    r.raise_for_status()
    return r.json()
