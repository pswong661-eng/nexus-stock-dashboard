# Nexus Stock Intelligence Dashboard

A public static stock dashboard inspired by the Kimi Nexus terminal at `https://t2wh36j4nxzys.kimi.page/`.

Live domain: `nanolaos.com` through the repository `CNAME` file. Cloudflare should proxy DNS to the GitHub Pages target; GitHub Actions handles the static build and deploy.

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
- `AAOI`
- `LITE`
- `AXTI`
- `NVAX`
- `NBIS`
- `LRCX`

Override in GitHub Actions with:

```bash
STOCK_SYMBOLS="SNDK,COHR,TLN,VST,AXTI,TSM,TSLA,UAMY,LLY" npm run refresh:data
```

## How live refresh works

- `scripts/refresh-data.mjs` uses Massive.com OHLC aggregates when `MASSIVE_API_KEY` is available, then falls back to Yahoo Finance's chart endpoint if Massive is unavailable.
- It writes normalized dashboard data to `public/data/latest.json` and `public/data/fallback.json`.
- The browser fetches the same-origin JSON every 60 seconds.
- GitHub Actions refreshes JSON at 5:00 AM ICT Tuesday-Saturday, after the prior US trading day closes, and deploys Pages on pushes.

For scheduled refreshes, add `MASSIVE_API_KEY` as a GitHub Actions repository secret. `POLYGON_API_KEY` is accepted locally as a deprecated alias, but new setup should use `MASSIVE_API_KEY`.

## Local development

Create a local env file from the example and fill in the Massive key:

```bash
cp .env.example .env
```

```bash
npm install
npm run refresh:data
npm run validate:data
npm run serve
```

Open `http://localhost:4173`.

## Codex development

Codex is configured globally on the development machine with the Massive.com MCP server:

```toml
[mcp_servers.massive]
command = "mcp_massive"
env_vars = ["MASSIVE_API_KEY", "POLYGON_API_KEY"]
```

Start Codex from a shell where the key is exported:

```bash
export MASSIVE_API_KEY="your_key_here"
codex
```

Use the `massive` MCP for endpoint discovery, market-data research, ticker validation, and checking Massive.com API behavior before changing `scripts/refresh-data.mjs`. Do not commit API keys.

## Deploy

This repo is configured for GitHub Pages using Actions and served at `nanolaos.com` through `CNAME`.

1. Go to **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Add repository secret `MASSIVE_API_KEY`.
4. Run the `Refresh Market Data` workflow once to update `public/data/*.json`.
5. Run the `Deploy GitHub Pages` workflow.
