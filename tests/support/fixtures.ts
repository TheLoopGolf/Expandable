import { createPgliteDatabase } from "@/server/db/pglite";
import { migrate } from "@/server/db/migrate";
import type { Database } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import type { RoleKey } from "@/lib/permissions";
import { upsertRoles } from "@/server/seed/master";
import { ensureChartOfAccounts } from "@/server/services/journal";
import { createBom, releaseBom } from "@/server/services/engineering";

export async function createTestDb(): Promise<Database> {
  const db = await createPgliteDatabase("memory://");
  await migrate(db);
  await upsertRoles(db);
  return db;
}

let n = 0;

/** A minimal tenant: one site, stores + FG warehouses, a supplier, a customer and a 2-component product. */
export async function createTestOrg(db: Database, name = "Test Org", now = () => new Date("2026-03-10T15:00:00Z")) {
  n++;
  const slug = `org-${n}-${Math.random().toString(36).slice(2, 7)}`;
  const [org] = await db.query<{ id: string }>(`insert into organizations (name, slug, timezone) values ($1, $2, 'America/Chicago') returning id`, [name, slug]);
  await db.transaction((tx) => ensureChartOfAccounts(tx, org.id));
  const [site] = await db.query<{ id: string }>(`insert into sites (organization_id, code, name, timezone) values ($1, 'S1', 'Plant 1', 'America/Chicago') returning id`, [org.id]);
  const [stores] = await db.query<{ id: string }>(`insert into warehouses (organization_id, site_id, code, name, kind) values ($1, $2, 'ST', 'Stores', 'stores') returning id`, [org.id, site.id]);
  const [fgWh] = await db.query<{ id: string }>(`insert into warehouses (organization_id, site_id, code, name, kind) values ($1, $2, 'FG', 'Finished Goods', 'finished_goods') returning id`, [org.id, site.id]);
  const [supplier] = await db.query<{ id: string }>(`insert into suppliers (organization_id, code, name) values ($1, 'SUP', 'Test Supplier') returning id`, [org.id]);
  const [customer] = await db.query<{ id: string }>(`insert into customers (organization_id, code, name, payment_terms_days) values ($1, 'CUS', 'Test Customer', 30) returning id`, [org.id]);

  const users = {} as Record<RoleKey, { id: string; ctx: ServiceContext }>;
  for (const role of ["admin", "manager", "planner", "warehouse", "sales", "quality", "finance", "viewer"] as RoleKey[]) {
    const [p] = await db.query<{ id: string }>(`insert into profiles (email, full_name) values ($1, $2) returning id`, [`${role}.${slug}@test.example`, `${role} user`]);
    await db.query(`insert into memberships (organization_id, profile_id, role_key) values ($1, $2, $3)`, [org.id, p.id, role]);
    users[role] = {
      id: p.id,
      ctx: { orgId: org.id, orgName: name, userId: p.id, userName: `${role} user`, role, timezone: "America/Chicago", now },
    };
  }
  const item = async (sku: string, type: "purchased" | "manufactured", cost: string, tracking: "none" | "lot" = "none", price: string | null = null) => {
    const [row] = await db.query<{ id: string }>(
      `insert into items (organization_id, sku, name, item_type, category, standard_cost, list_price, tracking, default_warehouse_id, preferred_supplier_id, lead_time_days, min_order_qty, safety_stock)
       values ($1, $2, $3, $4, 'Test', $5::numeric, $6::numeric, $7, $8, $9, 7, 10, 0) returning id`,
      [org.id, sku, `${sku} item`, type, cost, price, tracking, type === "manufactured" ? fgWh.id : stores.id, type === "purchased" ? supplier.id : null],
    );
    return row.id;
  };
  const compA = await item("COMP-A", "purchased", "2.50", "lot");
  const compB = await item("COMP-B", "purchased", "1.25");
  const product = await item("PROD-1", "manufactured", "10.00", "lot", "25.00");
  const bom = await createBom(db, users.admin.ctx, {
    itemId: product,
    revision: "A",
    lines: [
      { componentItemId: compA, quantityPer: "2" },
      { componentItemId: compB, quantityPer: "1" },
    ],
  });
  await releaseBom(db, users.admin.ctx, bom.id);
  return { orgId: org.id, siteId: site.id, stores: stores.id, fgWh: fgWh.id, supplier: supplier.id, customer: customer.id, users, items: { compA, compB, product }, bomId: bom.id };
}

export async function onHand(db: Database, itemId: string, warehouseId?: string): Promise<number> {
  const [row] = await db.query<{ q: string }>(
    `select coalesce(sum(qty_on_hand), 0) as q from inventory_balances where item_id = $1 and ($2::uuid is null or warehouse_id = $2::uuid)`,
    [itemId, warehouseId ?? null],
  );
  return Number(row.q);
}

export const key = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
