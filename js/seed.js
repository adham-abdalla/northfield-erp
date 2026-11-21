// Sample data for the fictional client "Northfield Office Supply".
// History is created by running real transactions through the engine,
// so the sample data always follows the same rules as the app.
import * as e from './engine.js';

export function buildSeed(today = new Date().toISOString().slice(0, 10)) {
  const ago = n => e.addDays(today, -n);

  let state = {
    counters: {},
    items: [
      { id: 'itm-1', sku: 'PPR-LTR-500', name: 'Copy paper, letter, 500 sheets', priceCents: 899, costCents: 520, onHand: 400, reserved: 0, reorderPoint: 150, reorderQty: 300 },
      { id: 'itm-2', sku: 'TNR-HP-58A', name: 'Toner cartridge HP 58A', priceCents: 14999, costCents: 9800, onHand: 18, reserved: 0, reorderPoint: 10, reorderQty: 20 },
      { id: 'itm-3', sku: 'CHR-ERG-01', name: 'Ergonomic office chair', priceCents: 28900, costCents: 17500, onHand: 12, reserved: 0, reorderPoint: 5, reorderQty: 10 },
      { id: 'itm-4', sku: 'DSK-STD-60', name: 'Standing desk 60 in.', priceCents: 64900, costCents: 41000, onHand: 6, reserved: 0, reorderPoint: 4, reorderQty: 6 },
      { id: 'itm-5', sku: 'PEN-BLU-12', name: 'Ballpoint pens, blue, box of 12', priceCents: 649, costCents: 210, onHand: 90, reserved: 0, reorderPoint: 60, reorderQty: 200 },
      { id: 'itm-6', sku: 'NTB-A5-3PK', name: 'Notebooks A5, 3-pack', priceCents: 1299, costCents: 540, onHand: 140, reserved: 0, reorderPoint: 50, reorderQty: 100 },
    ],
    customers: [
      { id: 'cus-1', name: 'Maple Leaf Accounting LLP', city: 'Toronto', terms: 'NET30', creditLimitCents: 1500000, blocked: false },
      { id: 'cus-2', name: 'Hamilton District School Board', city: 'Hamilton', terms: 'NET45', creditLimitCents: 5000000, blocked: false },
      { id: 'cus-3', name: 'Kitchener Dental Group', city: 'Kitchener', terms: 'NET15', creditLimitCents: 500000, blocked: false },
      { id: 'cus-4', name: 'Bayview Startup Hub', city: 'Toronto', terms: 'NET30', creditLimitCents: 300000, blocked: false },
      { id: 'cus-5', name: 'Old Mill Law Office', city: 'Toronto', terms: 'COD', creditLimitCents: 0, blocked: true },
    ],
    orders: [], invoices: [], payments: [], itemLedger: [],
  };

  const run = (fn, ...args) => { const r = fn(state, ...args); state = r.state; return r.result; };
  const fullCycle = (customerId, daysAgo, lines, payPct = 0, payDaysAfter = 10) => {
    const o = run(e.createOrder, { customerId, orderDate: ago(daysAgo), lines });
    run(e.releaseOrder, o.id);
    run(e.shipOrder, o.id, ago(daysAgo - 1));
    const inv = run(e.invoiceOrder, o.id, ago(daysAgo - 1));
    if (payPct) run(e.applyPayment, inv.id, Math.round(inv.totalCents * payPct), ago(daysAgo - 1 - payDaysAfter));
  };

  // Paid, part-paid and overdue invoices so the aging report has data in several buckets
  fullCycle('cus-2', 140, [{ itemId: 'itm-3', qty: 2 }, { itemId: 'itm-6', qty: 30 }]);       // 90+ overdue (NET45)
  fullCycle('cus-1', 95, [{ itemId: 'itm-1', qty: 50 }, { itemId: 'itm-5', qty: 20 }], 1);
  fullCycle('cus-1', 70, [{ itemId: 'itm-2', qty: 4 }]);                                         // 31-60 overdue
  fullCycle('cus-3', 40, [{ itemId: 'itm-2', qty: 2 }, { itemId: 'itm-1', qty: 10 }], 0.5, 5);   // part-paid, overdue
  fullCycle('cus-2', 20, [{ itemId: 'itm-4', qty: 2, discountPct: 10 }]);                        // current
  fullCycle('cus-4', 12, [{ itemId: 'itm-6', qty: 40 }, { itemId: 'itm-5', qty: 25 }]);          // current
  fullCycle('cus-1', 6, [{ itemId: 'itm-1', qty: 80 }], 1, 2);                                   // paid

  // Orders still in progress
  const shipped = run(e.createOrder, { customerId: 'cus-4', orderDate: ago(2), lines: [{ itemId: 'itm-3', qty: 3 }] });
  run(e.releaseOrder, shipped.id);
  run(e.shipOrder, shipped.id, ago(1));
  const released = run(e.createOrder, { customerId: 'cus-2', orderDate: ago(1), lines: [{ itemId: 'itm-1', qty: 120 }, { itemId: 'itm-2', qty: 4 }] });
  run(e.releaseOrder, released.id);
  run(e.createOrder, { customerId: 'cus-3', orderDate: today, lines: [{ itemId: 'itm-4', qty: 1 }, { itemId: 'itm-5', qty: 10 }] });

  return state;
}
