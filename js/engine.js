// Posting engine for the order-to-cash process.
// Every operation is a "transaction": it works on a copy of the data and only
// returns the new state if every check passes (like posting in an ERP).
// Money is stored in cents (integers) to avoid rounding errors.

export const TAX_RATE = 0.13; // Ontario HST
export const PAYMENT_TERMS = { COD: 0, NET15: 15, NET30: 30, NET45: 45 };
export const ORDER_FLOW = ['Open', 'Released', 'Shipped', 'Invoiced'];
export const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'];

const DAY = 24 * 60 * 60 * 1000;

export class PostingError extends Error {}

const fail = msg => { throw new PostingError(msg); };
const clone = s => structuredClone(s);
const byId = (list, id) => list.find(x => x.id === id);

export function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

export function formatMoney(cents) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
}

export function addDays(isoDate, days) {
  return new Date(new Date(isoDate + 'T00:00:00Z').getTime() + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / DAY);
}

function nextNumber(state, series) {
  state.counters[series] = (state.counters[series] || 1000) + 1;
  return `${series}-${state.counters[series]}`;
}

// ---------- Master data (REQ-01, REQ-02) ----------

export function validateItem(item, items = []) {
  const errors = [];
  if (!/^[A-Z0-9-]{3,20}$/.test(String(item.sku || ''))) errors.push('SKU must be 3–20 capital letters, numbers or dashes.');
  if (!String(item.name || '').trim()) errors.push('Item name is required.');
  if (!(Number.isInteger(item.priceCents) && item.priceCents > 0)) errors.push('Unit price must be greater than zero.');
  if (!(Number.isInteger(item.costCents) && item.costCents >= 0)) errors.push('Unit cost cannot be negative.');
  if (item.priceCents > 0 && item.costCents > item.priceCents) errors.push('Unit cost is higher than the price (item would sell at a loss).');
  if (!(Number.isInteger(item.reorderPoint) && item.reorderPoint >= 0)) errors.push('Reorder point must be 0 or more.');
  if (items.some(i => i.sku === item.sku && i.id !== item.id)) errors.push(`SKU ${item.sku} already exists.`);
  return errors;
}

export function validateCustomer(c) {
  const errors = [];
  if (!String(c.name || '').trim()) errors.push('Customer name is required.');
  if (!(c.terms in PAYMENT_TERMS)) errors.push('Payment terms must be COD, NET15, NET30 or NET45.');
  if (!(Number.isInteger(c.creditLimitCents) && c.creditLimitCents >= 0)) errors.push('Credit limit cannot be negative.');
  return errors;
}

// ---------- Calculations (REQ-03) ----------

export function lineAmount(line) {
  const gross = line.qty * line.unitPriceCents;
  return Math.round(gross * (1 - (line.discountPct || 0) / 100));
}

export function orderTotals(lines) {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const tax = Math.round(subtotal * TAX_RATE);
  return { subtotal, tax, total: subtotal + tax };
}

export function available(item) {
  return item.onHand - item.reserved;
}

// Credit exposure = unpaid invoices + released or shipped orders not yet invoiced (REQ-05)
export function creditExposure(state, customerId) {
  const unpaid = state.invoices
    .filter(i => i.customerId === customerId)
    .reduce((s, i) => s + (i.totalCents - i.paidCents), 0);
  const uninvoiced = state.orders
    .filter(o => o.customerId === customerId && (o.status === 'Released' || o.status === 'Shipped'))
    .reduce((s, o) => s + orderTotals(o.lines).total, 0);
  return unpaid + uninvoiced;
}

// ---------- Sales order lifecycle (REQ-03 to REQ-07) ----------

export function createOrder(state, { customerId, orderDate, lines }) {
  const s = clone(state);
  const customer = byId(s.customers, customerId) || fail('Choose a customer.');
  if (customer.blocked) fail(`${customer.name} is blocked. New orders are not allowed.`);
  const clean = (lines || []).filter(l => l.itemId);
  if (!clean.length) fail('Add at least one order line.');
  const built = clean.map(l => {
    const item = byId(s.items, l.itemId) || fail('Item not found.');
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty <= 0) fail(`Quantity for ${item.sku} must be a whole number above 0.`);
    const discountPct = Number(l.discountPct || 0);
    if (discountPct < 0 || discountPct > 25) fail('Line discount must be between 0% and 25%.');
    return { itemId: item.id, sku: item.sku, description: item.name, qty, unitPriceCents: item.priceCents, discountPct };
  });
  const order = { id: nextNumber(s, 'SO'), customerId, orderDate, status: 'Open', lines: built };
  s.orders.push(order);
  return { state: s, result: order };
}

// Release = commit to the order: checks credit and reserves stock.
export function releaseOrder(state, orderId) {
  const s = clone(state);
  const order = byId(s.orders, orderId) || fail('Order not found.');
  if (order.status !== 'Open') fail(`Only Open orders can be released (this one is ${order.status}).`);
  const customer = byId(s.customers, order.customerId);
  const total = orderTotals(order.lines).total;
  const exposure = creditExposure(s, customer.id);
  if (exposure + total > customer.creditLimitCents) {
    fail(`Credit limit exceeded: ${formatMoney(exposure)} owing + ${formatMoney(total)} this order > limit ${formatMoney(customer.creditLimitCents)}.`);
  }
  // Check every line first, so nothing is reserved if any line is short.
  const need = {};
  for (const l of order.lines) need[l.itemId] = (need[l.itemId] || 0) + l.qty;
  for (const [itemId, qty] of Object.entries(need)) {
    const item = byId(s.items, itemId);
    if (available(item) < qty) fail(`Not enough stock for ${item.sku}: ${available(item)} available, ${qty} needed.`);
  }
  for (const [itemId, qty] of Object.entries(need)) byId(s.items, itemId).reserved += qty;
  order.status = 'Released';
  return { state: s, result: order };
}

export function shipOrder(state, orderId, shipDate) {
  const s = clone(state);
  const order = byId(s.orders, orderId) || fail('Order not found.');
  if (order.status !== 'Released') fail('Only Released orders can be shipped.');
  for (const l of order.lines) {
    const item = byId(s.items, l.itemId);
    item.onHand -= l.qty;
    item.reserved -= l.qty;
    s.itemLedger.push({ date: shipDate, itemId: item.id, sku: item.sku, type: 'Sale', qty: -l.qty, document: order.id });
  }
  order.status = 'Shipped';
  order.shipDate = shipDate;
  return { state: s, result: order };
}

export function invoiceOrder(state, orderId, invoiceDate) {
  const s = clone(state);
  const order = byId(s.orders, orderId) || fail('Order not found.');
  if (order.status !== 'Shipped') fail('Only Shipped orders can be invoiced.');
  const customer = byId(s.customers, order.customerId);
  const totals = orderTotals(order.lines);
  const invoice = {
    id: nextNumber(s, 'INV'), orderId: order.id, customerId: customer.id,
    date: invoiceDate, dueDate: addDays(invoiceDate, PAYMENT_TERMS[customer.terms]),
    subtotalCents: totals.subtotal, taxCents: totals.tax, totalCents: totals.total, paidCents: 0,
  };
  s.invoices.push(invoice);
  order.status = 'Invoiced';
  order.invoiceId = invoice.id;
  return { state: s, result: invoice };
}

// REQ-08: payments, including partial payments
export function applyPayment(state, invoiceId, amountCents, date) {
  const s = clone(state);
  const inv = byId(s.invoices, invoiceId) || fail('Invoice not found.');
  const remaining = inv.totalCents - inv.paidCents;
  if (!(Number.isInteger(amountCents) && amountCents > 0)) fail('Payment amount must be greater than zero.');
  if (remaining === 0) fail('This invoice is already paid.');
  if (amountCents > remaining) fail(`Payment is more than the ${formatMoney(remaining)} still owing.`);
  inv.paidCents += amountCents;
  const payment = { id: nextNumber(s, 'PMT'), invoiceId, customerId: inv.customerId, date, amountCents };
  s.payments.push(payment);
  return { state: s, result: payment };
}

// REQ-02: receiving stock from a purchase
export function receiveStock(state, itemId, qty, date) {
  const s = clone(state);
  const item = byId(s.items, itemId) || fail('Item not found.');
  if (!Number.isInteger(qty) || qty <= 0) fail('Quantity received must be a whole number above 0.');
  item.onHand += qty;
  s.itemLedger.push({ date, itemId, sku: item.sku, type: 'Purchase', qty, document: nextNumber(s, 'RCPT') });
  return { state: s, result: item };
}

// ---------- Reports (REQ-09, REQ-10) ----------

export function invoiceStatus(inv, asOf) {
  if (inv.paidCents >= inv.totalCents) return 'Paid';
  if (daysBetween(inv.dueDate, asOf) > 0) return 'Overdue';
  return inv.paidCents > 0 ? 'Partly paid' : 'Open';
}

export function agingBucket(dueDate, asOf) {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return 'Current';
  if (late <= 30) return '1-30';
  if (late <= 60) return '31-60';
  if (late <= 90) return '61-90';
  return '90+';
}

export function agingReport(state, asOf) {
  const rows = state.customers.map(c => {
    const row = { customerId: c.id, name: c.name, total: 0 };
    for (const b of AGING_BUCKETS) row[b] = 0;
    for (const inv of state.invoices.filter(i => i.customerId === c.id)) {
      const open = inv.totalCents - inv.paidCents;
      if (!open) continue;
      row[agingBucket(inv.dueDate, asOf)] += open;
      row.total += open;
    }
    return row;
  }).filter(r => r.total > 0);
  const totals = { name: 'Total', total: rows.reduce((s, r) => s + r.total, 0) };
  for (const b of AGING_BUCKETS) totals[b] = rows.reduce((s, r) => s + r[b], 0);
  return { rows, totals };
}

export function reorderSuggestions(items) {
  return items
    .filter(i => available(i) <= i.reorderPoint)
    // Order enough to get back above the reorder point, plus one standard reorder quantity.
    .map(i => ({ ...i, available: available(i), suggestQty: i.reorderPoint - available(i) + i.reorderQty }));
}

export function salesSummary(state, fromIso, toIso) {
  const inRange = state.invoices.filter(i => i.date >= fromIso && i.date <= toIso);
  const revenue = inRange.reduce((s, i) => s + i.subtotalCents, 0);
  let cost = 0;
  for (const inv of inRange) {
    const order = byId(state.orders, inv.orderId);
    for (const l of order.lines) cost += l.qty * byId(state.items, l.itemId).costCents;
  }
  return { invoices: inRange.length, revenue, cost, margin: revenue - cost, marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0 };
}
