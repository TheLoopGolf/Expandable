import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { updateOrganization } from "@/server/services/admin";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "@/server/services/purchasing";
import { createSalesOrder, shipSalesOrder } from "@/server/services/sales";
import { receiveStock } from "@/server/services/inventory";
import { loadMrpInput } from "@/server/services/planning";
import { createTestDb, createTestOrg, key } from "../support/fixtures";

let db: Database;
let t: Awaited<ReturnType<typeof createTestOrg>>;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTestOrg(db, "Policy Org");
});
afterAll(async () => db.close());

const setFeatures = (features: Record<string, boolean>) =>
  updateOrganization(db, t.users.admin.ctx, { name: "Policy Org", timezone: "America/Chicago", features });

describe("Organization operating policies", () => {
  it("only admins can change settings, and unknown flags are ignored", async () => {
    await expect(updateOrganization(db, t.users.manager.ctx, { name: "X Org", timezone: "America/Chicago", features: {} })).rejects.toBeInstanceOf(ForbiddenError);
    await setFeatures({ notARealFlag: true, allowPartialShipments: true });
    const [org] = await db.query<{ settings: { features: Record<string, boolean> } }>(`select settings from organizations where id = $1`, [t.orgId]);
    expect(org.settings.features).toEqual({ allowPartialShipments: true });
    await expect(setFeatures({})).resolves.toBeTruthy();
    await expect(updateOrganization(db, t.users.admin.ctx, { name: "Policy Org", timezone: "Mars/Olympus", features: {} })).rejects.toThrow(/timezone/i);
  });

  it("requireIncomingInspection forces lot-tracked receipts into quarantine", async () => {
    await setFeatures({ requireIncomingInspection: true });
    const po = await createPurchaseOrder(db, t.users.planner.ctx, {
      supplierId: t.supplier,
      warehouseId: t.stores,
      expectedDate: "2026-03-20",
      lines: [{ itemId: t.items.compA, quantity: "20", unitCost: "2.50" }],
    });
    await approvePurchaseOrder(db, t.users.manager.ctx, po.id);
    const [line] = await db.query<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1`, [po.id]);
    await receivePurchaseOrder(db, t.users.warehouse.ctx, {
      purchaseOrderId: po.id,
      idempotencyKey: key(),
      lines: [{ lineId: line.id, quantity: "20", lotNumber: "INSP-1", quarantine: false }],
    });
    const [lot] = await db.query<{ status: string }>(`select status from inventory_lots where organization_id = $1 and lot_number = 'INSP-1'`, [t.orgId]);
    expect(lot.status).toBe("quarantine");
    await setFeatures({ requireIncomingInspection: false });
  });

  it("allowPartialShipments=false rejects partial line quantities but accepts full ones", async () => {
    await receiveStock(db, t.users.warehouse.ctx, { itemId: t.items.product, warehouseId: t.fgWh, quantity: "10", lotNumber: "FG-POL-1", reason: "Test stock" });
    const so = await createSalesOrder(db, t.users.sales.ctx, {
      customerId: t.customer,
      warehouseId: t.fgWh,
      promisedDate: "2026-03-25",
      confirm: true,
      lines: [{ itemId: t.items.product, quantity: "6" }],
    });
    const [line] = await db.query<{ id: string }>(`select id from sales_order_lines where sales_order_id = $1`, [so.id]);
    await setFeatures({ allowPartialShipments: false });
    await expect(
      shipSalesOrder(db, t.users.warehouse.ctx, { salesOrderId: so.id, idempotencyKey: key(), lines: [{ lineId: line.id, quantity: "4" }] }),
    ).rejects.toThrow(/partial shipments are disabled/);
    const shipped = await shipSalesOrder(db, t.users.warehouse.ctx, { salesOrderId: so.id, idempotencyKey: key(), lines: [{ lineId: line.id, quantity: "6" }] });
    expect(shipped.status).toBe("shipped");
    expect(shipped.invoice).toBeNull(); // auto-invoice is off by default
    await setFeatures({ allowPartialShipments: true });
  });

  it("mrpIncludeDraftSupply controls whether draft purchase orders count as supply", async () => {
    const draft = await createPurchaseOrder(db, t.users.planner.ctx, {
      supplierId: t.supplier,
      warehouseId: t.stores,
      expectedDate: "2026-03-30",
      lines: [{ itemId: t.items.compB, quantity: "75", unitCost: "1.25" }],
    });
    const hasDraft = async () => (await db.transaction((tx) => loadMrpInput(tx, t.users.planner.ctx))).supplies.some((s) => s.source.id === draft.id);
    await setFeatures({ mrpIncludeDraftSupply: true });
    expect(await hasDraft()).toBe(true);
    await setFeatures({ mrpIncludeDraftSupply: false });
    expect(await hasDraft()).toBe(false);
  });
});
