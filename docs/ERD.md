# ForgeFlow ERP — Entity relationship diagram

Source of truth: `supabase/migrations/20261011000001_core_schema.sql` (tables, constraints,
triggers) and `20261011000002_security.sql` (row-level security). Every business table carries
`organization_id` (tenant key, `on delete cascade` from `organizations`); it is omitted from the
diagrams below to keep them readable. Audit columns (`created_by`, `released_by`, …) reference
`profiles` and are also omitted unless they matter to a workflow.

The diagrams are split by domain. Entities that appear in more than one diagram are the same table.

## Tenancy and access

```mermaid
erDiagram
  organizations ||--o{ sites : has
  organizations ||--o{ memberships : grants
  profiles ||--o{ memberships : holds
  roles ||--o{ memberships : "role_key"
  sites ||--o{ warehouses : contains
  warehouses ||--o{ bins : contains
  sites ||--o{ work_centers : runs

  organizations { uuid id PK; text name; text timezone; char base_currency; jsonb settings "features: operating policies"; bool is_demo }
  profiles { uuid id PK; text email UK; text full_name; uuid auth_user_id "Supabase auth link" }
  memberships { uuid id PK; uuid profile_id FK; text role_key FK; bool is_active }
  roles { text key PK; text name; text[] permissions "display copy of src/lib/permissions.ts" }
  sites { uuid id PK; text code; text timezone }
  warehouses { uuid id PK; uuid site_id FK; text code; text kind "stores | finished_goods | general" }
  bins { uuid id PK; uuid warehouse_id FK; text code }
  work_centers { uuid id PK; uuid site_id FK; numeric capacity_hours_per_day; numeric hourly_rate }
```

## Engineering

```mermaid
erDiagram
  items ||--o{ boms : "parent of"
  boms ||--o{ bom_lines : lists
  items ||--o{ bom_lines : "component in"
  items ||--o{ routing_operations : "routed by"
  work_centers ||--o{ routing_operations : performs
  items ||--o{ engineering_changes : "changed by"
  boms |o--o{ engineering_changes : targets
  engineering_changes |o--o{ item_revisions : creates
  items ||--o{ item_revisions : "revision history"
  suppliers |o--o{ items : "preferred supplier"

  items { uuid id PK; text sku UK; text item_type "purchased | manufactured"; numeric standard_cost; text tracking "none | lot | serial"; int lead_time_days; numeric safety_stock; numeric min_order_qty }
  boms { uuid id PK; uuid item_id FK; text revision; text status "draft | released | obsolete" }
  bom_lines { uuid id PK; uuid bom_id FK; uuid component_item_id FK; numeric quantity_per; numeric scrap_pct }
  engineering_changes { uuid id PK; text change_number; text status "draft | in_review | approved | implemented | rejected | canceled"; text to_revision }
```

A trigger (`app.check_bom_cycle`) rejects BOM lines that would make an item its own
descendant. Only one released BOM per item is used for new work orders.

## Inventory

```mermaid
erDiagram
  items ||--o{ inventory_lots : "lot-tracked as"
  suppliers |o--o{ inventory_lots : supplied
  inventory_lots |o--o{ inventory_balances : "on hand"
  warehouses ||--o{ inventory_balances : stores
  bins |o--o{ inventory_balances : "located in"
  items ||--o{ inventory_movements : moves
  inventory_lots |o--o{ inventory_movements : moves
  inventory_movements |o--o| inventory_movements : "reversal_of"
  items ||--o{ inventory_reservations : "reserved / allocated"
  warehouses ||--o{ inventory_reservations : at

  inventory_lots { uuid id PK; text lot_number; text status "available | quarantine | hold"; date expires_on; text origin "purchase | production | adjustment | opening" }
  inventory_balances { uuid id PK; numeric qty_on_hand "CHECK >= 0"; unique item_warehouse_bin_lot }
  inventory_movements { uuid id PK; bigint seq; text movement_type; numeric quantity "signed"; numeric unit_cost; text reference_type; uuid reference_id; timestamptz occurred_at }
  inventory_reservations { uuid id PK; text demand_type "sales_order_line | work_order_material"; uuid demand_id; numeric quantity; text status "open | closed" }
```

`inventory_movements` is an append-only ledger (`app.prevent_ledger_mutation` blocks
UPDATE/DELETE); corrections are new offsetting rows. `inventory_balances` is maintained in the same
transaction as each movement and must always equal the ledger sum (Settings → Data shows the
live reconciliation).

## Purchasing

```mermaid
erDiagram
  suppliers ||--o{ purchase_orders : receives
  purchase_orders ||--o{ purchase_order_lines : contains
  items ||--o{ purchase_order_lines : orders
  purchase_order_lines ||--o{ goods_receipts : "received by"
  goods_receipts }o--|| inventory_movements : posts
  goods_receipts }o--o| inventory_lots : creates
  suppliers ||--o{ supplier_bills : bills
  purchase_orders |o--o{ supplier_bills : "for"
  supplier_bills |o--o{ payments : "paid by"

  purchase_orders { uuid id PK; text po_number UK; text status "draft | approved | partially_received | received | closed | canceled"; date expected_date; text source "manual | mrp" }
  purchase_order_lines { uuid id PK; numeric quantity_ordered; numeric quantity_received "CHECK <= ordered"; numeric unit_cost }
  goods_receipts { uuid id PK; text receipt_number; numeric quantity; numeric unit_cost; timestamptz received_at }
```

## Production

```mermaid
erDiagram
  items ||--o{ work_orders : builds
  boms |o--o{ work_orders : "snapshot from"
  work_orders ||--o{ work_order_materials : requires
  work_orders ||--o{ work_order_operations : routes
  work_order_materials ||--o{ material_issues : "issued by"
  work_orders ||--o{ production_receipts : outputs
  material_issues }o--|| inventory_movements : posts
  production_receipts }o--o| inventory_movements : posts
  production_receipts }o--o| inventory_lots : creates
  sales_order_lines |o--o{ work_orders : "make to order"

  work_orders { uuid id PK; text wo_number UK; jsonb bom_snapshot "frozen at creation"; numeric quantity_planned; numeric quantity_completed; numeric quantity_scrapped; text status "draft | released | in_progress | on_hold | completed | closed | canceled"; date planned_start; date due_date }
  work_order_materials { uuid id PK; numeric quantity_per; numeric quantity_required; numeric quantity_issued; numeric unit_cost }
  production_receipts { uuid id PK; numeric quantity_good; numeric quantity_scrap; numeric unit_cost }
```

## Sales and fulfillment

```mermaid
erDiagram
  customers ||--o{ sales_orders : places
  sales_orders ||--o{ sales_order_lines : contains
  items ||--o{ sales_order_lines : sells
  sales_orders ||--o{ shipments : "shipped by"
  shipments ||--o{ shipment_lines : contains
  sales_order_lines ||--o{ shipment_lines : fulfills
  shipment_lines }o--|| inventory_movements : posts
  sales_orders ||--o{ invoices : "billed by"
  shipments |o--o{ invoices : "invoiced from"
  invoices ||--o{ invoice_lines : contains
  invoices |o--o{ payments : "paid by"

  sales_orders { uuid id PK; text so_number UK; text status "draft | confirmed | partially_shipped | shipped | closed | canceled | on_hold"; date promised_date }
  sales_order_lines { uuid id PK; numeric quantity_ordered; numeric quantity_shipped "CHECK <= ordered"; numeric quantity_invoiced "CHECK <= shipped"; numeric unit_price }
  shipment_lines { uuid id PK; numeric quantity; numeric unit_price; numeric unit_cost "standard cost at shipment" }
  invoices { uuid id PK; text invoice_number; text status "draft | issued | paid | void"; numeric total; numeric amount_paid; date due_date }
```

## Quality

```mermaid
erDiagram
  quality_events ||--o{ capa_actions : "corrected by"
  quality_events |o--o{ quality_holds : "placed by"
  inventory_lots ||--o{ quality_holds : "held"
  quality_events |o--o{ inspections : "raised from"
  inventory_lots |o--o{ inspections : inspects
  items |o--o{ quality_events : concerns
  inventory_lots |o--o{ quality_events : concerns
  suppliers |o--o{ quality_events : "supplier issue"
  customers |o--o{ quality_events : "complaint from"
  work_orders |o--o{ quality_events : "found on"

  quality_events { uuid id PK; text event_number "NCR- | CMP- | DEV- | AUD-"; text event_type; text severity; text status; text disposition; date due_date }
  quality_holds { uuid id PK; text status "active | released"; text reason; text previous_lot_status; text release_reason "required to release" }
  capa_actions { uuid id PK; text capa_number; text action_type "corrective | preventive"; text status "open | in_progress | verified | closed"; date due_date }
```

A lot on hold or in quarantine is skipped by automatic (FEFO) picking and rejected when
selected explicitly, so it cannot be issued or shipped until quality releases it.

## Planning, finance and platform

```mermaid
erDiagram
  mrp_runs ||--o{ mrp_suggestions : proposes
  items ||--o{ mrp_suggestions : "for"
  suppliers |o--o{ mrp_suggestions : "buy from"
  journal_entries ||--o{ journal_lines : "balanced lines"
  accounts ||--o{ journal_lines : posts
  profiles |o--o{ audit_events : "acted"

  mrp_suggestions { uuid id PK; text suggestion_type "purchase | manufacture"; numeric quantity; date need_date; date release_date; text explanation; jsonb pegging; text status "open | approved | dismissed"; text created_document_number }
  journal_entries { uuid id PK; text entry_number; text source_type; uuid source_id; date entry_date }
  journal_lines { uuid id PK; numeric debit; numeric credit }
  audit_events { uuid id PK; bigint seq; text action; text entity_type; uuid entity_id; jsonb before; jsonb after; jsonb metadata "seed: true for generated history" }
  idempotency_keys { text key PK "with organization_id"; text operation; text request_hash; jsonb response }
  number_sequences { text prefix PK "with organization_id"; bigint next_value }
```

- `journal_lines` are checked by a deferred constraint trigger (`app.check_journal_balanced`):
  every entry must balance at commit. Entries are generated by operational transactions
  (receipts, issues, production, shipments, invoices, payments) under standard costing.
- `inventory_movements`, `goods_receipts`, `material_issues`, `production_receipts`,
  `shipment_lines`, `journal_entries`, `journal_lines` and `audit_events` are append-only
  (UPDATE/DELETE blocked by `app.prevent_ledger_mutation`).
- `idempotency_keys` make receipts, issues, output and shipments safe to resubmit.

## Row-level security

`20261011000002_security.sql` enables RLS on every tenant table with **read-only** policies
for members of the owning organization (`app.is_member(organization_id)`, keyed by
`auth.uid()` → `profiles.auth_user_id`). There are no insert/update/delete policies: all writes
go through the server's service layer, which authorizes each call. RLS is defense in depth for
any direct client access with the Supabase anon key.
