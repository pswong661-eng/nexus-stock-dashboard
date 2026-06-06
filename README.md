# Nexus Stock Intelligence Dashboard

A public static stock dashboard inspired by the Kimi Nexus terminal at `https://t2wh36j4nxzys.kimi.page/`.

## Tickers

Default watchlist:

- `VST`
- `RGTI`
- `IONQ`
- `LAC`
- `UAMY`
- `SNPS`
- `QCOM`
- `RRX`

Override in GitHub Actions with:

```bash
STOCK_SYMBOLS="SNDK,COHR,TLN,VST,AXTI,TSM,TSLA,UAMY,LLY" npm run refresh:data
```

## How live refresh works

- `scripts/refresh-data.mjs` fetches 1-year daily data from Yahoo Finance's chart endpoint server-side.
- It writes normalized dashboard data to `public/data/latest.json` and `public/data/fallback.json`.
- The browser fetches the same-origin JSON every 60 seconds.
- GitHub Actions refreshes JSON every 30 minutes during approximate US market hours and redeploys Pages on pushes.

No API key is required for the current refresh script.

## Local development

```bash
npm install
npm run refresh:data
npm run validate:data
npm run serve
```

Open `http://localhost:4173`.

## Deploy

This repo is configured for GitHub Pages using Actions. In the GitHub repo settings:

1. Go to **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the `Deploy GitHub Pages` workflow.
4. Optional: run `Refresh Market Data` manually once.

