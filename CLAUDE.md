# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sales Pulse Live is a client-side Etsy seller analytics dashboard, hosted as static files on GitHub Pages (`https://nunyaaaaa.github.io/sales-pulse-live/`). There is no build step, package manager or bundler: plain HTML, CSS and vanilla-JS ES modules. Charts are hand-drawn SVG, with no libraries. It is multi-tenant: each seller enters their own Etsy keystring and shared secret.

- `index.html`: marketing/landing page (inline CSS plus a small inline script); its CTAs link to `app.html`.
- `app.html`: dashboard markup only. It loads `css/tokens.css`, `css/app.css` and `js/main.js`.
- `css/tokens.css`: `:root` design tokens shared by both pages. Change colours here, not per page.

## Running and testing

Everything must be served over HTTP, because ES modules and the OAuth redirect don't work from `file://`. The repo's parent folder has a `.claude/launch.json` entry named `static` (`python -m http.server 8000`).

- `http://localhost:8000/test/mock.html`: the real dashboard running against a fake Etsy API (`test/mock-api.js`), with no OAuth needed. Use it to check any UI or data-flow change. `window.mockStats` counts requests per endpoint. Receipt 0 has an XSS payload in its city and buyer name; if `window.__xss` is set, escaping is broken.
- `http://localhost:8000/test/finance.test.html`: unit tests for `js/finance.js` (cases live in `test/finance.tests.js`). Results are shown on the page and exposed as `window.testResult`. There is no Node on this machine, so tests run in the browser.
- A live Etsy run needs the redirect URI entered on the connect screen to exactly match one registered on the seller's Etsy app.

## Architecture (js/)

`main.js` is the entry point. It handles all clicks through a single delegated listener that maps `data-action="…"` attributes to handlers (the `ACTIONS` table), then boots: OAuth callback → saved session → connect screen. Don't add inline `on*=` handlers; add a `data-action` entry instead.

**Cloudflare Worker proxy.** All Etsy API traffic goes through `WORKER_BASE` (`config.js`), not directly to `api.etsy.com`. The Worker handles the token exchange (`/token`) and proxies `/application/...` paths to add CORS. It rate-limits aggressively.

**Auth (`auth.js`, `session.js`).** OAuth 2 PKCE. The user ID is parsed from the access-token prefix (`<user_id>.<token>`). All persisted state lives in `sessionStorage` under `spl_*` keys, accessed only through `session.get/set`; `creds()` returns `{token, apiKey, shopId}`.

**HTTP (`api.js`).** `etsyFetch` is the only function that should call the API. It sends `Authorization: Bearer` plus `x-api-key: <keystring>:<shared_secret>` (Etsy v3 requires both parts) and retries 429s with backoff. `fetchOrders`, `fetchReceiptDetail` and `fetchLedger` build on it.

**Pipeline (`loader.js`).** `loadDashboard` → shop lookup → `backgroundLoad`: receipts (filtered server-side by `min_created`/`max_created`), then `loadAllDetails` (per-receipt details, then the ledger in 30-day windows capped at a 365-day lookback). Changing the date filter calls `resetAndReload`.

**State (`state.js`).** One mutable `state` object shared by all modules (`allOrders`, `detailCache`, `ledgerEntries`, filters, chart modes). `clearData()` resets the fetched data.

**Finance math (`finance.js`, pure).** `categoriseEntry` classifies ledger entries using `LEDGER_TAXONOMY` (`config.js`), keyed on `ledger_type` (`ledgerType(e)`), not `type`. Pass-throughs (payouts like `DISBURSE2`, sales tax) are excluded; unknown types fall back to the amount's sign. When adding a ledger type, update `LEDGER_TAXONOMY`, `LEDGER_LABEL`, and `FEE_GROUPS` if it's a fee, and add a test case.

**Rendering (`render.js`, `charts.js`, `export.js`).** `render*` functions redraw from `state`. Escape every API string interpolated into HTML with `escHtml`. Use `money()` / `fmtMoney()` for Etsy money objects (`{amount, divisor, currency_code}`).
