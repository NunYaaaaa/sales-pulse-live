// ─── DRILL-DOWNS: the breakdown popup behind a summary card ────────────────
// A card with data-action="drill" data-drill="<key>" opens #drill with
// DRILLS[key], built from state for the selected period. Each breakdown's
// total is the card's own figure. API text is escaped here.
import { computeLedgerTotals } from './finance.js';
import { aovBreakdown, customerStats, discountedOrders, feeBreakdown, grossBreakdown, listingStats, orderStatusCounts, refundedOrders, reviewStats, unshippedOrders } from './insights.js';
import { listingTitles, reviewPeriod, stars } from './insights-view.js';
import { ordersWithItems, state } from './state.js';
import { escHtml, fmtMoney, money, orderSales } from './util.js';

const $ = id => document.getElementById(id);

const LEDGER_WAIT = 'Financial details are still loading.';

const fmtC = c => fmtMoney(c / 100);
const signed = c => `${c < 0 ? '−' : '+'}${fmtC(Math.abs(c))}`;
const fmtNum = n => n.toLocaleString('en-US');
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const pct  = x => x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`;
const fmtDate = (ts, year = true) => new Date(ts * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', ...(year && { year:'numeric' }) });
/** "Oct 6", with the year when it isn't this year's (all-time lists span years). */
const shortDate = ts => fmtDate(ts, new Date(ts * 1000).getFullYear() !== new Date().getFullYear());
const empty = msg => `<div class="ins-empty">${msg}</div>`;
const note  = msg => `<p class="drill-note">${msg}</p>`;
const total = (label, amount) => `<div class="drill-total"><span>${label}</span><span class="drill-amt">${amount}</span></div>`;
const tiles = (...t) => `<div class="ins-tiles drill-tiles">${t.map(([label, val]) => `<div class="ins-tile"><div class="ins-tile-label">${label}</div><div class="ins-tile-val">${val}</div></div>`).join('')}</div>`;
const ledgerReady = () => state.detailsLoaded && !!state.ledgerEntries;

/** The selected period, as dates ("Sep 10 – Oct 9, 2026"). */
function periodText() {
  const now = Math.floor(Date.now() / 1000);
  const from = state.filterFrom, to = Math.min(state.filterTo ?? now, now);
  if (from == null) return `All time, to ${fmtDate(to)}`;
  const sameYear = new Date(from * 1000).getFullYear() === new Date(to * 1000).getFullYear();
  return `${fmtDate(from, !sameYear)} – ${fmtDate(to)}`;
}

/**
 * A breakdown table: a row per part, with a bar and (unless share is false)
 * its share of the total, then the total row. Rows are { name, sub, value,
 * amount, color, share }: name and sub are escaped here; amount and a row's
 * own share text (in place of value ÷ total) must already be safe.
 */
function breakdown(rows, { head, total, totalLabel, totalAmount, share = true }) {
  const max = Math.max(0, ...rows.map(r => Math.abs(r.value))) || 1;
  const body = rows.map(r => `<tr>
      <th scope="row">
        <span class="drill-name">${r.color ? `<i style="background:${r.color}"></i>` : ''}${escHtml(r.name)}</span>
        ${r.sub ? `<span class="drill-sub">${escHtml(r.sub)}</span>` : ''}
        <span class="drill-bar" aria-hidden="true"><span style="width:${(Math.abs(r.value) / max * 100).toFixed(1)}%;background:${r.color || 'var(--orange)'}"></span></span>
      </th>
      ${share ? `<td class="drill-pct">${r.share ?? (total > 0 ? pct(r.value / total) : '')}</td>` : ''}
      <td class="drill-amt">${r.amount}</td>
    </tr>`).join('');
  return `<table class="drill-table">
    <thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">${totalLabel}</th>${share ? '<td></td>' : ''}<td class="drill-amt">${totalAmount}</td></tr></tfoot>
  </table>`;
}

// Order statuses as a seller reads them, coloured like their badges in Order History
const STATUS_NAMES = {
  'paid':               { name: 'Paid',                  color: 'var(--green)', sub: 'not marked complete yet' },
  'payment processing': { name: 'Payment processing',    color: 'var(--gold)' },
  'open':               { name: 'Open, not paid yet',    color: 'var(--gold)' },
  'completed':          { name: 'Completed',             color: 'var(--purple)', sub: 'marked shipped' },
  'shipped':            { name: 'Shipped',               color: 'var(--purple)' },
  'partially refunded': { name: 'Partially refunded',    color: '#d4622a' },
  'fully refunded':     { name: 'Fully refunded',        color: '#b91c1c' },
  'canceled':           { name: 'Canceled',              color: '#a89e90' },
};
const statusName = s => STATUS_NAMES[s] || { name: s.charAt(0).toUpperCase() + s.slice(1), color: '#6b7280' };

/**
 * A list: a name with a detail line, a middle column and a right-hand value,
 * then the total row. Rows are { name, href, sub, mid, end }: name and href
 * are escaped here (href opens in a new tab); sub, mid and end must already
 * be safe.
 */
function itemList(rows, { head, totalLabel, totalAmount }) {
  const body = rows.map(r => {
    const name = escHtml(r.name);
    return `<tr>
      <th scope="row">
        <span class="drill-name">${r.href ? `<a href="${escHtml(r.href)}" target="_blank" rel="noopener">${name}</a>` : name}</span>
        ${r.sub ? `<span class="drill-sub">${r.sub}</span>` : ''}
      </th>
      <td class="drill-pct">${r.mid}</td>
      <td class="drill-amt">${r.end}</td>
    </tr>`;
  }).join('');
  return `<table class="drill-table drill-list">
    <thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">${totalLabel}</th><td></td><td class="drill-amt">${totalAmount}</td></tr></tfoot>
  </table>`;
}

const buyerName = o => o.name || (o.buyer_user_id ? `Buyer #${o.buyer_user_id}` : 'Buyer');
/** itemList of orders: rows are { order, sub, mid, end }, named by buyer, with the receipt number first in the detail line. */
const orderList = (rows, opts) => itemList(rows.map(r => ({
  ...r, name: buyerName(r.order), sub: `#${escHtml(r.order.receipt_id)}${r.sub ? ` · ${r.sub}` : ''}`,
})), opts);

const listingUrl = id => `https://www.etsy.com/listing/${encodeURIComponent(String(id))}`;

const badge = (cls, text) => `<span class="ledger-type-badge ${cls}">${text}</span>`;
const waited = days => days < 1 ? 'today' : plural(Math.floor(days), 'day');

/** Physical orders not marked shipped yet (only the past-due ones when overdueOnly), oldest first. */
function shipList(overdueOnly) {
  const list = unshippedOrders(ordersWithItems(), Math.floor(Date.now() / 1000)).filter(u => !overdueOnly || u.overdue);
  const figure = fmtNum(list.length);
  if (!list.length) return { figure, html: empty(overdueOnly ? "No order is past Etsy's expected ship date." : 'Every physical order in this period has been marked shipped.') };
  const rows = list.map(u => {
    const items = u.order.transactions.reduce((s, t) => s + (t.quantity || 1), 0);
    return {
      order: u.order,
      sub: [items ? plural(items, 'item') : '', u.order.grandtotal ? fmtMoney(money(u.order.grandtotal)) : '', u.expected ? `ship by ${shortDate(u.expected)}` : '']
        .filter(Boolean).join(' · '),
      mid: shortDate(u.paid),
      end: `${waited(u.ageDays)}${u.overdue ? badge('lt-fee', 'past due') : ''}`,
    };
  });
  return {
    figure, cls: overdueOnly ? 'red' : '',
    html: orderList(rows, { head: ['Order', 'Paid', 'Waiting'], totalLabel: overdueOnly ? 'Past due' : 'Not shipped', totalAmount: plural(list.length, 'order') }) +
      note("Physical orders from this period that aren't marked shipped, oldest first. \"Ship by\" is Etsy's expected ship date. Digital, canceled and fully refunded orders don't need shipping."),
  };
}

/**
 * Canceled and refunded orders, newest first: `kind` keeps one status
 * ('canceled', 'fully refunded', 'partially refunded'); without it, every
 * affected order with the amount refunded, summing to the Refunded card.
 */
function refundList(kind) {
  const all = refundedOrders(state.allOrders), list = kind ? all.filter(r => r.kind === kind) : all;
  const totalCents = list.reduce((s, r) => s + r.refundedCents, 0);
  const figure = kind ? fmtNum(list.length) : fmtC(totalCents);
  if (!list.length) return { figure, html: empty(`No ${kind || 'canceled or refunded'} orders in this period.`) };
  const rows = list.map(r => ({
    order: r.order,
    sub: [shortDate(r.order.create_timestamp), r.order.grandtotal ? `${fmtMoney(money(r.order.grandtotal))} paid` : '', ...r.reasons.map(escHtml)].filter(Boolean).join(' · '),
    mid: escHtml(statusName(r.kind || String(r.order.status || '').toLowerCase()).name),
    end: r.refundedCents ? fmtC(r.refundedCents) : '—',
  }));
  return {
    figure, cls: kind ? '' : 'red',
    html: orderList(rows, { head: ['Order', 'Status', 'Refunded'], totalLabel: kind ? statusName(kind).name : 'Refunded', totalAmount: kind ? plural(list.length, 'order') : figure }) +
      note(kind
        ? 'Orders from this period with this status, newest first. They count in Total Orders; their refunds come off Total Gross.'
        : "Refunds recorded on this period's orders, newest first, whatever status the order has now. A partial refund can leave an order Completed."),
  };
}

/**
 * Orders with a discount, newest first, with what the items cost before it
 * and how much it took off. byCount: the figure is the number of orders
 * (Discounted Orders), else the discounts' total (Discounts Given).
 */
function discountList(byCount) {
  const list = discountedOrders(state.allOrders);
  const totalCents = list.reduce((s, d) => s + d.discountCents, 0);
  const figure = byCount ? fmtNum(list.length) : fmtC(totalCents);
  if (!list.length) return { figure, html: empty('No discounted orders in this period.') };
  const rows = list.map(d => ({
    order: d.order,
    sub: [shortDate(d.order.create_timestamp), d.itemsCents ? `items ${fmtC(d.itemsCents)}` : ''].filter(Boolean).join(' · '),
    mid: d.itemsCents ? `${Math.round(d.discountCents / d.itemsCents * 100)}% off` : '—',
    end: `−${fmtC(d.discountCents)}`,
  }));
  return {
    figure, cls: byCount ? '' : 'red',
    html: orderList(rows, { head: ['Order', 'Off items', 'Discount'], totalLabel: plural(list.length, 'discounted order'), totalAmount: `−${fmtC(totalCents)}` }) +
      note("Coupon discounts taken off these orders' items, newest first. Etsy's API doesn't say which coupon an order used."),
  };
}

const BUYER_NOTE = 'Buyers are Etsy accounts that ordered in this period; spend is what they paid, including shipping and tax.';
const buyerLabel = b => b.name || `Buyer #${b.id}`;
const noIdNote = c => c.noId ? ` ${plural(c.noId, 'order')} without a buyer ID ${c.noId === 1 ? 'is' : 'are'} left out.` : '';

/**
 * Buyers by how many orders each placed this period (Customers tab). The
 * groups add up to Unique Buyers; for Orders per Buyer the total row is the
 * orders divided by the buyers.
 */
function buyerSpread(perBuyer) {
  const c = customerStats(state.allOrders);
  const orders = c.byOrders.reduce((s, g) => s + g.orders * g.buyers, 0);
  const figure = perBuyer ? (c.ordersPerBuyer == null ? '—' : c.ordersPerBuyer.toFixed(2)) : fmtNum(c.buyers);
  if (!c.buyers) return { figure, html: empty('None of these orders has a buyer ID.') };
  const rows = c.byOrders.map((g, i) => ({
    name: plural(g.orders, 'order'), value: g.buyers, amount: plural(g.buyers, 'buyer'),
    sub: `${fmtMoney(g.revenue)} spent`, color: i ? 'var(--orange)' : '#a89e90',
  }));
  return {
    figure,
    html: breakdown(rows, perBuyer
      ? { head: ['Orders each', 'Share', 'Buyers'], total: c.buyers, totalLabel: `${plural(orders, 'order')} ÷ ${plural(c.buyers, 'buyer')}`, totalAmount: figure }
      : { head: ['Orders each', 'Share', 'Buyers'], total: c.buyers, totalLabel: 'Unique buyers', totalAmount: figure }) +
      note(BUYER_NOTE + noIdNote(c)),
  };
}

/** Buyers with 2+ orders this period, by spend (Customers tab). */
function repeatBuyerList() {
  const c = customerStats(state.allOrders);
  const figure = fmtNum(c.repeatBuyers);
  if (!c.repeat.length) return { figure, html: empty('No buyer ordered more than once in this period.') };
  return {
    figure,
    html: itemList(c.repeat.map(b => ({ name: buyerLabel(b), sub: `Buyer #${escHtml(b.id)}`, mid: fmtNum(b.orders), end: fmtMoney(b.revenue) })),
      { head: ['Buyer', 'Orders', 'Spent'], totalLabel: plural(c.repeat.length, 'repeat buyer'), totalAmount: fmtMoney(c.repeatRevenue) }) +
      note(`Buyers with 2 or more orders in this period, by spend. ${BUYER_NOTE}`),
  };
}

/** Spend from repeat buyers vs one-time buyers; the repeat share is the card's figure (Customers tab). */
function repeatRevenueSplit() {
  const c = customerStats(state.allOrders);
  const figure = c.repeatRevenueShare == null ? '—' : `${(c.repeatRevenueShare * 100).toFixed(1)}%`;
  if (!(c.revenue > 0)) return { figure, html: empty('None of these orders has a buyer ID.') };
  const once = c.buyers - c.repeatBuyers;
  const rows = [
    { name: 'Repeat buyers', sub: `${plural(c.repeatBuyers, 'buyer')} · ${plural(c.repeat.reduce((s, b) => s + b.orders, 0), 'order')}`, value: c.repeatRevenue, color: 'var(--orange)' },
    { name: 'One-time buyers', sub: `${plural(once, 'buyer')} · ${plural(once, 'order')}`, value: c.revenue - c.repeatRevenue, color: '#a89e90' },
  ];
  return {
    figure,
    html: breakdown(rows.map(r => ({ ...r, amount: fmtMoney(r.value) })), { head: ['Buyers', 'Share', 'Spent'], total: c.revenue, totalLabel: 'All buyers', totalAmount: fmtMoney(c.revenue) }) +
      note(BUYER_NOTE + noIdNote(c)),
  };
}

/** Every review rated 3 stars or less in the period, newest first, split by stars above (Customers tab). */
function lowReviewList() {
  if (!state.reviews) return { wait: 'Reviews are still loading.' };
  const orders = ordersWithItems();
  const r = reviewStats(state.reviews, orders, { ...reviewPeriod(), recentLow: Infinity });
  const figure = fmtNum(r.low.length);
  if (!r.low.length) return { figure, html: empty('No reviews of 3 stars or fewer in this period.') };
  const title = listingTitles(orders);
  const items = r.low.map(v => `<div class="ins-review">
      <div class="ins-review-head">${stars(Math.round(v.rating))}<span class="what">${escHtml(title(v.listing_id))} · ${shortDate(v.created_timestamp)}</span></div>
      <p>${v.review ? escHtml(v.review) : '<span class="ins-empty">(no written review)</span>'}</p>
    </div>`).join('');
  return {
    figure, cls: 'red',
    html: tiles(...r.stars.slice(2).map(s => [plural(s.stars, 'star'), fmtNum(s.count)])) +
      `<div class="drill-reviews">${items}</div>` + total('Rated 3 or less', plural(r.low.length, 'review')) +
      note('Every review of 3 stars or fewer left in this period, newest first. Star Ratings on this tab shows how they compare with the rest.'),
  };
}

/** Active listings with 2 or fewer left, best selling this period first, then fewest left (Products tab). */
function lowStockList() {
  if (!state.listings) return { wait: 'Listings are still loading.' };
  const rows = listingStats(state.listings, ordersWithItems()).rows.filter(r => r.lowStock)
    .sort((a, b) => b.units - a.units || a.quantity - b.quantity); // selling and nearly out first
  const figure = fmtNum(rows.length);
  if (!rows.length) return { figure, html: empty('No active listing is down to 2 or fewer.') };
  return {
    figure, cls: 'red',
    html: itemList(rows.map(r => ({
      name: r.title, href: listingUrl(r.id),
      sub: [r.price == null ? '' : fmtMoney(r.price), r.units ? `${fmtMoney(r.revenue)} this period` : 'no sales this period'].join(' · '),
      mid: fmtNum(r.units),
      end: r.quantity === 0 ? badge('lt-fee', 'none left') : `${fmtNum(r.quantity)} left`,
    })), { head: ['Listing', 'Sold', 'In stock'], totalLabel: 'Low stock', totalAmount: plural(rows.length, 'listing') }) +
      note("Active listings with 2 or fewer left, best sellers first. Sold counts this period's units; stock is Etsy's count now."),
  };
}

/** Active listings that sold nothing in the period, most viewed first (Products tab). */
function noSalesList() {
  if (!state.listings) return { wait: 'Listings are still loading.' };
  const rows = listingStats(state.listings, ordersWithItems()).rows.filter(r => r.noSales)
    .sort((a, b) => (b.views || 0) - (a.views || 0) || b.favorites - a.favorites);
  const figure = fmtNum(rows.length);
  if (!rows.length) return { figure, html: empty('Every active listing sold at least once in this period.') };
  return {
    figure,
    html: itemList(rows.map(r => ({
      name: r.title, href: listingUrl(r.id),
      sub: [r.price == null ? '' : fmtMoney(r.price), r.quantity == null ? '' : `${fmtNum(r.quantity)} in stock`].filter(Boolean).join(' · '),
      mid: r.views == null ? '—' : fmtNum(r.views),
      end: fmtNum(r.favorites),
    })), { head: ['Listing', 'Views', 'Favorites'], totalLabel: 'Active, no sales', totalAmount: plural(rows.length, 'listing') }) +
      note("Active listings that sold nothing in this period, most viewed first. Views and favorites are Etsy's lifetime totals for each listing."),
  };
}

/**
 * Each drill-down: its title, and build() returning { figure, cls, html } for
 * the current data, or { wait } while that data is still loading.
 */
const DRILLS = {
  buyers:             { title: 'Unique Buyers',        build: () => buyerSpread(false) },
  'orders-per-buyer': { title: 'Orders per Buyer',     build: () => buyerSpread(true) },
  'repeat-buyers':    { title: 'Repeat Buyers',        build: repeatBuyerList },
  'repeat-revenue':   { title: 'Repeat Buyer Revenue', build: repeatRevenueSplit },
  'low-reviews':      { title: 'Rated 3 or Less',      build: lowReviewList },
  'no-sales':  { title: 'No Sales This Period', build: noSalesList },
  'low-stock': { title: 'Low Stock',            build: lowStockList },
  discounted: { title: 'Discounted Orders', build: () => discountList(true) },
  discounts:  { title: 'Discounts Given',   build: () => discountList(false) },
  canceled:             { title: 'Canceled Orders',           build: () => refundList('canceled') },
  'fully-refunded':     { title: 'Fully Refunded Orders',     build: () => refundList('fully refunded') },
  'partially-refunded': { title: 'Partially Refunded Orders', build: () => refundList('partially refunded') },
  refunds:              { title: 'Refunded',                  build: () => refundList(null) },
  unshipped: { title: 'Not Shipped Yet', build: () => shipList(false) },
  overdue:   { title: 'Past Due',        build: () => shipList(true) },
  aov: {
    title: 'Avg. Order Value',
    build() {
      const orders = state.allOrders;
      // The card's own sum, so the figure matches it to the cent
      const figure = fmtMoney(orders.length ? orders.reduce((s, o) => s + orderSales(o), 0) / orders.length : 0);
      const a = aovBreakdown(orders);
      if (!a) return { figure, html: empty('No orders in this period.') };
      const rows = [
        { name: 'Items', value: a.parts.items, color: 'var(--orange)',
          sub: a.discountCents ? `after ${fmtC(a.discountCents)} of discounts per order` : 'what the items sold for' },
        { name: 'Shipping', value: a.parts.shipping, color: '#2563eb', sub: 'charged to buyers' },
        { name: 'Gift wrap', value: a.parts.giftWrap, color: '#db2777' },
        { name: 'Other', value: a.parts.other, color: '#6b7280', sub: "orders whose price isn't broken down" },
      ].filter((r, i) => i < 2 || r.value);
      return {
        figure,
        html: tiles(['Median order', fmtC(a.medianCents)], ['Smallest', fmtC(a.minCents)], ['Largest', fmtC(a.maxCents)]) +
          breakdown(rows.map(r => ({ ...r, amount: fmtC(r.value) })),
            { head: ['Per order', 'Share', 'Amount'], total: a.avgCents, totalLabel: 'Avg. Order Value', totalAmount: figure }) +
          note(`Averaged over ${plural(a.orders, 'order')}, canceled and refunded ones included, before refunds and without sales tax. The Orders tab's Order Values chart shows how they spread.`),
      };
    },
  },
  orders: {
    title: 'Total Orders',
    build() {
      const orders = state.allOrders, figure = fmtNum(orders.length);
      if (!orders.length) return { figure, html: empty('No orders in this period.') };
      const rows = orderStatusCounts(orders).map(r => {
        const s = statusName(r.status);
        return { name: s.name, color: s.color, value: r.count, amount: fmtNum(r.count),
          sub: `${s.sub ? `${s.sub} · ` : ''}${fmtMoney(r.sales)} in sales` };
      });
      return {
        figure,
        html: breakdown(rows, { head: ['Status', 'Share', 'Orders'], total: orders.length, totalLabel: 'Total Orders', totalAmount: figure }) +
          note('Sales are before refunds and without sales tax, as in Avg. Order Value. Open the Orders tab for each order.'),
      };
    },
  },
  gross: {
    title: 'Total Gross',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const g = grossBreakdown(state.ledgerEntries);
      const figure = fmtC(g.grossCents);
      if (!g.sales && !g.refunds) return { figure, html: empty('No sales or refunds in the ledger for this period.') };
      const rows = [
        { name: 'Payments for sales', sub: `${plural(g.sales, 'sale')}, including the sales tax buyers paid`, value: g.paidCents, color: 'var(--green)' },
        { name: 'Sales tax passed on', sub: 'Etsy pays it to the tax authorities', value: g.taxCents, color: '#a89e90' },
        { name: 'Retail delivery fees passed on', sub: "state fees the buyer paid, such as Colorado's", value: g.deliveryCents, color: '#6b7280' },
        { name: 'Refunds to buyers', sub: plural(g.refunds, 'refund'), value: g.refundCents, color: 'var(--gold)' },
        { name: 'Sales tax returned on refunds', sub: 'the refunds included tax Etsy had already passed on', value: g.taxBackCents, color: '#a89e90' },
      ].filter((r, i) => i === 0 || r.value);
      return {
        figure,
        html: breakdown(rows.map(r => ({ ...r, amount: signed(r.value) })),
          { head: ['Part', 'Amount'], share: false, totalLabel: 'Total Gross', totalAmount: figure }) +
          note('Gross is what you sold after refunds, without the sales tax Etsy collects and pays on your behalf. Fees come off it next, to give Net Earnings.'),
      };
    },
  },
  net: {
    title: 'Net Earnings',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const entries = state.ledgerEntries;
      const { netCents } = computeLedgerTotals(entries);
      const gross = grossBreakdown(entries).grossCents;
      const fees  = feeBreakdown(entries).rows.filter(r => r.cents);
      const figure = fmtC(netCents);
      if (!gross && !fees.length) return { figure, cls: 'green', html: empty('No sales or fees in the ledger for this period.') };
      const ofGross = c => gross > 0 ? pct(c / gross) : '—';
      const rows = [
        { name: 'Total Gross', sub: 'sales after refunds, excl. tax', value: gross, amount: signed(gross), color: 'var(--ink2)', share: '' }, // not green: Transaction Fees are
        ...fees.map(f => ({ name: f.label, value: -f.cents, amount: signed(-f.cents), color: f.color, share: ofGross(f.cents) })),
      ];
      return {
        figure, cls: 'green',
        html: breakdown(rows, { head: ['Part', 'Of gross', 'Amount'], totalLabel: 'Net Earnings', totalAmount: figure }) +
          note(`${gross > 0 ? `You kept ${pct(netCents / gross)} of gross after Etsy's fees. ` : ''}Payouts to your bank aren't counted: they move money you've already earned.`),
      };
    },
  },
  fees: {
    title: 'Total Fees',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const f = feeBreakdown(state.ledgerEntries);
      const rows = f.rows.filter(r => r.chargedCents || r.creditedCents);
      const figure = fmtC(f.totalCents);
      if (!rows.length) return { figure, cls: 'red', html: empty('No fees in this period.') };
      return {
        figure, cls: 'red',
        html: breakdown(rows.map(r => ({
          name: r.label, color: r.color, value: r.cents,
          amount: (r.cents < 0 ? '−' : '') + fmtC(Math.abs(r.cents)),
          sub: r.creditedCents ? `${fmtC(r.chargedCents)} charged · ${fmtC(r.creditedCents)} credited back` : '',
        })), { head: ['Fee', 'Share', 'Amount'], total: f.totalCents, totalLabel: 'Total Fees', totalAmount: figure }) +
          note(f.creditedCents
            ? `Etsy charged ${fmtC(f.chargedCents)} and gave ${fmtC(f.creditedCents)} back, mostly fees on refunded orders and adjusted labels. Each credit comes off the fee it reverses.`
            : 'Every fee Etsy charged in the ledger for this period.'),
      };
    },
  },
};

let openKey = null, opener = null;

function fill() {
  const d = DRILLS[openKey], r = d.build();
  $('drill-title').textContent = d.title;
  $('drill-period').textContent = periodText();
  const fig = $('drill-figure');
  fig.textContent = r.wait ? '—' : r.figure;
  fig.className = `drill-figure ${r.wait ? '' : r.cls || ''}`;
  $('drill-body').innerHTML = r.wait ? empty(r.wait) : r.html;
}

let wired = false;
/** Listen for closing, once. Not at import: pages without the popup (the tests) import this module too. */
function wire(dialog) {
  if (wired) return;
  wired = true;
  // Esc closes a modal dialog by itself. The content (.drill-box) fills the dialog,
  // so a click that lands on the dialog element itself is on the backdrop.
  dialog.addEventListener('click', ev => { if (ev.target === dialog) closeDrill(); });
  dialog.addEventListener('close', () => {
    // Back where the viewer was; a tile redrawn while the popup was open is a new element with the same key
    const back = opener?.isConnected ? opener : document.querySelector(`.tab-panel.active [data-drill="${openKey}"]`);
    if (back?.offsetParent) back.focus();
    openKey = null;
    opener = null;
  });
}

/** Open the breakdown behind a card (data-drill names it). */
export function openDrill(card) {
  const dialog = $('drill');
  if (!DRILLS[card.dataset.drill]) return;
  wire(dialog);
  openKey = card.dataset.drill;
  opener = card;
  fill();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.drill-box').scrollTop = 0;
  // Start on the close button: a long list makes the box a scroller, which some browsers would focus first
  dialog.querySelector('.drill-close').focus({ preventScroll: true });
}

export function closeDrill() {
  if ($('drill')?.open) $('drill').close();
}

/** Redraw the open breakdown after new data arrives (the loader's redraws call this). */
export function refreshDrill() {
  if ($('drill')?.open && openKey) fill();
}
