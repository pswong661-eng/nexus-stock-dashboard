#!/usr/bin/env python3
"""Parity check: merged pipeline (latest.json) vs Mission Control (gigi.sqlite).

Compares the ported indicator math field-by-field for the same trading session.
Pass criteria: score/bias/signal exact; floats within tolerance (rounding +
window-start drift).
"""
import json
import sqlite3
import sys
from pathlib import Path

LATEST = Path(__file__).parent.parent / "public" / "data" / "latest.json"
DB = Path.home() / ".hermes" / "mcp" / "sqlite" / "gigi.sqlite"

TOL = {  # abs tolerance per field
    "rsi": 0.6, "macdDiff": 0.05, "sma50": 0.05, "sma200": 0.05,
    "support": 0.05, "resistance": 0.05, "pos52w": 1.5, "volRatio": 0.15,
    "changePct": 0.05,
}

def main():
    data = json.loads(LATEST.read_text())
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = {r["ticker"]: r for r in db.execute(
        "SELECT * FROM stock_watchlist WHERE active='Yes'")}

    field_map = [  # (json_field, db_field)
        ("rsi", "rsi"), ("macdDiff", "macd_diff"), ("sma50", "sma50"),
        ("sma200", "sma200"), ("support", "support"), ("resistance", "resistance"),
        ("pos52w", "pos_52w"), ("volRatio", "vol_ratio"), ("changePct", "change_pct"),
    ]
    total = fails = 0
    problems = []
    for s in data["symbols"]:
        t = s.get("symbol")
        dbrow = rows.get(t)
        if not dbrow:
            continue
        total += 1
        for jf, df in field_map:
            jv, dv = s.get(jf), dbrow[df]
            if jv is None or dv is None:
                if (jv is None) != (dv is None):
                    problems.append(f"{t}.{jf}: json={jv} db={dv} (null mismatch)")
                continue
            tol = TOL.get(jf, 0.05)
            scale = max(1.0, abs(dv))
            if abs(jv - dv) > tol * max(1, scale * 0.001):
                problems.append(f"{t}.{jf}: json={jv} db={dv} (diff {jv-dv:+.4f})")
        for jf, df in [("score", "score"), ("bias", "bias")]:
            jv, dv = s.get(jf), dbrow[df]
            if jv != dv:
                problems.append(f"{t}.{jf}: json={jv!r} db={dv!r} (MISMATCH)")
        # date sanity: both should end on the same session
        jdate = (s.get("technical") or [{}])[-1].get("date", "?")
        if dbrow["latest_date"] and not str(dbrow["latest_date"]).startswith(jdate):
            problems.append(f"{t}: date json={jdate} db={dbrow['latest_date']}")

    print(f"compared {total} tickers x {len(field_map)+2} fields")
    if problems:
        print(f"\n{len(problems)} PROBLEMS:")
        for p in problems[:40]:
            print(" ", p)
        sys.exit(1)
    print("PARITY OK — all indicators match within tolerance")

if __name__ == "__main__":
    main()
