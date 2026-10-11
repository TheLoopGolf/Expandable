import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { roleHas, ROLES, ROLE_KEYS } from "@/lib/permissions";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "@/server/services/purchasing";
import { receiveStock } from "@/server/services/inventory";
import { createBom, updateBomLines } from "@/server/services/engineering";
import { createTestDb, createTestOrg, key } from "../support/fixtures";

let db: Database;
let a: Awaited<ReturnType<typeof createTestOrg>>;
let b: Awaited<ReturnType<typeof createTestOrg>>;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTestOrg(db, "Org A");
  b = await createTestOrg(db, "Org B");
});
afterAll(async () => db.close());

describe("permission map", () => {
  it("defines every role and keeps viewers read-only", () => {
    expect(ROLE_KEYS).toHaveLength(8);
    for (const p of ROLES.viewer.permissions) expect(p.endsWith(".view")).toBe(true);
    expect(roleHas("admin", "admin.manage")).toBe(true);
    expect(roleHas("manager", "admin.manage")).toBe(false);
    expect(roleHas("quality", "quality.hold")).toBe(true);
    expect(roleHas("warehouse", "purchasing.approve")).toBe(false);
  });
});

describe("role enforcement in services", () => {
  it("rejects writes from roles without the capability", async () => {
    await expect(
      receiveStock(db, a.users.viewer.ctx, { itemId: a.items.compB, warehouseId: a.stores, quantity: "1", reason: "nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const po = await createPurchaseOrder(db, a.users.planner.ctx, {
      supplierId: a.supplier,
      warehouseId: a.stores,
      expectedDate: "2026-04-01",
      lines: [{ itemId: a.items.compB, quantity: "5", unitCost: "1" }],
    });
    await expect(approvePurchaseOrder(db, a.users.warehouse.ctx, po.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPurchaseOrder(db, a.users.sales.ctx, {
      supplierId: a.supplier, warehouseId: a.stores, expectedDate: "2026-04-01", lines: [{ itemId: a.items.compB, quantity: "5", unitCost: "1" }],
    })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("organization isolation", () => {
  it("cannot read or act on another organization's records through services", async () => {
    const po = await createPurchaseOrder(db, a.users.planner.ctx, {
      supplierId: a.supplier,
      warehouseId: a.stores,
      expectedDate: "2026-04-01",
      lines: [{ itemId: a.items.compB, quantity: "5", unitCost: "1" }],
    });
    // Org B admin targets Org A's PO id.
    await expect(approvePurchaseOrder(db, b.users.admin.ctx, po.id)).rejects.toBeInstanceOf(NotFoundError);
    // Org B cannot use Org A's item or warehouse ids in its own transactions.
    await expect(
      receiveStock(db, b.users.admin.ctx, { itemId: a.items.compB, warehouseId: b.stores, quantity: "1", reason: "cross-tenant" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveStock(db, b.users.admin.ctx, { itemId: b.items.compB, warehouseId: a.stores, quantity: "1", reason: "cross-tenant" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await approvePurchaseOrder(db, a.users.admin.ctx, po.id);
    const [line] = await db.query<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1`, [po.id]);
    await expect(
      receivePurchaseOrder(db, b.users.admin.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId: line.id, quantity: "1" }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enforces row level security for Supabase client roles", async () => {
    const authA = "11111111-1111-4111-8111-111111111111";
    await db.query(`update profiles set auth_user_id = $1 where id = $2`, [authA, a.users.viewer.id]);
    const rows = await db.transaction(async (tx) => {
      await tx.query(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authA, role: "authenticated" })]);
      const items = await tx.query<{ organization_id: string }>(`select organization_id from items`);
      const orgs = await tx.query<{ id: string }>(`select id from organizations`);
      let writeError: unknown = null;
      try {
        await tx.query(`insert into inventory_movements (organization_id, movement_type, item_id, warehouse_id, quantity, occurred_at) values ($1,'receipt',$2,$3,1,now())`, [a.orgId, a.items.compA, a.stores]);
      } catch (e) {
        writeError = e;
      }
      return { items, orgs, writeError };
    });
    expect(rows.items.length).toBeGreaterThan(0);
    expect(rows.items.every((r) => r.organization_id === a.orgId)).toBe(true);
    expect(rows.orgs.map((o) => o.id)).toEqual([a.orgId]);
    expect(rows.writeError).toBeTruthy();
  });
});

describe("BOM integrity", () => {
  it("rejects circular references in the service and in the database", async () => {
    // product -> compA ; make a sub-assembly that contains product, then try to add it to product
    const [sub] = await db.query<{ id: string }>(
      `insert into items (organization_id, sku, name, item_type, category) values ($1, 'SUB-X', 'Sub X', 'manufactured', 'Test') returning id`,
      [a.orgId],
    );
    const subBom = await createBom(db, a.users.admin.ctx, { itemId: sub.id, revision: "A", lines: [{ componentItemId: a.items.product, quantityPer: "1" }] });
    const [draft] = await db.query<{ id: string }>(
      `insert into boms (organization_id, item_id, revision, status) values ($1, $2, 'B', 'draft') returning id`,
      [a.orgId, a.items.product],
    );
    await expect(
      updateBomLines(db, a.users.admin.ctx, draft.id, [{ componentItemId: sub.id, quantityPer: "1" }]),
    ).rejects.toThrow(/Circular BOM reference: PROD-1 → SUB-X → PROD-1/);
    await expect(
      db.query(`insert into bom_lines (organization_id, bom_id, line_no, component_item_id, quantity_per) values ($1, $2, 1, $3, 1)`, [a.orgId, draft.id, sub.id]),
    ).rejects.toThrow(/Circular BOM reference/);
    await expect(
      updateBomLines(db, a.users.admin.ctx, subBom.id, [{ componentItemId: sub.id, quantityPer: "1" }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
