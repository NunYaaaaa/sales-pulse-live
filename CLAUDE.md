# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sales Pulse Live is a client-side Etsy seller analytics dashboard, hosted as static files on GitHub Pages (`https://nunyaaaaa.github.io/sales-pulse-live/`). There is no build step, package manager or bundler: plain HTML, CSS and vanilla-JS ES modules. Charts are hand-drawn SVG, with no libraries. It is multi-tenant: each seller enters their own Etsy keystring and shared secret.

- `index.html`: marketing/landing page (inline CSS plus a small inline script); its CTAs link to `app.html`. It also loads `css/app.css` and builds its dashboard previews (KPIs, charts, orders, fee breakdown, ledger, Insights) from the app's own classes with static sample data. When you change what the dashboard shows, its labels, or what it claims about data handling, update the matching preview and copy here as well, so the landing page never advertises something the app doesn't do.
- `app.html`: dashboard markup only. It loads `css/tokens.css`, `css/app.css` and `js/main.js`.
- `css/tokens.css`: `:root` design tokens shared by both pages. Change colours here, not per page.

## Running and testing

Everything must be served over HTTP, because ES modules and the OAuth redirect don't work from `file://`. The repo's parent folder has a `.claude/launch.json` entry named `static` (`python -m http.server 8000`).

- `http://localhost:8000/test/mock.html`: the real dashboard running against a fake Etsy API (`test/mock-api.js`), with no OAuth needed. Use it to check any UI or data-flow change. `window.mockStats` counts requests per endpoint (use it to check that listings and reviews are only requested once Insights is open). XSS payloads sit in receipt 0's city and buyer name, a US state, a variation value, a listing title and a review; if `window.__xss` is set, escaping is broken.
- `http://localhost:8000/test/finance.test.html`: unit tests for the pure helpers: finance math, fee grouping, date bucketing, `escHtml`, `csvCell` (`test/finance.tests.js`) and the Insights calculations and chart escaping (`test/insights.tests.js`). Results are shown on the page and exposed as `window.testResult`. There is no Node on this machine, so tests run in the browser.
- Mock URL switches: `?expired` (first request returns 401, then the token refreshes), `?expired&norefresh` (session-expired path), `?currency=EUR`, `?preset=7d|30d|90d|ytd|1y|all` and `?tab=finances|insights` (clicked once the dashboard shows).
- Headless Chrome stops producing animation frames once a page settles, so bars that animate in via `requestAnimationFrame` can show at 0% in screenshots even though they work in a real browser.
- A live Etsy run needs the redirect URI entered on the connect screen to exactly match one registered on the seller's Etsy app. The Worker's CORS header currently allows only `https://nunyaaaaa.github.io`, so live API calls from `localhost` are blocked.

## Architecture (js/)

`main.js` is the entry point. It handles all clicks through a single delegated listener that maps `data-action="…"` attributes to handlers (the `ACTIONS` table), then boots: OAuth callback → saved session → connect screen. Don't add inline `on*=` handlers; add a `data-action` entry instead.

**Cloudflare Worker proxy.** All Etsy API traffic goes through `WORKER_BASE` (`config.js`), not directly to `api.etsy.com`. The Worker handles the token exchange (`/token`) and proxies `/application/...` paths to add CORS. It rate-limits aggressively.

**Auth (`auth.js`, `session.js`).** OAuth 2 PKCE. The user ID is parsed from the access-token prefix (`<user_id>.<token>`). All persisted state lives in `sessionStorage` under `spl_*` keys, accessed only through `session.get/set/remove`.

**HTTP (`api.js`).** `etsyFetch(path, {signal})` is the only function that should call the API. It reads the credentials from the session and sends `Authorization: Bearer` plus `x-api-key: <keystring>:<shared_secret>` (Etsy v3 requires both parts). It also:
- paces every request through `throttle()` (200 ms between request starts), so callers never add their own `sleep`s;
- retries 429s with backoff;
- on a 401, refreshes the token once through the Worker's `/token` with `grant_type=refresh_token`, and throws `AuthError` if that fails.

Helpers that get a non-2xx response throw `ApiError`. A 404 from `fetchPayment` means no Etsy Payments record and returns `null`.

**Pipeline (`loader.js`).** `loadDashboard` looks up the shop (which sets the currency), then `reload()` runs:
1. Receipts, filtered server-side by `min_created`/`max_created`. Line items are embedded in each receipt as `o.transactions`.
2. `loadAllDetails`: line items for any receipt that came without them, then the ledger in 30-day windows capped at a 365-day lookback (the span actually covered is `state.ledgerSpan`).
3. `ensureInsightsData`, only while the Insights tab is open: active and sold-out listings (kept for 10 minutes across ranges) and reviews from the period start up to now (cached per period start). It reuses the current load's signal and never starts a load of its own; each step tracks its own progress/error in `state.listingsStatus` / `state.reviewsStatus`.

Payments are never bulk-loaded. They're fetched when a row is expanded and by `ensurePayments` before an order export. Only one `reload()` runs at a time: a new one aborts the previous run through an `AbortController`, and every step checks `signal.aborted` before writing to state. Results are cached per date range for 5 minutes (`cachedRange` in `state.js`). Paged endpoints go through `fetchAllPages` in `api.js`.

**State (`state.js`).** One mutable `state` object shared by all modules:
- range data: `allOrders`, `ledgerEntries`, `ledgerSpan`, `detailsLoaded`, `reviews`
- `activeTab`, `shop` (the Etsy shop object), and the Insights-only `listings`
- per-receipt caches that survive range changes: `lineItems`, `payments`
- filters and chart modes

Read an order's line items with `lineItems(o)`. `clearRangeData()` runs on a range change; `clearData()` runs on disconnect.

**Finance math (`finance.js`, pure).** `categoriseEntry` classifies ledger entries using `LEDGER_TAXONOMY` (`config.js`), keyed on `ledger_type` (`ledgerType(e)`), not `type`. Pass-throughs (payouts like `DISBURSE2`) are excluded. Etsy records each sale (`PAYMENT_GROSS`) including the buyer's sales tax and Etsy buyer fee and then debits them (`sales_tax` / `buyer_fee`, negative; `sales_tax_refund` credits tax back), so the `collected` category is added to gross by its sign: gross and net exclude them, and net equals the balance change from every non-payout entry. Unknown types fall back to the amount's sign. When adding a ledger type, update `LEDGER_TAXONOMY`, `LEDGER_LABEL`, and `FEE_GROUPS` if it's a fee, `FEE_REFUND_OF` if it's a fee-refund credit (and `AD_FEES` / `LABEL_FEES` / `LABEL_REFUNDS` if Insights should report it), and add a test case. Check ledger semantics against a real shop's ledger, not just the mock.

**Insights (`insights.js` pure, `insights-view.js` rendering).** Every statistic is a pure function in `insights.js` that takes orders / ledger entries / listings / reviews (and `now` or `{from, to}` where time matters), with a test in `test/insights.tests.js`. `insights-view.js` only formats and escapes; `renderInsights()` is a no-op unless `state.activeTab === 'insights'`, because charts size themselves from `clientWidth`. Each panel labels what its data can't tell you (lifetime vs period numbers, the ledger's 365-day cap, no visits/conversion/ad-click data in Etsy's API).

**Rendering (`render.js`, `charts.js`, `export.js`).** `render*` functions redraw from `state`. The chart primitives (`drawLineChart`, `drawBarChart`, `drawHeatmap`) escape their labels; a custom `tooltipHtml` must escape API text itself. Escape every API string interpolated into HTML with `escHtml`. Use `money()` / `fmtMoney()` for Etsy money objects (`{amount, divisor, currency_code}`); `fmtMoney` formats in the shop's currency (`setCurrency`). All date bucketing and filter bounds use the viewer's local time (`localDateKey`, `dateStrToTs`); don't use `toISOString().slice(0,10)` for calendar days.
