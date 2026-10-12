import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { createPgliteDatabase } from "@/server/db/pglite";
import { migrate } from "@/server/db/migrate";
import { snapshotStatements, truncateStatement } from "@/server/seed/snapshot";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "@/server/services/purchasing";
import { createSalesOrder, shipSalesOrder } from "@/server/services/sales";
import { receiveStock } from "@/server/services/inventory";
import { createTestDb, createTestOrg, key } from "../support/fixtures";

let source: Database;
let target: Database;
let t: Awaited<ReturnType<typeof createTestOrg>>;

beforeAll(async () => {
  source = await createTestDb();
  t = await createTestOrg(source, "Snapshot Org");
  const po = await createPurchaseOrder(source, t.users.planner.ctx, {
    supplierId: t.supplier,
    warehouseId: t.stores,
    expectedDate: "2026-03-20",
    lines: [{ itemId: t.items.compA, quantity: "50", unitCost: "2.75" }],
  });
  await approvePurchaseOrder(source, t.users.manager.ctx, po.id);
  const [line] = await source.query<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1`, [po.id]);
  await receivePurchaseOrder(source, t.users.warehouse.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId: line.id, quantity: "50", lotNumber: "SNAP-1" }] });
  await receiveStock(source, t.users.warehouse.ctx, { itemId: t.items.product, warehouseId: t.fgWh, quantity: "8", lotNumber: "FG-SNAP", reason: "Opening count" });
  const so = await createSalesOrder(source, t.users.sales.ctx, { customerId: t.customer, warehouseId: t.fgWh, promisedDate: "2026-03-25", confirm: true, lines: [{ itemId: t.items.product, quantity: "3" }] });
  const [sol] = await source.query<{ id: string }>(`select id from sales_order_lines where sales_order_id = $1`, [so.id]);
  await shipSalesOrder(source, t.users.warehouse.ctx, { salesOrderId: so.id, idempotencyKey: key(), lines: [{ lineId: sol.id, quantity: "3" }] });

  target = await createPgliteDatabase("memory://");
  await migrate(target);
});
afterAll(async () => {
  await source.close();
  await target.close();
});

const counts = async (db: Database) =>
  Object.fromEntries(
    await Promise.all(
      (await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`)).map(async ({ t: name }) => {
        const [r] = await db.query<{ n: number }>(`select count(*) as n from public.${name}`);
        return [name, Number(r.n)] as const;
      }),
    ),
  );

describe("bulk snapshot copy (used to seed remote PostgreSQL)", () => {
  it("reproduces every row in a fresh database, and can replace existing data atomically", async () => {
    const { statements, rows } = await snapshotStatements(source);
    expect(rows).toBeGreaterThan(50);
    await target.transaction(async (tx) => {
      for (const s of statements) await tx.query(s);
    });
    expect(await counts(target)).toEqual(await counts(source));

    // A replace (truncate + copy in one transaction) lands on the same state, roles included.
    const truncate = await truncateStatement(target);
    await target.transaction(async (tx) => {
      await tx.query(truncate);
      for (const s of statements) await tx.query(s);
    });
    expect(await counts(target)).toEqual(await counts(source));
  });

  it("keeps ledgers consistent and lets new transactions continue after the copied identities", async () => {
    const [{ mismatches }] = await target.query<{ mismatches: number }>(
      `select count(*) as mismatches from
         (select item_id, warehouse_id, lot_id, sum(quantity) q from inventory_movements group by 1, 2, 3) m
         full join (select item_id, warehouse_id, lot_id, sum(qty_on_hand) q from inventory_balances group by 1, 2, 3) b
         using (item_id, warehouse_id, lot_id) where coalesce(m.q, 0) <> coalesce(b.q, 0)`,
    );
    expect(Number(mismatches)).toBe(0);
    const before = await target.query<{ max: number }>(`select max(seq) as max from inventory_movements`);
    await receiveStock(target, t.users.warehouse.ctx, { itemId: t.items.compB, warehouseId: t.stores, quantity: "5", reason: "Post-copy receipt" });
    const after = await target.query<{ max: number }>(`select max(seq) as max from inventory_movements`);
    expect(Number(after[0].max)).toBeGreaterThan(Number(before[0].max));
  });
});
