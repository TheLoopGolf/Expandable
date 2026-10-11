-- ForgeFlow ERP — core relational schema
-- Runs unchanged on Supabase Postgres (15+) and on PGlite (embedded demo mode).
-- Conventions:
--   * every tenant-scoped table carries organization_id
--   * quantities numeric(14,4), money numeric(14,2) / unit costs numeric(14,4)
--   * business dates are `date` (computed in the org timezone), events are timestamptz
--   * statuses are text + CHECK constraints so they can evolve without enum migrations
--   * ledgers (movements, receipts, issues, journal, audit) are append-only (see triggers)

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  base_currency char(3) not null default 'USD',
  timezone text not null default 'America/Chicago',
  settings jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  title text,
  auth_user_id uuid unique,
  created_at timestamptz not null default now()
);

create table roles (
  key text primary key,
  name text not null,
  description text not null,
  permissions text[] not null default '{}',
  sort_order int not null default 0
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  timezone text not null,
  address text,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index sites_org_idx on sites (organization_id);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role_key text not null references roles(key),
  default_site_id uuid references sites(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);
create index memberships_profile_idx on memberships (profile_id);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('stores', 'finished_goods', 'general')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index warehouses_org_idx on warehouses (organization_id, site_id);

create table bins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id),
  code text not null,
  description text,
  unique (warehouse_id, code)
);
create index bins_org_idx on bins (organization_id);

-- ---------------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  contact_name text,
  email text,
  phone text,
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  default_lead_time_days int not null default 14 check (default_lead_time_days >= 0),
  rating numeric(3,1) check (rating between 0 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index suppliers_org_idx on suppliers (organization_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  contact_name text,
  email text,
  phone text,
  segment text,
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  credit_limit numeric(14,2) check (credit_limit >= 0),
  ship_to text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index customers_org_idx on customers (organization_id);

-- ---------------------------------------------------------------------------
-- Engineering: items, revisions, BOMs, routings, work centers, ECOs
-- ---------------------------------------------------------------------------
create table work_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null references sites(id),
  code text not null,
  name text not null,
  kind text not null default 'assembly',
  capacity_hours_per_day numeric(6,2) not null default 8 check (capacity_hours_per_day > 0),
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  is_active boolean not null default true,
  unique (organization_id, code)
);
create index work_centers_org_idx on work_centers (organization_id);

create table items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  description text,
  item_type text not null check (item_type in ('purchased', 'manufactured')),
  category text not null,
  product_family text,
  uom text not null default 'ea',
  revision text not null default 'A',
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('draft', 'active', 'hold', 'obsolete')),
  standard_cost numeric(14,4) not null default 0 check (standard_cost >= 0),
  list_price numeric(14,2) check (list_price >= 0),
  preferred_supplier_id uuid references suppliers(id),
  lead_time_days int not null default 0 check (lead_time_days >= 0),
  reorder_point numeric(14,4) not null default 0 check (reorder_point >= 0),
  safety_stock numeric(14,4) not null default 0 check (safety_stock >= 0),
  min_order_qty numeric(14,4) not null default 1 check (min_order_qty > 0),
  tracking text not null default 'none' check (tracking in ('none', 'lot', 'serial')),
  shelf_life_days int check (shelf_life_days > 0),
  default_warehouse_id uuid references warehouses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create index items_org_idx on items (organization_id, item_type);
create index items_family_idx on items (organization_id, product_family);

create table boms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  revision text not null,
  status text not null default 'draft' check (status in ('draft', 'released', 'obsolete')),
  effective_from date,
  effective_to date,
  notes text,
  created_by uuid references profiles(id),
  released_by uuid references profiles(id),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, revision),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
-- At most one released BOM revision per assembly at any time.
create unique index boms_one_released_idx on boms (item_id) where status = 'released';
create index boms_org_idx on boms (organization_id, status);

create table bom_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  bom_id uuid not null references boms(id) on delete cascade,
  line_no int not null check (line_no > 0),
  component_item_id uuid not null references items(id),
  quantity_per numeric(14,4) not null check (quantity_per > 0),
  scrap_pct numeric(6,3) not null default 0 check (scrap_pct >= 0 and scrap_pct < 100),
  reference text,
  notes text,
  unique (bom_id, line_no),
  unique (bom_id, component_item_id)
);
create index bom_lines_component_idx on bom_lines (component_item_id);

create table engineering_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  change_number text not null,
  title text not null,
  description text,
  reason text,
  item_id uuid not null references items(id),
  from_revision text,
  to_revision text not null,
  bom_id uuid references boms(id),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'implemented', 'rejected', 'canceled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requested_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  implemented_by uuid references profiles(id),
  implemented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, change_number)
);
create index engineering_changes_org_idx on engineering_changes (organization_id, status);

create table item_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  revision text not null,
  status text not null default 'released' check (status in ('pending', 'released', 'superseded')),
  effective_from date,
  change_id uuid references engineering_changes(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (item_id, revision)
);

create table routing_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  seq int not null check (seq > 0),
  work_center_id uuid not null references work_centers(id),
  description text not null,
  setup_hours numeric(8,2) not null default 0 check (setup_hours >= 0),
  run_hours_per_unit numeric(10,4) not null default 0 check (run_hours_per_unit >= 0),
  unique (item_id, seq)
);

-- ---------------------------------------------------------------------------
-- Inventory: lots, balances, immutable movement ledger, reservations
-- ---------------------------------------------------------------------------
create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  lot_number text not null,
  status text not null default 'available' check (status in ('available', 'hold', 'quarantine')),
  expires_on date,
  manufactured_on date,
  received_on date,
  supplier_id uuid references suppliers(id),
  supplier_lot text,
  origin text not null check (origin in ('purchase', 'production', 'adjustment', 'opening')),
  origin_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, item_id, lot_number)
);
create index inventory_lots_org_idx on inventory_lots (organization_id, status);

create table inventory_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  lot_id uuid references inventory_lots(id),
  -- Negative inventory is never allowed in v1 (no override path).
  qty_on_hand numeric(14,4) not null default 0 check (qty_on_hand >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_balances_location_key unique nulls not distinct (item_id, warehouse_id, bin_id, lot_id)
);
create index inventory_balances_org_item_idx on inventory_balances (organization_id, item_id);
create index inventory_balances_wh_idx on inventory_balances (warehouse_id);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  seq bigint generated always as identity,
  movement_type text not null check (movement_type in (
    'receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment',
    'production_receipt', 'shipment', 'scrap', 'reversal')),
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  lot_id uuid references inventory_lots(id),
  quantity numeric(14,4) not null check (quantity <> 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  extended_cost numeric(18,4) generated always as (quantity * unit_cost) stored,
  reference_type text,
  reference_id uuid,
  reference_number text,
  reason text,
  reversal_of uuid references inventory_movements(id),
  actor_id uuid references profiles(id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index inventory_movements_org_time_idx on inventory_movements (organization_id, occurred_at desc);
create index inventory_movements_item_idx on inventory_movements (organization_id, item_id, occurred_at);
create index inventory_movements_ref_idx on inventory_movements (reference_type, reference_id);
create index inventory_movements_lot_idx on inventory_movements (lot_id);

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  demand_type text not null check (demand_type in ('sales_order_line', 'work_order_material')),
  demand_id uuid not null,
  quantity numeric(14,4) not null check (quantity >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (demand_type, demand_id, warehouse_id)
);
create index inventory_reservations_item_idx on inventory_reservations (organization_id, item_id, status);

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  po_number text not null,
  supplier_id uuid not null references suppliers(id),
  site_id uuid not null references sites(id),
  warehouse_id uuid not null references warehouses(id),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'partially_received', 'received', 'canceled', 'closed')),
  order_date date not null,
  expected_date date not null,
  currency char(3) not null default 'USD',
  notes text,
  source text not null default 'manual' check (source in ('manual', 'mrp')),
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, po_number)
);
create index purchase_orders_org_idx on purchase_orders (organization_id, status, expected_date);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  line_no int not null check (line_no > 0),
  item_id uuid not null references items(id),
  quantity_ordered numeric(14,4) not null check (quantity_ordered > 0),
  quantity_received numeric(14,4) not null default 0,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  expected_date date not null,
  created_at timestamptz not null default now(),
  unique (purchase_order_id, line_no),
  -- Cannot receive more than ordered.
  check (quantity_received >= 0 and quantity_received <= quantity_ordered)
);
create index purchase_order_lines_item_idx on purchase_order_lines (organization_id, item_id);

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  receipt_number text not null,
  purchase_order_id uuid not null references purchase_orders(id),
  purchase_order_line_id uuid not null references purchase_order_lines(id),
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  lot_id uuid references inventory_lots(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  movement_id uuid not null references inventory_movements(id),
  received_by uuid references profiles(id),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index goods_receipts_po_idx on goods_receipts (purchase_order_id);
create index goods_receipts_org_idx on goods_receipts (organization_id, received_at);

create table supplier_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  bill_number text not null,
  supplier_id uuid not null references suppliers(id),
  purchase_order_id uuid references purchase_orders(id),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  bill_date date not null,
  due_date date not null,
  total numeric(14,2) not null check (total >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, bill_number),
  check (amount_paid <= total)
);
create index supplier_bills_org_idx on supplier_bills (organization_id, status);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  so_number text not null,
  customer_id uuid not null references customers(id),
  site_id uuid not null references sites(id),
  warehouse_id uuid not null references warehouses(id),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'partially_shipped', 'shipped', 'closed', 'canceled', 'on_hold')),
  order_date date not null,
  requested_date date,
  promised_date date not null,
  customer_po text,
  currency char(3) not null default 'USD',
  notes text,
  created_by uuid references profiles(id),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, so_number)
);
create index sales_orders_org_idx on sales_orders (organization_id, status, promised_date);
create index sales_orders_customer_idx on sales_orders (customer_id);

create table sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  line_no int not null check (line_no > 0),
  item_id uuid not null references items(id),
  quantity_ordered numeric(14,4) not null check (quantity_ordered > 0),
  quantity_shipped numeric(14,4) not null default 0,
  quantity_invoiced numeric(14,4) not null default 0,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  promised_date date not null,
  created_at timestamptz not null default now(),
  unique (sales_order_id, line_no),
  check (quantity_shipped >= 0 and quantity_shipped <= quantity_ordered),
  check (quantity_invoiced >= 0 and quantity_invoiced <= quantity_shipped)
);
create index sales_order_lines_item_idx on sales_order_lines (organization_id, item_id);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shipment_number text not null,
  sales_order_id uuid not null references sales_orders(id),
  warehouse_id uuid not null references warehouses(id),
  carrier text,
  tracking_number text,
  ship_date date not null,
  shipped_at timestamptz not null,
  shipped_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, shipment_number)
);
create index shipments_org_idx on shipments (organization_id, ship_date);
create index shipments_so_idx on shipments (sales_order_id);

create table shipment_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shipment_id uuid not null references shipments(id),
  sales_order_line_id uuid not null references sales_order_lines(id),
  item_id uuid not null references items(id),
  lot_id uuid references inventory_lots(id),
  bin_id uuid references bins(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  movement_id uuid not null references inventory_movements(id)
);
create index shipment_lines_shipment_idx on shipment_lines (shipment_id);
create index shipment_lines_so_line_idx on shipment_lines (sales_order_line_id);
create index shipment_lines_lot_idx on shipment_lines (lot_id);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_number text not null,
  customer_id uuid not null references customers(id),
  sales_order_id uuid references sales_orders(id),
  shipment_id uuid references shipments(id),
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  invoice_date date not null,
  due_date date not null,
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  issued_at timestamptz,
  paid_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_number),
  check (amount_paid >= 0 and amount_paid <= total)
);
create index invoices_org_idx on invoices (organization_id, status, invoice_date);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  sales_order_line_id uuid references sales_order_lines(id),
  item_id uuid references items(id),
  description text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  amount numeric(14,2) not null
);
create index invoice_lines_invoice_idx on invoice_lines (invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_number text not null,
  direction text not null check (direction in ('received', 'sent')),
  invoice_id uuid references invoices(id),
  supplier_bill_id uuid references supplier_bills(id),
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  method text not null default 'ach',
  reference text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, payment_number),
  check ((invoice_id is not null) <> (supplier_bill_id is not null))
);

-- ---------------------------------------------------------------------------
-- Production
-- ---------------------------------------------------------------------------
create table work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  wo_number text not null,
  item_id uuid not null references items(id),
  bom_id uuid references boms(id),
  bom_revision text,
  -- Frozen copy of the BOM revision used when the order was created/released.
  bom_snapshot jsonb,
  site_id uuid not null references sites(id),
  warehouse_id uuid not null references warehouses(id),
  material_warehouse_id uuid not null references warehouses(id),
  work_center_id uuid references work_centers(id),
  quantity_planned numeric(14,4) not null check (quantity_planned > 0),
  quantity_completed numeric(14,4) not null default 0 check (quantity_completed >= 0),
  quantity_scrapped numeric(14,4) not null default 0 check (quantity_scrapped >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'released', 'in_progress', 'on_hold', 'completed', 'closed', 'canceled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  planned_start date not null,
  due_date date not null,
  actual_start timestamptz,
  actual_end timestamptz,
  hold_reason text,
  sales_order_line_id uuid references sales_order_lines(id),
  source text not null default 'manual' check (source in ('manual', 'mrp')),
  estimated_unit_cost numeric(14,4) not null default 0,
  notes text,
  created_by uuid references profiles(id),
  released_by uuid references profiles(id),
  released_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, wo_number),
  check (due_date >= planned_start)
);
create index work_orders_org_idx on work_orders (organization_id, status, due_date);
create index work_orders_item_idx on work_orders (organization_id, item_id);

create table work_order_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  line_no int not null check (line_no > 0),
  component_item_id uuid not null references items(id),
  quantity_per numeric(14,4) not null check (quantity_per > 0),
  scrap_pct numeric(6,3) not null default 0,
  quantity_required numeric(14,4) not null check (quantity_required > 0),
  quantity_issued numeric(14,4) not null default 0 check (quantity_issued >= 0),
  unit_cost numeric(14,4) not null default 0,
  unique (work_order_id, line_no)
);
create index work_order_materials_item_idx on work_order_materials (organization_id, component_item_id);

create table work_order_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  seq int not null check (seq > 0),
  work_center_id uuid not null references work_centers(id),
  description text not null,
  planned_hours numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  completed_at timestamptz,
  unique (work_order_id, seq)
);
create index work_order_operations_wc_idx on work_order_operations (work_center_id, status);

create table material_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id),
  work_order_material_id uuid not null references work_order_materials(id),
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  lot_id uuid references inventory_lots(id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null,
  movement_id uuid not null references inventory_movements(id),
  issued_by uuid references profiles(id),
  issued_at timestamptz not null
);
create index material_issues_wo_idx on material_issues (work_order_id);
create index material_issues_lot_idx on material_issues (lot_id);

create table production_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id),
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  lot_id uuid references inventory_lots(id),
  quantity_good numeric(14,4) not null check (quantity_good >= 0),
  quantity_scrap numeric(14,4) not null default 0 check (quantity_scrap >= 0),
  unit_cost numeric(14,4) not null,
  movement_id uuid references inventory_movements(id),
  notes text,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null,
  check (quantity_good + quantity_scrap > 0)
);
create index production_receipts_wo_idx on production_receipts (work_order_id);
create index production_receipts_org_idx on production_receipts (organization_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Quality
-- ---------------------------------------------------------------------------
create table quality_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_number text not null,
  event_type text not null check (event_type in ('ncr', 'complaint', 'deviation', 'audit_finding')),
  title text not null,
  description text,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'pending_disposition', 'closed', 'canceled')),
  disposition text check (disposition in ('use_as_is', 'rework', 'scrap', 'return_to_supplier')),
  source text not null default 'internal' check (source in ('incoming', 'in_process', 'final', 'customer', 'internal')),
  site_id uuid references sites(id),
  item_id uuid references items(id),
  lot_id uuid references inventory_lots(id),
  work_order_id uuid references work_orders(id),
  purchase_order_id uuid references purchase_orders(id),
  sales_order_id uuid references sales_orders(id),
  supplier_id uuid references suppliers(id),
  customer_id uuid references customers(id),
  quantity_affected numeric(14,4),
  owner_id uuid references profiles(id),
  due_date date,
  root_cause text,
  opened_by uuid references profiles(id),
  opened_at timestamptz not null,
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  closure_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, event_number)
);
create index quality_events_org_idx on quality_events (organization_id, status, severity);
create index quality_events_lot_idx on quality_events (lot_id);

create table inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  inspection_number text not null,
  inspection_type text not null check (inspection_type in ('incoming', 'in_process', 'final')),
  item_id uuid not null references items(id),
  lot_id uuid references inventory_lots(id),
  purchase_order_id uuid references purchase_orders(id),
  work_order_id uuid references work_orders(id),
  quantity_inspected numeric(14,4) not null check (quantity_inspected > 0),
  quantity_rejected numeric(14,4) not null default 0 check (quantity_rejected >= 0),
  result text not null check (result in ('pending', 'pass', 'fail')),
  inspector_id uuid references profiles(id),
  inspected_at timestamptz not null,
  notes text,
  quality_event_id uuid references quality_events(id),
  created_at timestamptz not null default now(),
  unique (organization_id, inspection_number),
  check (quantity_rejected <= quantity_inspected)
);
create index inspections_org_idx on inspections (organization_id, inspected_at);

create table quality_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lot_id uuid not null references inventory_lots(id),
  item_id uuid not null references items(id),
  quality_event_id uuid references quality_events(id),
  status text not null default 'active' check (status in ('active', 'released')),
  reason text not null check (length(trim(reason)) > 0),
  previous_lot_status text not null,
  placed_by uuid references profiles(id),
  placed_at timestamptz not null,
  released_by uuid references profiles(id),
  released_at timestamptz,
  release_reason text,
  check (status = 'active' or (released_at is not null and length(trim(coalesce(release_reason, ''))) > 0))
);
create unique index quality_holds_one_active_idx on quality_holds (lot_id) where status = 'active';
create index quality_holds_org_idx on quality_holds (organization_id, status);

create table capa_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  capa_number text not null,
  quality_event_id uuid references quality_events(id),
  action_type text not null check (action_type in ('corrective', 'preventive')),
  description text not null,
  owner_id uuid references profiles(id),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'verified', 'closed')),
  completed_at timestamptz,
  verification_notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, capa_number)
);
create index capa_actions_org_idx on capa_actions (organization_id, status, due_date);

-- ---------------------------------------------------------------------------
-- Planning (MRP)
-- ---------------------------------------------------------------------------
create table mrp_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_number text not null,
  status text not null check (status in ('completed', 'failed')),
  horizon_days int not null check (horizon_days > 0),
  site_id uuid references sites(id),
  parameters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_by uuid references profiles(id),
  unique (organization_id, run_number)
);

create table mrp_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  mrp_run_id uuid not null references mrp_runs(id) on delete cascade,
  suggestion_type text not null check (suggestion_type in ('purchase', 'manufacture')),
  item_id uuid not null references items(id),
  supplier_id uuid references suppliers(id),
  quantity numeric(14,4) not null check (quantity > 0),
  need_date date not null,
  release_date date not null,
  is_late boolean not null default false,
  explanation text not null,
  pegging jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  created_document_type text,
  created_document_id uuid,
  created_document_number text,
  created_at timestamptz not null default now()
);
create index mrp_suggestions_run_idx on mrp_suggestions (mrp_run_id, status);

-- ---------------------------------------------------------------------------
-- Finance foundation
-- ---------------------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  is_active boolean not null default true,
  unique (organization_id, code)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entry_number text not null,
  entry_date date not null,
  description text not null,
  source_type text not null,
  source_id uuid,
  created_by uuid references profiles(id),
  posted_at timestamptz not null,
  unique (organization_id, entry_number)
);
create index journal_entries_org_idx on journal_entries (organization_id, entry_date);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  journal_entry_id uuid not null references journal_entries(id),
  account_id uuid not null references accounts(id),
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  memo text,
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);
create index journal_lines_entry_idx on journal_lines (journal_entry_id);
create index journal_lines_account_idx on journal_lines (organization_id, account_id);

-- ---------------------------------------------------------------------------
-- Platform: audit trail, idempotency, document numbering
-- ---------------------------------------------------------------------------
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  seq bigint generated always as identity,
  actor_id uuid references profiles(id),
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_number text,
  summary text not null,
  before jsonb,
  after jsonb,
  metadata jsonb,
  site_id uuid references sites(id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index audit_events_org_time_idx on audit_events (organization_id, occurred_at desc, seq desc);
create index audit_events_entity_idx on audit_events (organization_id, entity_type, entity_id);

create table idempotency_keys (
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  operation text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);

create table number_sequences (
  organization_id uuid not null references organizations(id) on delete cascade,
  prefix text not null,
  next_value bigint not null,
  primary key (organization_id, prefix)
);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Append-only ledgers: corrections are new (reversal) rows, never edits.
create or replace function app.prevent_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; post a correcting entry instead', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger inventory_movements_append_only before update or delete on inventory_movements
  for each row execute function app.prevent_ledger_mutation();
create trigger goods_receipts_append_only before update or delete on goods_receipts
  for each row execute function app.prevent_ledger_mutation();
create trigger material_issues_append_only before update or delete on material_issues
  for each row execute function app.prevent_ledger_mutation();
create trigger production_receipts_append_only before update or delete on production_receipts
  for each row execute function app.prevent_ledger_mutation();
create trigger shipment_lines_append_only before update or delete on shipment_lines
  for each row execute function app.prevent_ledger_mutation();
create trigger journal_entries_append_only before update or delete on journal_entries
  for each row execute function app.prevent_ledger_mutation();
create trigger journal_lines_append_only before update or delete on journal_lines
  for each row execute function app.prevent_ledger_mutation();
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function app.prevent_ledger_mutation();

-- Reject circular BOM references (defense in depth; the service layer checks first).
create or replace function app.check_bom_cycle() returns trigger
language plpgsql as $$
declare
  v_assembly uuid;
begin
  select item_id into v_assembly from boms where id = new.bom_id;
  if new.component_item_id = v_assembly then
    raise exception 'Circular BOM reference: an assembly cannot contain itself'
      using errcode = '23514';
  end if;
  if exists (
    with recursive tree(item_id, depth) as (
      select new.component_item_id, 1
      union
      select bl.component_item_id, t.depth + 1
      from tree t
      join boms b on b.item_id = t.item_id and b.status <> 'obsolete'
      join bom_lines bl on bl.bom_id = b.id
      where t.depth < 40
    )
    select 1 from tree where item_id = v_assembly
  ) then
    raise exception 'Circular BOM reference detected for component %', new.component_item_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bom_lines_no_cycles before insert or update of component_item_id on bom_lines
  for each row execute function app.check_bom_cycle();

-- Journal entries must balance (checked at commit so lines can be inserted one by one).
create or replace function app.check_journal_balanced() returns trigger
language plpgsql as $$
declare
  v_debit numeric;
  v_credit numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit
  from journal_lines where journal_entry_id = new.journal_entry_id;
  if v_debit <> v_credit then
    raise exception 'Journal entry % is not balanced (debits %, credits %)',
      new.journal_entry_id, v_debit, v_credit using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred
  for each row execute function app.check_journal_balanced();
