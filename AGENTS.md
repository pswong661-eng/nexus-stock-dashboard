# Agent Setup

This static dashboard is served at `nanolaos.com` through GitHub Pages and the `CNAME` file. Cloudflare DNS sits in front of the custom domain.

## Market Data

- `scripts/refresh-data.mjs` prefers Massive.com OHLC aggregates when `MASSIVE_API_KEY` is present.
- If Massive is unavailable or no key is present, the script falls back to Yahoo Finance chart data.
- SEC company facts and submissions are fetched with `SEC_USER_AGENT`.
- Never commit real API keys; use `.env` locally and GitHub Actions secrets remotely.

## Codex MCP

The development machine has the Massive.com MCP registered globally for Codex:

```toml
[mcp_servers.massive]
command = "mcp_massive"
env_vars = ["MASSIVE_API_KEY", "POLYGON_API_KEY"]
```

Start Codex from a shell with `MASSIVE_API_KEY` exported before using the `massive` MCP. Use it to inspect endpoints, validate ticker data assumptions, and compare API responses before changing refresh logic.
