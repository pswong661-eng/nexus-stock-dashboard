# Data Schema v2 — merged dashboard (2026-10-18)

`public/data/latest.json` is the single data contract for nanolaos.com.
v2 = nexus v1 fields **plus** the Mission Control indicator set. Nothing from
either dashboard is dropped except trade-plan levels (see Privacy).

## Top level
| Field | Notes |
|---|---|
| `generatedAt`, `staleAfterMinutes`, `source`, `dataStatus`, `marketStatus` | unchanged from v1 |
| `tickers` | full 36-symbol watchlist (local 35 + LAC) |
| `symbols[]` | per-ticker objects below |
| `summary`, `alerts`, `errors`, `warnings` | unchanged |
| `overlayRefreshedAt` | ISO timestamp of the last curated-overlay update |

## Per-ticker additions (from Mission Control `daily_stock_watchlist.py`)
| Field | Type | Meaning |
|---|---|---|
| `changePct` | float\|null | last-session % change |
| `sma50`, `sma200` | float\|null | rolling means (null if <50/<200 bars) |
| `ema50` | float\|null | EMA(50), pandas-style adjust=False |
| `rsi` | float\|null | RSI(14), simple rolling (matches local, not Wilder) |
| `macdDiff`, `macdStatus` | float\|null, string | MACD(12,26,9) hist + cross status |
| `high52`, `low52`, `pos52w` | float | 52-week window (252 bars) + position % |
| `support`, `resistance` | float | 20-day low/high |
| `bias` | string | OVERBOUGHT/OVERSOLD/BULLISH/BEARISH/NEUTRAL |
| `score` | int 0–4 | >sma50, >sma200, macd>0, 40<rsi<70 |
| `signal` | string | 🟢 >both / 🔴 <both / 🟡 variants |
| `volRatio`, `avgVol20`, `dataRows` | float/int | volume vs 20-day average |

## Curated overlay (`public/data/overlays/watchlist-overlay.json`)
Pushed by the local lynch skill / watchlist crons (not fetched at build):
`sector`, `company`, `lynch { category, peTtm, peFwd, pegy, verdict, note, screenedAt }`.

## Privacy invariant
`entry_low/entry_high/target_low/target_high/stop_loss` (any casing) are
**never** written to public JSON. `validate:data` fails the build if any
appear. Trade-plan levels exist only in the internal dashboard DB.

## Fallbacks
Price/OHLC: Massive → Yahoo chart → carried-forward `fallback.json`.
Short volume: Massive only; carry-forward with `source` marker when absent.
Fundamentals: Massive ratios (entitled) → SEC companyfacts → Yahoo quarterlies.

## Refresh cadence
GitHub Actions `0 22 * * 1-5` UTC (5AM ICT Tue–Sat) + trading-day gate
(`scripts/trading-day-gate.mjs`): deploy is skipped when the newest bar date
matches the deployed version — covers weekends **and** US market holidays.
