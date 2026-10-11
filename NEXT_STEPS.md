# ForgeFlow ERP — Next steps and known limitations

Status as of this MVP. Route-level status (Working / Partial) is in the README.

## Prioritized next tasks

1. **Master-data setup and import.** UI to create and edit sites, warehouses, bins and work
   centers (read-only in Settings today), plus CSV import with validation previews for items,
   BOMs, suppliers, customers and opening stock. Required before any real pilot.
2. **Production-grade sign-in on Supabase.** Member invitations and password reset, session
   lifetime settings, Playwright coverage in `AUTH_MODE=supabase`, and running the RLS test
   suite against a real Supabase project (today RLS is tested on PGlite with an `auth.uid()` shim).
3. **Returns and credits.** RMA → receipt into quarantine → disposition → credit memo, plus
   explicit backorder handling and customer-facing order acknowledgements.
4. **Finance hardening.** Period close/lock, manual journal entries with approval, reversal
   entries, actual labor capture (time tracking) with labor/overhead variance analysis, tax
   rules and multi-currency.
5. **Finite-capacity scheduling.** Capacity-aware sequencing, drag-and-drop schedule board,
   shift calendars, and server-side pagination for very large lists.

## Known limitations

### Inventory and costing
- Valuation is **standard cost** only. Purchase price variance posts at receipt and production
  variance when a work order closes; there is no FIFO/average costing or cost re-rolls with
  revaluation.
- Items with tracking `serial` are handled like lot-tracked items (one lot number per receipt);
  per-unit serial numbers are not implemented.
- Reservations are item × warehouse, not lot-specific; lots are chosen at issue/ship time
  (first-expiring first, held/quarantined/expired lots skipped) or picked explicitly.
- No unit-of-measure conversions (purchase vs stocking units).
- Negative inventory is never allowed and there is no override.

### Planning and production
- MRP lot sizing is lot-for-lot with minimum order quantity and safety stock; no EOQ/period
  order quantity, no capacity check, no multi-site transfer planning.
- The schedule board is an infinite-capacity queue; operations are completed one by one, with
  no labor time entry.
- Phantom BOMs, co-products/by-products and alternate components are not modeled.

### Sales, purchasing and finance
- One currency per organization; no tax engine; invoices are generated from shipped quantity.
- Supplier bills are created from received quantities (no three-way match tolerances).
- Finance pages are an operational sub-ledger derived from transactions. They are not GAAP
  financial statements and there is no period close.

### Quality
- NCR, CAPA, holds and inspections support a quality process, but the system is **not
  validated** for regulated manufacturing (no FDA/ISO 13485 validation package, no 21 CFR
  Part 11 electronic signatures, no document control).
- No attachments (photos, certificates) on quality records yet.

### Platform
- `AUTH_MODE=demo` lets anyone with the URL choose a persona; use only with fictional data.
- The embedded PGlite database is single-process; hosted deployments should use PostgreSQL.
- Seeding 180 days of history takes about a minute on PGlite (it replays every transaction
  through the services); on PostgreSQL it is faster.
- Lists are fetched in full and filtered in the browser (fine for demo volumes); some long logs
  are capped (journal 300 entries, audit trail 1,000 per range, item movements 100).
- No email/notification delivery, webhooks or public API yet.
- Accessibility has been considered (labels, keyboard navigation, chart table views, contrast)
  but has not had a formal audit; the UI is English-only.

## Ideas beyond the roadmap
- Customer and supplier portals (order status, ASN, certificates of conformance).
- EDI/API integrations and accounting-system export.
- Configurable dashboards and a report builder.
- Mobile scanning workflows for receiving, picking and cycle counts.
