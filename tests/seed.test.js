// Integration test: the sample data is consistent (TC-20, TC-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e from '../js/engine.js';
import { buildSeed } from '../js/seed.js';

const TODAY = '2026-11-21';

test('TC-20 sample data is internally consistent', () => {
  const s = buildSeed(TODAY);
  for (const item of s.items) {
    assert.deepEqual(e.validateItem(item, s.items), [], item.sku);
    assert.ok(item.onHand >= 0 && item.reserved >= 0 && item.reserved <= item.onHand, item.sku);
    // Reserved stock equals the quantity on Released orders
    const reserved = s.orders.filter(o => o.status === 'Released')
      .flatMap(o => o.lines).filter(l => l.itemId === item.id).reduce((t, l) => t + l.qty, 0);
    assert.equal(item.reserved, reserved, item.sku);
  }
  for (const c of s.customers) assert.deepEqual(e.validateCustomer(c), [], c.name);
  // Every invoiced order has exactly one invoice with matching totals
  for (const o of s.orders.filter(o => o.status === 'Invoiced')) {
    const inv = s.invoices.filter(i => i.orderId === o.id);
    assert.equal(inv.length, 1);
    assert.equal(inv[0].totalCents, e.orderTotals(o.lines).total);
  }
  // Payments add up to what each invoice shows as paid
  for (const inv of s.invoices) {
    const paid = s.payments.filter(p => p.invoiceId === inv.id).reduce((t, p) => t + p.amountCents, 0);
    assert.equal(inv.paidCents, paid, inv.id);
  }
});

test('TC-21 sample data shows every status and aging bucket used in the demo', () => {
  const s = buildSeed(TODAY);
  const statuses = new Set(s.orders.map(o => o.status));
  for (const st of e.ORDER_FLOW) assert.ok(statuses.has(st), st);
  const totals = e.agingReport(s, TODAY).totals;
  for (const b of ['Current', '1-30', '31-60', '90+']) assert.ok(totals[b] > 0, b);
  assert.ok(e.reorderSuggestions(s.items).length > 0);
});
