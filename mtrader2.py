#!/usr/bin/env python3
"""
mtrader.py

BloFin trader:
  --mode close  -> close ALL open futures positions via market orders
  --mode open   -> read symbols + inputs from Google Sheets and open long market positions
  --mode status -> print account metrics + open positions

Fix included:
  - Some instruments have a max market order size (maxMarketSize). If our computed
    order exceeds that, we automatically split into multiple smaller market orders.

Docs:
  - /api/v1/market/instruments returns:
      contractValue, minSize, lotSize, maxMarketSize, maxLimitSize, ...
  - Error code 102015: "Market order exceeds maximum order size limit"
"""

import os
import re
import json
import time
import hmac
import base64
import hashlib
import argparse
from uuid import uuid4
from urllib.parse import urlencode

import requests
import gspread

# OPTIONAL: if you want .env support, uncomment:
# from dotenv import load_dotenv
# load_dotenv()

# ======================= CONFIG =======================

# Google Sheets
GOOGLE_SHEET_ID   = "1bKKyTxFb73suBDFStxq9pIt54RaTXy40bl1Y1Ga10MI"
GOOGLE_SHEET_ID = "12Cwc23gGYTNirhwZJF1HvtN73VkP7EcqbQFEIUPg2-0"
CURR_PORT_TAB     = "CURR"
CURR_PORT_RANGE   = "A1:AE2"
INPUTS_TAB        = "INPUTS"
INPUTS_RANGE      = "A1:G2"

CREDENTIALS_FILE  = "credentials.json"
TOKEN_FILE        = "token.json"

# BloFin REST
BLOFIN_BASE_URL = "https://openapi.blofin.com"

# Environment variables for secrets (DO NOT hardcode keys in code)
BLOFIN_API_KEY        = os.environ.get("BLOFIN_API_KEY")
BLOFIN_API_SECRET     = os.environ.get("BLOFIN_API_SECRET")
BLOFIN_API_PASSPHRASE = os.environ.get("BLOFIN_API_PASSPHRASE")

#BLOFIN_API_KEY       = "6e4b9ce9be9d43aaae991038afb8593f"
#BLOFIN_API_SECRET    = "6eae9d91a9e64462ac0d5d69f900347f"
#BLOFIN_API_PASSPHRASE= "pass"

BLOFIN_API_KEY       = "d5f31f7f8fb549d58fa07cc6d285e5da"
BLOFIN_API_SECRET    = "64329aaa3e714d76942bae8a69e2d1c2"
BLOFIN_API_PASSPHRASE= "pass"




# Trading behavior
REQUEST_TIMEOUT = 15
SLEEP_BETWEEN_ORDERS_SEC = 0.15
SLEEP_BETWEEN_SYMBOLS_SEC = 0.20

# If an instrument doesn't return maxMarketSize for some reason, we won't split.
# You can set a conservative fallback cap (in contracts) if you want:
FALLBACK_MAX_MARKET_SIZE = None  # e.g. 50000


# ======================= HELPERS ======================

def auth_gspread_oauth():
    gc = gspread.oauth(
        credentials_filename=CREDENTIALS_FILE,
        authorized_user_filename=TOKEN_FILE,
    )
    return gc


def parse_stop_loss(val):
    """
    "-8.5%"  -> -0.085
    "-0.085" -> -0.085
     "8.5%"  -> -0.085 (positive treated as negative)
      ""     -> 0.0
    Clamped to [-1.0, 0.0].
    """
    if val is None:
        return 0.0
    s = str(val).strip().replace(" ", "")
    if s == "":
        return 0.0
    try:
        if s.endswith("%"):
            x = float(s[:-1]) / 100.0
        else:
            x = float(s)
    except Exception:
        return 0.0

    if x > 0:
        x = -abs(x)

    x = max(-1.0, min(0.0, x))
    return x


def normalize_symbol(raw):
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if s == "":
        return None
    if not re.match(r"^[A-Z0-9]+$", s):
        print(f"⚠️  Skipping invalid symbol from sheet: {s!r}")
        return None
    return s


def safe_float(x, default=None):
    try:
        if x is None or x == "":
            return default
        return float(x)
    except Exception:
        return default


def safe_int(x, default=None):
    try:
        if x is None or x == "":
            return default
        return int(float(x))
    except Exception:
        return default


def floor_to_step(value, step):
    """
    Floors value down to nearest multiple of step.
    step may be float like 0.1, 1, 10, etc.
    """
    if step is None or step <= 0:
        return value
    # Avoid float drift by scaling
    inv = 1.0 / step
    return (int(value * inv) / inv)


def round_to_lot(value, lot_size):
    """
    BloFin size increments by lotSize (in contracts).
    For market orders, safest is to floor (not round up).
    """
    if lot_size is None or lot_size <= 0:
        return value
    return floor_to_step(value, lot_size)


# ==================== SHEET LOADING ===================

def load_sheet_inputs():
    gc = auth_gspread_oauth()
    sh = gc.open_by_key(GOOGLE_SHEET_ID)

    ws_port = sh.worksheet(CURR_PORT_TAB)
    port_vals = ws_port.get(CURR_PORT_RANGE) or []
    if len(port_vals) < 2:
        raise RuntimeError(f"{CURR_PORT_TAB}!{CURR_PORT_RANGE} must contain at least 2 rows.")

    row2 = port_vals[1]
    raw_syms = row2[1:]
    symbols = []
    for c in raw_syms:
        sym = normalize_symbol(c)
        if sym and sym not in symbols:
            symbols.append(sym)

    if not symbols:
        raise RuntimeError("No valid symbols found in CURR second row.")

    ws_in = sh.worksheet(INPUTS_TAB)
    vals = ws_in.get(INPUTS_RANGE) or []
    if len(vals) < 2:
        raise RuntimeError(f"{INPUTS_TAB}!{INPUTS_RANGE} must contain at least 2 rows (headers + values).")

    headers = vals[0]
    data = vals[1]
    d = {}
    for i, h in enumerate(headers):
        key = str(h).strip().lower()
        if key:
            d[key] = data[i] if i < len(data) else ""

    start_balance = safe_float(str(d.get("start_balance", 0)).replace(",", ""), default=None)
    leverage      = safe_float(str(d.get("leverage", 1)).replace(",", ""), default=1.0)
    stop_loss     = parse_stop_loss(d.get("stop_loss", 0))
    max_port      = safe_int(str(d.get("max_port", 1)).replace(",", ""), default=1)

    if start_balance is None:
        raise RuntimeError(f"Invalid start_balance in sheet: {d.get('start_balance')}")

    max_port = max(1, int(max_port))
    leverage = max(1.0, float(leverage))

    print("\n📄 Loaded symbols:", symbols)
    print(f"start_balance={start_balance}, leverage={leverage}, stop_loss={stop_loss}, max_port={max_port}\n")

    return symbols, float(start_balance), float(leverage), float(stop_loss), int(max_port)


# ==================== BLOFIN AUTH =====================

def require_blofin_creds():
    if not BLOFIN_API_KEY or not BLOFIN_API_SECRET or not BLOFIN_API_PASSPHRASE:
        raise RuntimeError(
            "BloFin API credentials not set. Please export:\n"
            "  export BLOFIN_API_KEY=\"...\"\n"
            "  export BLOFIN_API_SECRET=\"...\"\n"
            "  export BLOFIN_API_PASSPHRASE=\"...\""
        )


def blofin_headers(request_path, method, body=None):
    """
    Signature:
      prehash = path + method + timestamp + nonce + body_json
    """
    require_blofin_creds()

    ts = str(int(time.time() * 1000))
    nonce = str(uuid4())

    if body is None or method.upper() == "GET":
        body_str = ""
    else:
        body_str = json.dumps(body, separators=(",", ":"), ensure_ascii=False)

    prehash = f"{request_path}{method}{ts}{nonce}{body_str}"
    hex_signature = hmac.new(
        BLOFIN_API_SECRET.encode(),
        prehash.encode(),
        hashlib.sha256
    ).hexdigest().encode()
    signature = base64.b64encode(hex_signature).decode()

    return {
        "ACCESS-KEY": BLOFIN_API_KEY,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": ts,
        "ACCESS-NONCE": nonce,
        "ACCESS-PASSPHRASE": BLOFIN_API_PASSPHRASE,
        "Content-Type": "application/json",
        "User-Agent": "BlofinTrader/1.1 (Python)"
    }


def blofin_request(method, path, params=None, body=None):
    method = method.upper()
    params = params or {}

    query_str = ""
    if params:
        query_str = "?" + urlencode(params, doseq=True)

    request_path = path + query_str
    headers = blofin_headers(request_path, method, body)

    if method == "GET":
        url = BLOFIN_BASE_URL + request_path
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
    else:
        url = BLOFIN_BASE_URL + path + query_str
        payload = body or {}
        resp = requests.post(
            url,
            headers=headers,
            data=json.dumps(payload, separators=(",", ":")),
            timeout=REQUEST_TIMEOUT
        )

    text = resp.text
    try:
        data = resp.json()
    except ValueError:
        raise RuntimeError(
            f"BloFin non-JSON response.\n"
            f"  HTTP {resp.status_code}\n"
            f"  URL: {url}\n"
            f"  Body (truncated): {text[:500]!r}"
        )

    code = str(data.get("code", ""))
    msg = data.get("msg", "")
    if code not in ("0", ""):
        print(f"⚠️  BloFin error: code={code}, msg={msg}")
    return data


# ============= PUBLIC MARKET DATA HELPERS =============

def get_mark_price(inst_id):
    """
    GET /api/v1/market/tickers?instId=<instId>
    Reads data[0]['last'].
    """
    url = f"{BLOFIN_BASE_URL}/api/v1/market/tickers?instId={inst_id}"
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        price_str = data["data"][0]["last"]
        return float(price_str)
    except Exception as e:
        print(f"  ⚠️  Failed to fetch mark price for {inst_id}: {e}")
        return None


def get_instrument_info(inst_id):
    """
    GET /api/v1/market/instruments?instId=<instId>

    Returns dict with:
      contractValue, minSize, lotSize, maxMarketSize, maxLimitSize
    """
    url = f"{BLOFIN_BASE_URL}/api/v1/market/instruments?instId={inst_id}"
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        row = data["data"][0]
    except Exception as e:
        print(f"  ⚠️  Failed to fetch instrument info for {inst_id}: {e}")
        return None

    info = {
        "contractValue": safe_float(row.get("contractValue"), default=None),
        "minSize":       safe_float(row.get("minSize"), default=None),
        "lotSize":       safe_float(row.get("lotSize"), default=None),
        "maxMarketSize": safe_float(row.get("maxMarketSize"), default=None),
        "maxLimitSize":  safe_float(row.get("maxLimitSize"), default=None),
        "tickSize":      safe_float(row.get("tickSize"), default=None),
        "state":         row.get("state"),
    }
    return info


# ================= ACCOUNT-LEVEL HELPERS ==============

def get_positions():
    res = blofin_request("GET", "/api/v1/account/positions")
    data = res.get("data", [])
    return data if isinstance(data, list) else []


def close_all_positions():
    print("🔻 Closing all open positions on BloFin...\n")

    positions = get_positions()
    if not positions:
        print("No open positions found.")
        return

    for pos in positions:
        inst_id       = pos.get("instId")
        margin_mode   = pos.get("marginMode", "cross")
        position_side = pos.get("positionSide", "net")
        if not inst_id:
            continue

        print(f"  Closing {inst_id} (marginMode={margin_mode}, positionSide={position_side}) ...")
        body = {
            "instId": inst_id,
            "marginMode": margin_mode,
            "positionSide": position_side,
            "clientOrderId": ""
        }
        res = blofin_request("POST", "/api/v1/trade/close-position", body=body)
        print("    → response:", res)

    print("\n✅ Done: close_all_positions()")


def set_leverage(inst_id, leverage, margin_mode="cross"):
    lev_int = max(1, int(leverage))
    lev_str = str(lev_int)

    print(f"  Setting leverage for {inst_id} to {lev_str}x (marginMode={margin_mode}) ...")
    body = {"instId": inst_id, "leverage": lev_str, "marginMode": margin_mode}
    res = blofin_request("POST", "/api/v1/account/set-leverage", body=body)
    print("    → response:", res)
    return res


def get_account_metrics():
    """
    Uses your format:
    { "data": { "totalEquity": "...", "details":[{"availableEquity":"..."}] } }
    """
    res = blofin_request("GET", "/api/v1/account/balance")
    data = res.get("data", {}) or {}

    total_equity = safe_float(data.get("totalEquity"), default=None)

    details = data.get("details", [])
    usdt = details[0] if isinstance(details, list) and details else None

    if not usdt:
        return total_equity, None, None, None

    available = safe_float(usdt.get("availableEquity"), default=None)

    if total_equity is not None and available is not None:
        funds_in_use = total_equity - available
        margin_ratio = (funds_in_use / total_equity) * 100 if total_equity > 0 else 0.0
    else:
        funds_in_use = None
        margin_ratio = None

    return total_equity, available, funds_in_use, margin_ratio


# ================== TPSL (STOP LOSS) ==================

def place_tpsl_for_long(inst_id, stop_loss, approx_entry):
    if stop_loss >= 0:
        return

    sl_price = approx_entry * (1.0 + stop_loss)
    sl_price_str = f"{sl_price:.6f}"

    print(f"  (SL/TPSL) entry≈{approx_entry}, stop_loss={stop_loss} → SL={sl_price_str}, size=-1 (entire position)")

    body = {
        "instId": inst_id,
        "marginMode": "cross",
        "positionSide": "net",
        "side": "sell",
        "tpTriggerPrice": "",
        "tpOrderPrice": "",
        "slTriggerPrice": sl_price_str,
        "slOrderPrice": "-1",
        "size": "-1",
        "reduceOnly": "true",
        "clientOrderId": ""
    }

    try:
        res = blofin_request("POST", "/api/v1/trade/order-tpsl", body=body)
        print("  (SL/TPSL) response:", res)
    except Exception as e:
        print(f"  ⚠️  Failed to place TPSL SL for {inst_id}: {e}")


# ================== ORDER SPLITTING ===================

def extract_nested_order_error(ord_res):
    """
    BloFin often returns:
      { code:"1", msg:"All operations failed", data:[{code:"102015", msg:"..."}] }
    This returns ("102015", "Market order exceeds ...") when present.
    """
    try:
        data = ord_res.get("data")
        if isinstance(data, list) and data:
            inner = data[0]
            return str(inner.get("code", "")), inner.get("msg", "")
    except Exception:
        pass
    return "", ""


def place_market_order(inst_id, size_str, side="buy", margin_mode="cross", position_side="net"):
    body = {
        "instId": inst_id,
        "marginMode": margin_mode,
        "positionSide": position_side,
        "side": side,
        "orderType": "market",
        "size": str(size_str),
        "reduceOnly": "false",
        "clientOrderId": ""
    }
    return blofin_request("POST", "/api/v1/trade/order", body=body)


def place_market_order_chunked(inst_id, total_size, lot_size, min_size, max_market_size):
    """
    Places one or more market orders to reach total_size (contracts),
    respecting lotSize/minSize/maxMarketSize.
    Returns True on success, False otherwise.
    """
    # Normalize constraints
    if lot_size is None or lot_size <= 0:
        lot_size = 1.0
    if min_size is None or min_size <= 0:
        min_size = lot_size

    if max_market_size is None or max_market_size <= 0:
        max_market_size = FALLBACK_MAX_MARKET_SIZE

    # Round total_size down to lot
    total_size = round_to_lot(float(total_size), lot_size)

    if total_size < min_size:
        print(f"  ⚠️  Size after lot rounding is below minSize ({total_size} < {min_size}).")
        return False

    if not max_market_size:
        # No cap available -> just try once
        ord_res = place_market_order(inst_id, total_size)
        if isinstance(ord_res, dict) and ord_res.get("code") == "0":
            return True
        inner_code, inner_msg = extract_nested_order_error(ord_res if isinstance(ord_res, dict) else {})
        print(f"  ⚠️  Order failed (no maxMarketSize available). inner={inner_code} {inner_msg} full={ord_res}")
        return False

    # Ensure chunk is rounded to lot and >= min
    chunk_cap = round_to_lot(max_market_size, lot_size)
    if chunk_cap < min_size:
        chunk_cap = min_size

    remaining = total_size
    order_num = 0

    while remaining >= min_size - 1e-12:
        order_num += 1
        chunk = min(remaining, chunk_cap)
        chunk = round_to_lot(chunk, lot_size)

        if chunk < min_size:
            break

        print(f"  🧩 Chunk {order_num}: placing market buy size={chunk} (remaining before={remaining})")

        ord_res = place_market_order(inst_id, chunk)

        # Success
        if isinstance(ord_res, dict) and ord_res.get("code") == "0":
            remaining = round_to_lot(remaining - chunk, lot_size)
            time.sleep(SLEEP_BETWEEN_ORDERS_SEC)
            continue

        # Handle max-size error specifically -> reduce chunk and retry
        inner_code, inner_msg = extract_nested_order_error(ord_res if isinstance(ord_res, dict) else {})
        if inner_code == "102015":
            # reduce chunk cap (e.g. 80%) and retry this same remaining
            new_cap = round_to_lot(max(min_size, chunk_cap * 0.8), lot_size)
            if new_cap >= chunk_cap or new_cap < min_size:
                print(f"  ⚠️  Still hitting max size limit, cannot reduce further. inner={inner_code} msg={inner_msg}")
                return False
            print(f"  ⚠️  Hit maxMarketSize. Reducing chunk cap {chunk_cap} -> {new_cap} and retrying...")
            chunk_cap = new_cap
            time.sleep(SLEEP_BETWEEN_ORDERS_SEC)
            continue

        print(f"  ⚠️  Chunk order failed. inner={inner_code} msg={inner_msg} full={ord_res}")
        return False

    if remaining > (min_size / 2.0):
        # leftover too big to ignore
        print(f"  ⚠️  Remaining size not filled due to constraints: remaining={remaining}, minSize={min_size}")
        return False

    return True


# ===================== STATUS MODE ====================

def mode_status():
    print("\n Checking BloFin account...\n")
    equity, available, margin_used, _ = get_account_metrics()

    fmt = lambda x: f"${x:,.2f}" if x is not None else "None"
    used_percent = round((margin_used / equity) * 100, 1) if (margin_used and equity and equity > 0) else 0.0

    print(f"💰 Total Equity:        {fmt(equity)}")
    print("──────────────────────────────")
    print(f"📘 Funds in Use:        {fmt(margin_used)}  ({used_percent}%)")
    print(f"🏦 Funds Available:     {fmt(available)}")
    print("──────────────────────────────")

    res = blofin_request("GET", "/api/v1/account/positions")
    positions = res.get("data", []) if isinstance(res, dict) else []
    pos_count = len(positions)
    print(f"📦 Position Count:      {pos_count}")
    print("──────────────────────────────")

    floating_pnl = 0.0
    for p in positions:
        pnl = safe_float(p.get("upl") or p.get("unrealizedPnl") or p.get("unrealizedPnlUsd"), default=0.0)
        floating_pnl += pnl

    floating_pnl_pct = (floating_pnl / margin_used * 100) if (margin_used and margin_used > 0) else 0.0
    print(f"📈 Floating PnL:        {fmt(floating_pnl)} ({floating_pnl_pct:.2f}%)\n")

    if not positions:
        print("No open positions.\n")
        return

    for p in positions:
        instId = p.get("instId")
        size = safe_float(p.get("positions"), default=0.0)
        mark_price = get_mark_price(instId)
        info = get_instrument_info(instId) or {}
        ctVal = info.get("contractValue")

        notional = (size * mark_price * ctVal) if (size and mark_price and ctVal) else None
        pnl = safe_float(p.get("unrealizedPnl"), default=None)
        pnl_pct = safe_float(p.get("unrealizedPnlRatio"), default=None)
        pnl_pct = pnl_pct * 100.0 if pnl_pct is not None else None

        print("──────────────────────────────")
        print(f"symb:           {instId}")
        print(f"notional:       {fmt(notional)}")
        print(f"unrealizedPnL:  {fmt(pnl)}")
        print(f"unrealizedPnL%: {pnl_pct:.2f}%" if pnl_pct is not None else "unrealizedPnL%: None")

    print("──────────────────────────────\n")


# ================== POSITION OPENING ==================

def open_positions_from_google(amount_override: float | None = None):
    symbols, sheet_balance, leverage, stop_loss, max_port = load_sheet_inputs()

    # -------------------------------
    # Resolve starting balance
    # -------------------------------
    if amount_override is not None:
        start_balance = float(amount_override)
        print(f"\n💰 Using OVERRIDDEN start balance from CLI: {start_balance}")
    else:
        start_balance = sheet_balance
        print(f"\n💰 Using start balance from Google Sheet: {start_balance}")

    # per-position notional
    position_notional = start_balance / max_port
    print(f"Position notional per asset = {position_notional}\n")

    # counters (FIXED)
    opened = 0
    idx = 0

    while opened < max_port and idx < len(symbols):
        sym = symbols[idx]
        idx += 1
        inst_id = f"{sym}-USDT"

        print(f"\n=== Opening {sym} (instId={inst_id}) ===")

        # Pull instrument constraints
        info = get_instrument_info(inst_id)
        if not info:
            print(f"  ⚠️  Skipping {inst_id}: instrument info unavailable")
            continue

        if info.get("state") and str(info.get("state")).lower() != "live":
            print(f"  ⚠️  Skipping {inst_id}: instrument state={info.get('state')}")
            continue

        ctVal         = info.get("contractValue")
        lotSize       = info.get("lotSize")
        minSize       = info.get("minSize")
        maxMarketSize = info.get("maxMarketSize")

        # -------------------------------
        # Set leverage (soft fail)
        # -------------------------------
        try:
            lev_res = set_leverage(inst_id, leverage, margin_mode="cross")
        except Exception as e:
            print(f"  ⚠️  set_leverage exception for {inst_id}: {e}")
            lev_res = None

        if isinstance(lev_res, dict):
            code = str(lev_res.get("code", ""))
            msg  = lev_res.get("msg", "")
            if code != "0" and "not exist" in str(msg).lower():
                print(f"  ⚠️  Skipping {inst_id}: instrument not exist ({msg})")
                continue

        # -------------------------------
        # Fetch mark price
        # -------------------------------
        mark_price = get_mark_price(inst_id)
        if not mark_price or mark_price <= 0:
            print(f"  ⚠️  Skipping {inst_id}: invalid mark price → {mark_price}")
            continue

        # -------------------------------
        # Compute size
        # -------------------------------
        N = position_notional

        if ctVal and ctVal > 0:
            raw_size = N / ((mark_price * ctVal) / leverage)
        else:
            raw_size = N / mark_price

        size = round_to_lot(raw_size, lotSize)

        if minSize and size < minSize:
            print(f"  ⚠️  Skipping {inst_id}: computed size {size} < minSize {minSize}")
            continue

        print(
            f"  markPrice={mark_price}, ctVal={ctVal}, lotSize={lotSize}, minSize={minSize}, "
            f"maxMarketSize={maxMarketSize} → raw_size≈{raw_size:.4f} → size={size}"
        )

        # -------------------------------
        # Place market order(s)
        # -------------------------------
        ok = place_market_order_chunked(
            inst_id=inst_id,
            total_size=size,
            lot_size=lotSize,
            min_size=minSize,
            max_market_size=maxMarketSize
        )

        if not ok:
            print(f"  ⚠️  Skipping {inst_id}: failed to open via chunked market orders")
            continue

        print(f"  ✅ Successfully opened {inst_id}")
        opened += 1

        # -------------------------------
        # Optional TPSL
        # -------------------------------
        if stop_loss < 0:
            place_tpsl_for_long(inst_id, stop_loss, approx_entry=mark_price)

        time.sleep(SLEEP_BETWEEN_SYMBOLS_SEC)

    if opened < max_port:
        print(f"\n⚠️ WARNING: Only opened {opened}/{max_port} positions (ran out of valid symbols).")
    else:
        print(f"\n✅ SUCCESS: Opened exactly {opened} positions.\n")

# ========================== MAIN ======================

def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--mode",
        choices=["open", "close", "status"],
        required=True,
        help="open = open positions from Google sheet; close = close all open positions",
    )

    parser.add_argument(
        "--amount",
        type=float,
        default=None,
        help="Override start_balance from Google Sheets (USDT)"
    )

    args = parser.parse_args()
    if args.mode == "close":
        close_all_positions()
    elif args.mode == "open":
        open_positions_from_google(amount_override=args.amount)
    elif args.mode == "status":
        mode_status()
    else:
        raise SystemExit(f"Unknown mode: {args.mode}")


if __name__ == "__main__":
    main()
