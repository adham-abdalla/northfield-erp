// Automated test cases. IDs (TC-xx) match docs/03-testing.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e from '../js/engine.js';

const base = () => ({
  counters: {},
  items: [
    { id: 'i1', sku: 'PPR-1', name: 'Paper', priceCents: 1000, costCents: 600, onHand: 10, reserved: 0, reorderPoint: 3, reorderQty: 20 },
    { id: 'i2', sku: 'TNR-1', name: 'Toner', priceCents: 10000, costCents: 7000, onHand: 2, reserved: 0, reorderPoint: 2, reorderQty: 5 },
  ],
  customers: [
    { id: 'c1', name: 'Acme', terms: 'NET30', creditLimitCents: 50000, blocked: false },
    { id: 'c2', name: 'Blocked Co', terms: 'COD', creditLimitCents: 0, blocked: true },
  ],
  orders: [], invoices: [], payments: [], itemLedger: [],
});

// Helper: run a full order up to a target status
function orderTo(state, status, lines = [{ itemId: 'i1', qty: 2 }]) {
  let r = e.createOrder(state, { customerId: 'c1', orderDate: '2026-01-10', lines });
  const id = r.result.id;
  if (status === 'Open') return { state: r.state, id };
  r = e.releaseOrder(r.state, id);
  if (status === 'Released') return { state: r.state, id };
  r = e.shipOrder(r.state, id, '2026-01-11');
  if (status === 'Shipped') return { state: r.state, id };
  r = e.invoiceOrder(r.state, id, '2026-01-11');
  return { state: r.state, id, invoice: r.result };
}

test('TC-01 item master data is validated', () => {
  const ok = { sku: 'ABC-1', name: 'Thing', priceCents: 500, costCents: 200, reorderPoint: 0 };
  assert.deepEqual(e.validateItem(ok), []);
  assert.match(e.validateItem({ ...ok, sku: 'abc 1' }).join(), /SKU must be/);
  assert.match(e.validateItem({ ...ok, costCents: 900 }).join(), /sell at a loss/);
  assert.match(e.validateItem(ok, [{ id: 'x', sku: 'ABC-1' }]).join(), /already exists/);
});

test('TC-02 customer master data is validated', () => {
  assert.deepEqual(e.validateCustomer({ name: 'A', terms: 'NET30', creditLimitCents: 0 }), []);
  assert.equal(e.validateCustomer({ name: '', terms: 'NET99', creditLimitCents: -1 }).length, 3);
});

test('TC-03 line amounts, discount and 13% HST are calculated in cents', () => {
  const lines = [
    { qty: 3, unitPriceCents: 899 },                  // 26.97
    { qty: 1, unitPriceCents: 64900, discountPct: 10 }, // 584.10
  ];
  assert.deepEqual(e.orderTotals(lines), { subtotal: 61107, tax: 7944, total: 69051 });
});

test('TC-04 order needs at least one valid line', () => {
  assert.throws(() => e.createOrder(base(), { customerId: 'c1', lines: [] }), /at least one order line/);
  assert.throws(() => e.createOrder(base(), { customerId: 'c1', lines: [{ itemId: 'i1', qty: 1.5 }] }), /whole number/);
  assert.throws(() => e.createOrder(base(), { customerId: 'c1', lines: [{ itemId: 'i1', qty: 1, discountPct: 40 }] }), /between 0% and 25%/);
});

test('TC-05 blocked customers cannot place orders', () => {
  assert.throws(() => e.createOrder(base(), { customerId: 'c2', lines: [{ itemId: 'i1', qty: 1 }] }), /is blocked/);
});

test('TC-06 order numbers follow the number series', () => {
  let s = base();
  const a = e.createOrder(s, { customerId: 'c1', lines: [{ itemId: 'i1', qty: 1 }] });
  const b = e.createOrder(a.state, { customerId: 'c1', lines: [{ itemId: 'i1', qty: 1 }] });
  assert.equal(a.result.id, 'SO-1001');
  assert.equal(b.result.id, 'SO-1002');
});

test('TC-07 releasing reserves stock; available = on hand - reserved', () => {
  const { state } = orderTo(base(), 'Released', [{ itemId: 'i1', qty: 4 }]);
  const item = state.items.find(i => i.id === 'i1');
  assert.equal(item.onHand, 10);
  assert.equal(item.reserved, 4);
  assert.equal(e.available(item), 6);
});

test('TC-08 release is blocked when stock is short, and nothing is reserved', () => {
  const { state, id } = orderTo(base(), 'Open', [{ itemId: 'i1', qty: 1 }, { itemId: 'i2', qty: 3 }]);
  assert.throws(() => e.releaseOrder(state, id), /Not enough stock for TNR-1: 2 available, 3 needed/);
  assert.equal(state.items.find(i => i.id === 'i1').reserved, 0);
});

test('TC-09 release is blocked when the credit limit would be exceeded', () => {
  // Credit limit $500. First order: 40 x $10 = $400 + HST = $452 owing.
  // Second order: 5 x $10 = $50 + HST = $56.50 -> total $508.50 > $500.
  const s = base();
  s.items[0].onHand = 100;
  const first = orderTo(s, 'Invoiced', [{ itemId: 'i1', qty: 40 }]);          // $452 owing
  const second = e.createOrder(first.state, { customerId: 'c1', lines: [{ itemId: 'i1', qty: 5 }] }); // $56.50
  assert.throws(() => e.releaseOrder(second.state, second.result.id), /Credit limit exceeded/);
});

test('TC-10 a failed transaction leaves the original data unchanged', () => {
  const s = base();
  const before = JSON.stringify(s);
  assert.throws(() => e.createOrder(s, { customerId: 'c1', lines: [{ itemId: 'i1', qty: 0 }] }));
  assert.equal(JSON.stringify(s), before);
});

test('TC-11 status must follow Open → Released → Shipped → Invoiced', () => {
  const open = orderTo(base(), 'Open');
  assert.throws(() => e.shipOrder(open.state, open.id, '2026-01-11'), /Only Released/);
  assert.throws(() => e.invoiceOrder(open.state, open.id, '2026-01-11'), /Only Shipped/);
  const rel = orderTo(base(), 'Released');
  assert.throws(() => e.releaseOrder(rel.state, rel.id), /Only Open/);
});

test('TC-12 shipping reduces on-hand and reserved and writes an item ledger entry', () => {
  const { state, id } = orderTo(base(), 'Shipped', [{ itemId: 'i1', qty: 4 }]);
  const item = state.items.find(i => i.id === 'i1');
  assert.equal(item.onHand, 6);
  assert.equal(item.reserved, 0);
  assert.deepEqual(state.itemLedger.at(-1), { date: '2026-01-11', itemId: 'i1', sku: 'PPR-1', type: 'Sale', qty: -4, document: id });
});

test('TC-13 invoice due date comes from payment terms', () => {
  const { invoice } = orderTo(base(), 'Invoiced');
  assert.equal(invoice.id, 'INV-1001');
  assert.equal(invoice.dueDate, '2026-02-10'); // NET30 from 11 Jan
  assert.equal(invoice.totalCents, 2260);       // 2 x $10 + 13%
});

test('TC-14 partial payments, overpayment blocked, invoice closes at zero', () => {
  const { state, invoice } = orderTo(base(), 'Invoiced');
  const p1 = e.applyPayment(state, invoice.id, 1000, '2026-01-20');
  assert.equal(e.invoiceStatus(p1.state.invoices[0], '2026-01-20'), 'Partly paid');
  assert.throws(() => e.applyPayment(p1.state, invoice.id, 1261, '2026-01-21'), /more than the/);
  const p2 = e.applyPayment(p1.state, invoice.id, 1260, '2026-01-21');
  assert.equal(e.invoiceStatus(p2.state.invoices[0], '2026-01-21'), 'Paid');
  assert.throws(() => e.applyPayment(p2.state, invoice.id, 1, '2026-01-22'), /already paid/);
});

test('TC-15 aging buckets use days past the due date', () => {
  assert.equal(e.agingBucket('2026-03-01', '2026-03-01'), 'Current');
  assert.equal(e.agingBucket('2026-03-01', '2026-03-02'), '1-30');
  assert.equal(e.agingBucket('2026-03-01', '2026-03-31'), '1-30');
  assert.equal(e.agingBucket('2026-03-01', '2026-04-01'), '31-60');
  assert.equal(e.agingBucket('2026-03-01', '2026-05-30'), '61-90');
  assert.equal(e.agingBucket('2026-03-01', '2026-05-31'), '90+');
});

test('TC-16 aging report totals equal the sum of open invoices', () => {
  const { state, invoice } = orderTo(base(), 'Invoiced');
  const paid = e.applyPayment(state, invoice.id, 260, '2026-01-20').state;
  const report = e.agingReport(paid, '2026-03-15'); // 33 days past due
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]['31-60'], 2000);
  assert.equal(report.totals.total, 2000);
});

test('TC-17 reorder suggestions use available quantity', () => {
  const { state } = orderTo(base(), 'Released', [{ itemId: 'i1', qty: 8 }]); // paper available 2 <= 3
  const list = e.reorderSuggestions(state.items);
  const paper = list.find(i => i.sku === 'PPR-1');
  assert.equal(paper.available, 2);
  assert.equal(paper.suggestQty, 21); // 3 - 2 + 20
  assert.ok(list.some(i => i.sku === 'TNR-1')); // 2 available <= reorder point 2
});

test('TC-18 receiving stock increases on hand and is logged', () => {
  const r = e.receiveStock(base(), 'i2', 5, '2026-01-12');
  assert.equal(r.state.items[1].onHand, 7);
  assert.equal(r.state.itemLedger[0].type, 'Purchase');
  assert.throws(() => e.receiveStock(base(), 'i2', -1, '2026-01-12'), /whole number above 0/);
});

test('TC-19 sales summary calculates revenue, cost and margin', () => {
  const { state } = orderTo(base(), 'Invoiced', [{ itemId: 'i1', qty: 5 }]);
  const s = e.salesSummary(state, '2026-01-01', '2026-01-31');
  assert.deepEqual(s, { invoices: 1, revenue: 5000, cost: 3000, margin: 2000, marginPct: 40 });
});
