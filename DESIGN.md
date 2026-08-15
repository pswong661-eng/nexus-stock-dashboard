# NANO desk

Equity watchlist terminal. Dark, dense, one selected name.

## Type

- Sans: IBM Plex Sans 400/500/600
- Mono / numbers: IBM Plex Mono 400/500/600
- Numbers always `font-variant-numeric: tabular-nums`
- Body 14px. Labels 10–11px uppercase.

## Color

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#07090d` | Page |
| `--panel` | `#0e1218` | Surfaces |
| `--line` | `#1c2430` | Hairline |
| `--text` | `#e6edf3` | Primary |
| `--muted` | `#8b97a8` | Labels |
| `--up` | `#3dcc8a` | Positive |
| `--down` | `#f07178` | Negative |
| `--warn` | `#e6c36a` | Short / stale |
| `--accent` | `#6cb6ff` | Current pane / selected row |

No gradients. No blobs. Radius 6px.

## Layout

- Sticky quote header: last, day, YTD, RSI, vs EMA50, short, volume, as-of
- Left book: watchlist table
- Right stage: Chart / Flow / Financial / Insider / Alerts
- Hash: `#SYMBOL/pane`
- Mobile: stacked book + bottom dock
- Keyboard: `j`/`k` names, `1`–`5` panes

## Rules

- One selected ticker drives every pane
- Empty metrics are omitted, never N/A mosaics
- Compact currency (`$3.75B`)
- SEC links go to EDGAR or are omitted
- Copy is as-of and source only
