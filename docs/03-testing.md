# 03 · Test Plan, Test Cases and Results

**Test run:** 21 November 2026 · **Build:** v1.0.0
**Summary:** 35 test cases (21 automated + 14 UAT) · **35 passed · 0 failed** · 0 open defects

## 1. Approach

| Level | Scope | How |
|---|---|---|
| Unit | Each posting rule and calculation | Automated (`tests/engine.test.js`), Node.js test runner |
| Integration | Sample data built through the engine stays consistent | Automated (`tests/seed.test.js`) |
| UAT | End-to-end business scenarios in the browser | Scripted walkthrough (UAT-01 to UAT-14) in Chrome, desktop and phone sizes |
| Regression | All automated tests on every push | GitHub Actions |

**Entry criteria:** sample data loads, the automated tests run. **Exit criteria:** all tests executed, 0 open critical or high defects, every Must requirement covered.
Both positive and negative cases are tested for every rule. Boundary cases cover the aging bucket edges (day 0, 1, 30, 31, 90, 91) and the exact credit limit.

## 2. Automated test cases

| ID | Req | Scenario | Expected | Result |
|---|---|---|---|---|
| TC-01 | REQ-02 | Item validation: bad SKU, cost above price, duplicate SKU | Each rejected with a clear message | ✅ Pass |
| TC-02 | REQ-01 | Customer validation: blank name, unknown terms, negative limit | 3 errors | ✅ Pass |
| TC-03 | REQ-03, NFR-02 | 3 × $8.99 + 1 × $649.00 at 10% off | Subtotal $611.07, HST $79.44, total $690.51 | ✅ Pass |
| TC-04 | REQ-03 | No lines; qty 1.5; discount 40% | All rejected | ✅ Pass |
| TC-05 | REQ-01 | Order for a blocked customer | Rejected | ✅ Pass |
| TC-06 | REQ-03 | Two new orders | SO-1001, SO-1002 | ✅ Pass |
| TC-07 | REQ-04 | Release 4 of 10 | Reserved 4, available 6, on hand unchanged | ✅ Pass |
| TC-08 | REQ-04, NFR-01 | Release with one line short | Rejected; **nothing** reserved on the other line | ✅ Pass |
| TC-09 | REQ-05 | $452 owing + $56.50 order > $500 limit | "Credit limit exceeded" | ✅ Pass |
| TC-10 | NFR-01 | Failed transaction | Original data byte-for-byte unchanged | ✅ Pass |
| TC-11 | REQ-06, REQ-07 | Ship an Open order; invoice an Open order; release twice | All rejected | ✅ Pass |
| TC-12 | REQ-06, NFR-03 | Ship 4 | On hand −4, reserved −4, ledger entry "Sale −4" | ✅ Pass |
| TC-13 | REQ-07 | Invoice on 11 Jan, NET30 | INV-1001, due 10 Feb, $22.60 | ✅ Pass |
| TC-14 | REQ-08 | Pay $10, try $12.61 (too much), pay $12.60, pay again | Partly paid → blocked → Paid → blocked | ✅ Pass |
| TC-15 | REQ-09 | Bucket boundaries: 0, 1, 30, 31, 90, 91 days late | Current, 1-30, 1-30, 31-60, 61-90, 90+ | ✅ Pass |
| TC-16 | REQ-09 | Aging after a partial payment | Only the open $20.00 shown, in 31-60 | ✅ Pass |
| TC-17 | REQ-10 | Reorder list after reserving stock | Uses available (not on hand); suggests 21 | ✅ Pass |
| TC-18 | REQ-02 | Receive 5; receive −1 | On hand +5 with ledger entry; negative rejected | ✅ Pass |
| TC-19 | REQ-10 | Sales summary | Revenue $50, cost $30, margin 40% | ✅ Pass |
| TC-20 | All | Sample data consistency | Reserved = released order qty; invoice = order total; payments = paid amount | ✅ Pass |
| TC-21 | All | Sample data coverage | Every order status and aging bucket present | ✅ Pass |

## 3. User acceptance tests (UAT)

Run in Chrome against the demo after **Reset demo data**.

| ID | Req | Steps | Expected | Result |
|---|---|---|---|---|
| UAT-01 | REQ-10 | Open Dashboard | KPIs, orders waiting for the next step, and reorder suggestions shown | ✅ Pass |
| UAT-02 | REQ-03 | New order → Maple Leaf Accounting → 10 × PEN-BLU-12 | Live total shows $73.34 before saving; SO-1011 created | ✅ Pass |
| UAT-03 | REQ-04, 06, 07 | SO-1011 → Release → Ship → Invoice | Messages at each step; INV-1008 created | ✅ Pass |
| UAT-04 | REQ-01 | New order for Old Mill Law Office (blocked) | Error: customer is blocked | ✅ Pass |
| UAT-05 | REQ-05 | New order for Bayview Startup Hub: 2 standing desks → Release | "Credit limit exceeded…" with amounts | ✅ Pass |
| UAT-06 | REQ-04 | New order: 9 standing desks → Release | "Not enough stock for DSK-STD-60: 4 available, 9 needed." | ✅ Pass |
| UAT-07 | REQ-08 | Invoices → INV-1004 → Record payment (full balance) | Status changes to Paid | ✅ Pass |
| UAT-08 | REQ-08 | INV-1001 → Record payment $99,999 | Error: payment is more than the amount owing | ✅ Pass |
| UAT-09 | REQ-02, NFR-03 | Items → DSK-STD-60 → Receive stock (6) → Item ledger | On hand 4 → 10; "Purchase +6 RCPT-1001" in the ledger | ✅ Pass |
| UAT-10 | REQ-02 | New item: SKU "bad sku", price $5, cost $9 | Two errors: SKU format, and selling at a loss | ✅ Pass |
| UAT-11 | REQ-09 | Open AR aging | Customers by bucket with a totals row | ✅ Pass |
| UAT-12 | REQ-01 | New customer "Guelph Clinic" | Listed with NET30 and a $5,000 limit | ✅ Pass |
| UAT-13 | NFR | Reload the page, then Reset demo data | Data kept after reload; reset restores the samples | ✅ Pass |
| UAT-14 | NFR-04 | Sales orders at phone width (390px) | Menu wraps to the top; table scrolls sideways | ✅ Pass |

## 4. Traceability matrix

| Requirement | Automated | UAT |
|---|---|---|
| REQ-01 Customers | TC-02, TC-05 | UAT-04, UAT-12 |
| REQ-02 Items and stock | TC-01, TC-18 | UAT-09, UAT-10 |
| REQ-03 Sales orders | TC-03, TC-04, TC-06 | UAT-02 |
| REQ-04 Stock reservation | TC-07, TC-08 | UAT-03, UAT-06 |
| REQ-05 Credit check | TC-09 | UAT-05 |
| REQ-06 Shipping | TC-11, TC-12 | UAT-03 |
| REQ-07 Invoicing | TC-11, TC-13 | UAT-03 |
| REQ-08 Payments | TC-14 | UAT-07, UAT-08 |
| REQ-09 AR aging | TC-15, TC-16 | UAT-11 |
| REQ-10 Dashboard and reorder | TC-17, TC-19 | UAT-01 |
| NFR-01 All-or-nothing posting | TC-08, TC-10 | — |
| NFR-02 Exact money | TC-03 | UAT-02 |
| NFR-03 Audit trail | TC-12, TC-18 | UAT-09 |

## 5. Defects

| ID | Found in | Description | Severity | Status |
|---|---|---|---|---|
| DEF-01 | UAT review | Sample order SO-1002 was dated before SO-1001; document numbers must follow posting order | Low | Fixed. Sample history is created in date order |
| DEF-02 | Seed review | An invoice meant to be 90+ days overdue fell in the 61–90 bucket | Low | Fixed. TC-21 now checks every bucket has data |
