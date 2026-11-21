// User interface for Northfield ERP.
import * as e from './engine.js';
import { createStore } from './store.js';

const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
let storage;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = undefined; }
const store = createStore(storage, today);

const main = document.getElementById('main');
const dlg = document.getElementById('dlg');
const dlgForm = document.getElementById('dlg-form');
let dlgSubmit = null;

// ---------- helpers ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const $ = cents => e.formatMoney(cents);
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const S = () => store.get();
const find = (list, id) => S()[list].find(x => x.id === id);
const customerName = id => find('customers', id)?.name ?? '—';

const STATUS_BADGE = { Open: '', Released: 'info', Shipped: 'warn', Invoiced: 'ok', Paid: 'ok', 'Partly paid': 'warn', Overdue: 'bad' };
const badge = s => `<span class="badge ${STATUS_BADGE[s] ?? ''}">${esc(s)}</span>`;
const NEXT_STEP = { Open: ['release', 'Release'], Released: ['ship', 'Ship'], Shipped: ['invoice', 'Invoice'] };

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = ''; }, 3500);
}

function head(title, subtitle, action) {
  return `<div class="page-head"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>
    ${action ? `<button class="btn btn-primary" data-action="${action[0]}">${action[1]}</button>` : ''}</div>`;
}

function table(cols, rows, foot = '') {
  const th = cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('');
  const body = rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" class="empty">Nothing to show.</td></tr>`;
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}

// ---------- dialog ----------
function openDialog(title, body, submitLabel, onSubmit) {
  document.getElementById('dlg-title').textContent = title;
  document.getElementById('dlg-body').innerHTML = body;
  document.getElementById('dlg-errors').innerHTML = '';
  document.getElementById('dlg-submit').textContent = submitLabel;
  dlgSubmit = onSubmit;
  dlg.showModal();
  dlg.querySelector('input, select')?.focus();
}

dlgForm.addEventListener('submit', ev => {
  ev.preventDefault();
  try {
    dlgSubmit(new FormData(dlgForm));
    dlg.close();
    render();
  } catch (err) {
    const list = Array.isArray(err.errors) ? err.errors : [err.message];
    document.getElementById('dlg-errors').innerHTML = list.map(m => `<li>${esc(m)}</li>`).join('');
  }
});
dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());

const field = (name, label, input) => `<div class="field"><label for="f-${name}">${label}</label>${input}</div>`;
const textInput = (name, value = '', type = 'text', extra = '') => `<input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (name, options, value = '') => `<select id="f-${name}" name="${name}">${options.map(([v, t]) =>
  `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;

function validationError(errors) {
  const err = new Error(errors.join(' '));
  err.errors = errors;
  return err;
}

// ---------- forms ----------
const LINE_ROWS = 4;

function orderForm() {
  const customers = S().customers.map(c => [c.id, c.name + (c.blocked ? ' (blocked)' : '')]);
  const items = [['', '—'], ...S().items.map(i => [i.id, `${i.sku} · ${i.name} (${e.available(i)} avail.)`])];
  let lines = '';
  for (let n = 0; n < LINE_ROWS; n++) {
    lines += `<div class="line">${select(`item${n}`, items)}
      <input name="qty${n}" type="number" min="1" step="1" placeholder="Qty" aria-label="Quantity line ${n + 1}">
      <input name="disc${n}" type="number" min="0" max="25" step="1" placeholder="Disc %" aria-label="Discount line ${n + 1}"></div>`;
  }
  openDialog('New sales order', `
    ${field('customer', 'Customer', select('customer', customers))}
    <div class="lines-head"><span>Item</span><span>Qty</span><span>Disc %</span></div>${lines}
    <div class="totals" id="live-totals"></div>`, 'Create order', fd => {
    const orderLines = [];
    for (let n = 0; n < LINE_ROWS; n++) {
      if (fd.get(`item${n}`)) orderLines.push({ itemId: fd.get(`item${n}`), qty: Number(fd.get(`qty${n}`)), discountPct: Number(fd.get(`disc${n}`) || 0) });
    }
    const o = store.run(e.createOrder, { customerId: fd.get('customer'), orderDate: today, lines: orderLines });
    toast(`${o.id} created`);
  });
  updateLiveTotals();
}

function updateLiveTotals() {
  const box = document.getElementById('live-totals');
  if (!box) return;
  const fd = new FormData(dlgForm);
  const lines = [];
  for (let n = 0; n < LINE_ROWS; n++) {
    const item = find('items', fd.get(`item${n}`));
    const qty = Number(fd.get(`qty${n}`));
    if (item && qty > 0) lines.push({ qty, unitPriceCents: item.priceCents, discountPct: Number(fd.get(`disc${n}`) || 0) });
  }
  const t = e.orderTotals(lines);
  box.innerHTML = `Subtotal ${$(t.subtotal)} · HST 13% ${$(t.tax)} · <strong>Total ${$(t.total)}</strong>`;
}
dlgForm.addEventListener('input', updateLiveTotals);

function paymentForm(inv) {
  const owing = inv.totalCents - inv.paidCents;
  openDialog(`Record payment · ${inv.id}`, `
    <p class="muted">${esc(customerName(inv.customerId))} · ${$(owing)} owing</p>
    ${field('amount', 'Amount received (CAD)', textInput('amount', (owing / 100).toFixed(2), 'number', 'min="0.01" step="0.01"'))}
    ${field('date', 'Payment date', textInput('date', today, 'date'))}`, 'Post payment', fd => {
    store.run(e.applyPayment, inv.id, e.toCents(fd.get('amount')), fd.get('date'));
    toast(`Payment posted to ${inv.id}`);
  });
}

function receiveForm(item) {
  openDialog(`Receive stock · ${item.sku}`, `
    <p class="muted">${esc(item.name)} · on hand ${item.onHand}</p>
    ${field('qty', 'Quantity received', textInput('qty', item.reorderQty, 'number', 'min="1" step="1"'))}`, 'Post receipt', fd => {
    store.run(e.receiveStock, item.id, Number(fd.get('qty')), today);
    toast(`${item.sku}: stock received`);
  });
}

function itemForm() {
  openDialog('New item', `
    ${field('sku', 'SKU (capitals, numbers, dashes)', textInput('sku'))}
    ${field('name', 'Description', textInput('name'))}
    ${field('price', 'Unit price (CAD)', textInput('price', '', 'number', 'min="0" step="0.01"'))}
    ${field('cost', 'Unit cost (CAD)', textInput('cost', '', 'number', 'min="0" step="0.01"'))}
    ${field('rp', 'Reorder point', textInput('rp', '0', 'number', 'min="0" step="1"'))}
    ${field('rq', 'Reorder quantity', textInput('rq', '10', 'number', 'min="1" step="1"'))}`, 'Save item', fd => {
    const item = {
      id: 'itm-' + Date.now().toString(36), sku: String(fd.get('sku')).trim().toUpperCase(), name: String(fd.get('name')).trim(),
      priceCents: e.toCents(fd.get('price') || 0), costCents: e.toCents(fd.get('cost') || 0),
      onHand: 0, reserved: 0, reorderPoint: Number(fd.get('rp')), reorderQty: Number(fd.get('rq')) || 1,
    };
    const errors = e.validateItem(item, S().items);
    if (errors.length) throw validationError(errors);
    store.update(s => s.items.push(item));
    toast(`${item.sku} added`);
  });
}

function customerForm() {
  openDialog('New customer', `
    ${field('name', 'Customer name', textInput('name'))}
    ${field('city', 'City', textInput('city'))}
    ${field('terms', 'Payment terms', select('terms', Object.keys(e.PAYMENT_TERMS).map(t => [t, t === 'COD' ? 'COD (cash on delivery)' : `${t} (${e.PAYMENT_TERMS[t]} days)`]), 'NET30'))}
    ${field('limit', 'Credit limit (CAD)', textInput('limit', '5000', 'number', 'min="0" step="100"'))}`, 'Save customer', fd => {
    const c = { id: 'cus-' + Date.now().toString(36), name: String(fd.get('name')).trim(), city: String(fd.get('city')).trim(),
      terms: fd.get('terms'), creditLimitCents: e.toCents(fd.get('limit') || 0), blocked: false };
    const errors = e.validateCustomer(c);
    if (errors.length) throw validationError(errors);
    store.update(s => s.customers.push(c));
    toast(`${c.name} added`);
  });
}

// ---------- views ----------
const views = {
  dashboard() {
    const s = S();
    const monthStart = today.slice(0, 8) + '01';
    const sales = e.salesSummary(s, monthStart, today);
    const aging = e.agingReport(s, today).totals;
    const overdue = aging.total - aging.Current;
    const reorder = e.reorderSuggestions(s.items);
    const todo = s.orders.filter(o => NEXT_STEP[o.status]);
    return `${head('Dashboard', 'Order-to-cash at a glance')}
      <div class="grid kpis">
        <div class="panel kpi"><div class="label">Sales this month</div><div class="value">${$(sales.revenue)}</div><div class="hint">${sales.invoices} invoices, before tax</div></div>
        <div class="panel kpi"><div class="label">Gross margin</div><div class="value">${sales.marginPct}%</div><div class="hint">${$(sales.margin)} this month</div></div>
        <div class="panel kpi"><div class="label">Receivables</div><div class="value">${$(aging.total)}</div><div class="hint">owed by customers</div></div>
        <div class="panel kpi"><div class="label">Overdue</div><div class="value">${$(overdue)}</div><div class="hint">past due date</div></div>
        <div class="panel kpi"><div class="label">Items to reorder</div><div class="value">${reorder.length}</div><div class="hint">at or below reorder point</div></div>
      </div>
      <div class="grid two-col">
        <section class="panel"><h2>Orders waiting for the next step</h2>
          ${table([{ label: 'Order' }, { label: 'Customer' }, { label: 'Status' }, { label: '' }],
            todo.map(o => `<tr><td>${o.id}</td><td>${esc(customerName(o.customerId))}</td><td>${badge(o.status)}</td>
              <td class="row-actions"><button class="btn btn-sm" data-action="${NEXT_STEP[o.status][0]}" data-id="${o.id}">${NEXT_STEP[o.status][1]}</button></td></tr>`))}
        </section>
        <section class="panel"><h2>Reorder suggestions</h2>
          ${table([{ label: 'SKU' }, { label: 'Available', num: true }, { label: 'Reorder point', num: true }, { label: 'Suggested', num: true }],
            reorder.map(i => `<tr><td>${esc(i.sku)}</td><td class="num">${i.available}</td><td class="num">${i.reorderPoint}</td><td class="num"><strong>${i.suggestQty}</strong></td></tr>`))}
        </section>
      </div>`;
  },

  orders() {
    const rows = [...S().orders].reverse().map(o => {
      const t = e.orderTotals(o.lines);
      const next = NEXT_STEP[o.status];
      return `<tr><td><strong>${o.id}</strong></td><td>${fmtDate(o.orderDate)}</td><td>${esc(customerName(o.customerId))}</td>
        <td>${o.lines.map(l => `${l.qty} × ${esc(l.sku)}${l.discountPct ? ` (−${l.discountPct}%)` : ''}`).join('<br>')}</td>
        <td class="num">${$(t.total)}</td><td>${badge(o.status)}</td>
        <td class="row-actions">${next ? `<button class="btn btn-sm" data-action="${next[0]}" data-id="${o.id}">${next[1]}</button>` : (o.invoiceId ? `<span class="muted">${o.invoiceId}</span>` : '')}</td></tr>`;
    });
    return `${head('Sales orders', 'Create an order, then move it through each step', ['new-order', '+ New order'])}
      <div class="flow"><span>Open</span>→<span>Released (credit + stock checked, stock reserved)</span>→<span>Shipped (stock reduced)</span>→<span>Invoiced</span></div>
      ${table([{ label: 'Order' }, { label: 'Date' }, { label: 'Customer' }, { label: 'Lines' }, { label: 'Total incl. HST', num: true }, { label: 'Status' }, { label: '' }], rows)}`;
  },

  invoices() {
    const rows = [...S().invoices].reverse().map(i => {
      const st = e.invoiceStatus(i, today);
      return `<tr><td><strong>${i.id}</strong></td><td>${esc(customerName(i.customerId))}</td><td>${fmtDate(i.date)}</td><td>${fmtDate(i.dueDate)}</td>
        <td class="num">${$(i.totalCents)}</td><td class="num">${$(i.paidCents)}</td><td class="num">${$(i.totalCents - i.paidCents)}</td><td>${badge(st)}</td>
        <td class="row-actions">${st === 'Paid' ? '' : `<button class="btn btn-sm" data-action="pay" data-id="${i.id}">Record payment</button>`}</td></tr>`;
    });
    return `${head('Invoices', 'Posted sales invoices and customer payments')}
      ${table([{ label: 'Invoice' }, { label: 'Customer' }, { label: 'Date' }, { label: 'Due' }, { label: 'Total', num: true }, { label: 'Paid', num: true }, { label: 'Balance', num: true }, { label: 'Status' }, { label: '' }], rows)}`;
  },

  customers() {
    const s = S();
    const rows = s.customers.map(c => {
      const exp = e.creditExposure(s, c.id);
      return `<tr><td><strong>${esc(c.name)}</strong>${c.blocked ? ' <span class="badge bad">Blocked</span>' : ''}</td><td>${esc(c.city)}</td><td>${c.terms}</td>
        <td class="num">${$(c.creditLimitCents)}</td><td class="num">${$(exp)}</td><td class="num">${$(Math.max(0, c.creditLimitCents - exp))}</td></tr>`;
    });
    return `${head('Customers', 'Payment terms and credit limits', ['new-customer', '+ New customer'])}
      ${table([{ label: 'Name' }, { label: 'City' }, { label: 'Terms' }, { label: 'Credit limit', num: true }, { label: 'Owing + on order', num: true }, { label: 'Credit available', num: true }], rows)}`;
  },

  items() {
    const rows = S().items.map(i => {
      const low = e.available(i) <= i.reorderPoint;
      const margin = Math.round(((i.priceCents - i.costCents) / i.priceCents) * 100);
      return `<tr><td><strong>${esc(i.sku)}</strong></td><td>${esc(i.name)}</td><td class="num">${$(i.priceCents)}</td><td class="num">${margin}%</td>
        <td class="num">${i.onHand}</td><td class="num">${i.reserved}</td><td class="num">${e.available(i)} ${low ? '<span class="badge warn">Reorder</span>' : ''}</td>
        <td class="row-actions"><button class="btn btn-sm" data-action="receive" data-id="${i.id}">Receive stock</button></td></tr>`;
    });
    return `${head('Items', 'Available = on hand − reserved for released orders', ['new-item', '+ New item'])}
      ${table([{ label: 'SKU' }, { label: 'Description' }, { label: 'Price', num: true }, { label: 'Margin', num: true }, { label: 'On hand', num: true }, { label: 'Reserved', num: true }, { label: 'Available', num: true }, { label: '' }], rows)}`;
  },

  ledger() {
    const rows = [...S().itemLedger].reverse().map(l => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.sku)}</td><td>${l.type}</td>
      <td class="num">${l.qty > 0 ? '+' : ''}${l.qty}</td><td>${esc(l.document)}</td></tr>`);
    return `${head('Item ledger', 'Every stock movement, newest first. Entries are never edited, only added.')}
      ${table([{ label: 'Date' }, { label: 'SKU' }, { label: 'Type' }, { label: 'Quantity', num: true }, { label: 'Document' }], rows)}`;
  },

  aging() {
    const r = e.agingReport(S(), today);
    const cols = [{ label: 'Customer' }, ...e.AGING_BUCKETS.map(b => ({ label: b === 'Current' ? 'Current' : `${b} days`, num: true })), { label: 'Total', num: true }];
    const row = x => `<td class="num">${x ? $(x) : '—'}</td>`;
    const rows = r.rows.map(x => `<tr><td>${esc(x.name)}</td>${e.AGING_BUCKETS.map(b => row(x[b])).join('')}<td class="num"><strong>${$(x.total)}</strong></td></tr>`);
    const foot = `<tfoot><tr><td>Total</td>${e.AGING_BUCKETS.map(b => row(r.totals[b])).join('')}<td class="num">${$(r.totals.total)}</td></tr></tfoot>`;
    return `${head('Accounts receivable aging', `Unpaid balances by days past due, as of ${fmtDate(today)}`)}${table(cols, rows, foot)}`;
  },
};

// ---------- actions ----------
const actions = {
  'new-order': () => orderForm(),
  'new-item': () => itemForm(),
  'new-customer': () => customerForm(),
  release: id => { store.run(e.releaseOrder, id); toast(`${id} released: stock reserved`); render(); },
  ship: id => { store.run(e.shipOrder, id, today); toast(`${id} shipped`); render(); },
  invoice: id => { const inv = store.run(e.invoiceOrder, id, today); toast(`${inv.id} posted, due ${fmtDate(inv.dueDate)}`); render(); },
  pay: id => paymentForm(find('invoices', id)),
  receive: id => receiveForm(find('items', id)),
};

main.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  try { actions[btn.dataset.action](btn.dataset.id); } catch (err) { toast(err.message, true); }
});

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Reset all demo data to the original sample records?')) return;
  store.reset(); toast('Demo data reset'); render();
});

function currentView() {
  const v = location.hash.slice(1);
  return views[v] ? v : 'dashboard';
}

function render() {
  const v = currentView();
  main.innerHTML = views[v]();
  document.querySelectorAll('.sidenav a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === v);
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${main.querySelector('h1').textContent} · Northfield ERP`;
}

window.addEventListener('hashchange', () => { render(); main.focus(); });
render();
