# ForgeFlow ERP — Implementation Plan

ForgeFlow is an original manufacturing ERP for small and midsize discrete manufacturers.
It takes inspiration from capabilities that integrated manufacturing ERPs document publicly
(MRP, multi-level BOMs, job costing, lot traceability, order management, quality,
finance). All code, branding, data models and UI are original. It is **not** affiliated
with or compatible with any commercial product.

The product name lives in one place: `src/lib/brand.ts`.

## 1. Architecture

```
Browser (React 19 client components: charts, tables, forms, command palette)
   │  Server Actions (POST) / RSC navigation
   ▼
Next.js 16 App Router (Node runtime)
   ├─ src/app/(app)/**          route segments (Server Components read via queries)
   ├─ src/app/**/actions.ts     server actions: parse with Zod → call services
   ├─ src/server/auth           session (signed cookie or Supabase Auth) → AuthContext
   ├─ src/server/services       business transactions (authorize → validate → lock →
   │                            post movements → audit → idempotency), one DB tx each
   ├─ src/server/queries        read models (dashboard KPIs, lists, details, reports)
   └─ src/server/db             driver adapter: PGlite (demo) | postgres.js (Supabase)
   ▼
PostgreSQL schema (supabase/migrations/*.sql) — same SQL in both modes
   constraints (no negative stock, received ≤ ordered), immutable ledgers (triggers),
   RLS policies (member read-only; writes only through the server), org-scoped indices
```

Key decisions:

| Decision | Choice | Why |
| --- | --- | --- |
| Database | PostgreSQL via Supabase in production; **PGlite** (Postgres compiled to WASM) for the zero-setup demo | Same migrations, same SQL, real transactions and constraints in both modes |
| Business logic | TypeScript service layer inside DB transactions with `SELECT … FOR UPDATE` | Testable with Vitest against a real Postgres engine; explicit authorization per call |
| Money/quantities | `numeric` in SQL; exact scaled-integer (`bigint`) helpers in TS (`src/lib/decimal.ts`) | No binary floating point in posting logic |
| Dates | Business dates are `date` columns computed in the org timezone; events are `timestamptz` | Lateness and scheduling are timezone-aware |
| Clock | Services take time from `ctx.now()` | The seed replays 6 months of history through the real services; tests control time |
| Rendering | Dynamic server rendering (Cache Components disabled) | Every page is per-user/tenant and session-dependent |
| Auth | Demo: signed HMAC cookie with persona picker. Supabase: `@supabase/ssr` email/password | Reviewers can try every role without credentials |
| Authorization | `authorize(ctx, permission)` inside every service + org-scoped SQL; RLS as defense in depth | Never relies on hidden UI controls |

## 2. Entity overview

See `docs/ERD.md` for the full diagram. Main aggregates:

- **Tenancy**: organizations → sites → warehouses → bins; profiles ↔ memberships (role) ↔ organizations; roles
- **Engineering**: items, item_revisions, boms (versioned) → bom_lines, engineering_changes, routing_operations, work_centers
- **Inventory**: inventory_lots, inventory_balances (item × warehouse × bin × lot), inventory_movements (immutable ledger), inventory_reservations (SO reserved / WO allocated)
- **Purchasing**: suppliers, purchase_orders → purchase_order_lines → goods_receipts, supplier_bills
- **Production**: work_orders (BOM snapshot) → work_order_materials, work_order_operations, material_issues, production_receipts
- **Sales**: customers, sales_orders → sales_order_lines, shipments → shipment_lines, invoices → invoice_lines, payments
- **Quality**: quality_events (NCR/complaint), inspections, quality_holds, capa_actions
- **Planning**: mrp_runs → mrp_suggestions
- **Finance**: accounts, journal_entries → journal_lines (auto-posted operational entries)
- **Platform**: audit_events (immutable), idempotency_keys, number_sequences

## 3. Routes

| Route | Purpose |
| --- | --- |
| `/login` | Demo persona picker (or Supabase sign-in) |
| `/dashboard` | Executive overview + Planner / Warehouse / Quality views |
| `/inventory`, `/inventory/items/[id]`, `/inventory/lots`, `/inventory/movements` | Part master, stock by location, lots, ledger, stock transactions |
| `/engineering`, `/engineering/boms`, `/engineering/boms/[id]`, `/engineering/changes` | BOMs, tree, cost roll-up, where-used, ECOs |
| `/production`, `/production/work-orders/[id]`, `/production/schedule` | Work orders, readiness, issue/complete, work-center board |
| `/planning/mrp` | MRP run, time-phased suggestions, approval |
| `/sales/orders`, `/sales/orders/[id]`, `/sales/orders/new`, `/sales/customers` | Orders, ATP, reservations, shipments, invoicing |
| `/purchasing`, `/purchasing/orders/[id]`, `/purchasing/orders/new`, `/purchasing/suppliers` | POs, approval, receiving |
| `/quality`, `/quality/events/[id]` | NCRs, holds, CAPA, inspections, lot traceability |
| `/finance` | Revenue/margin, invoices, AR/AP aging, chart of accounts, journal |
| `/reports` | Report catalog with filters, definitions and CSV export |
| `/settings` | Organization, sites/warehouses, team & roles, permission matrix, audit trail, feature toggles, demo reset |

## 4. Phases

0. **Audit & plan** — repository was empty; scaffolded Next.js 16 + TS + Tailwind 4.
1. **Running dashboard** — shell, demo auth, seeded coherent dataset, dashboard from live queries, light/dark.
2. **Operational core** — part master, lots/locations, stock transactions, receiving, BOMs, work orders.
3. **End-to-end slice** — SO reservation/shipment/invoice, PO receiving, WO issue/completion, quality hold/release, MRP suggestions, audit history.
4. **Expansion** — finance views, reports, ECO workflow, permissions matrix, tests. Remaining items in `NEXT_STEPS.md`.

## 5. Assumptions

- Inventory is valued at **standard cost** (item `standard_cost`); variances are not yet posted.
- Revenue for KPIs is recognized at **shipment** (shipped quantity × order price). Invoices are generated from shipped quantities.
- One base currency per organization (USD in the demo); multi-currency is Phase 4+.
- Reservations are item × warehouse (not lot-specific); lot selection happens FIFO-by-expiry at issue/ship time, skipping held lots.
- Negative inventory is never allowed (database `CHECK` + service validation); no override path in v1.
- The demo data is entirely fictional. The software makes no regulatory (FDA, ISO, Part 11) or accounting-standard (GAAP) claims.
