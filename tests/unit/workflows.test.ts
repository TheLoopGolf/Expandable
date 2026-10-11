import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { ForbiddenError, ValidationError, ConflictError } from "@/server/errors";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "@/server/services/purchasing";
import { createWorkOrder, issueMaterials, materialReadiness, recordProduction, releaseWorkOrder, closeWorkOrder } from "@/server/services/production";
import { createCustomer, createInvoice, createSalesOrder, reserveSalesOrder, shipSalesOrder } from "@/server/services/sales";
import { openQualityEvent, releaseLotHold } from "@/server/services/quality";
import { issueStock, receiveStock } from "@/server/services/inventory";
import { createTestDb, createTestOrg, key, onHand } from "../support/fixtures";

let db: Database;
let t: Awaited<ReturnType<typeof createTestOrg>>;

beforeAll(async () => {
  db = await createTestDb();
  t = await createTestOrg(db);
});
afterAll(async () => db.close());

async function poLine(poId: string) {
  const [line] = await db.query<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1`, [poId]);
  return line.id;
}

describe("Workflow 1 — inventory receiving", () => {
  it("receives a partial quantity with a lot, updates stock, status, ledger and audit; rejects over-receipt; is idempotent", async () => {
    const { ctx } = t.users.planner;
    const po = await createPurchaseOrder(db, ctx, {
      supplierId: t.supplier,
      warehouseId: t.stores,
      expectedDate: "2026-03-20",
      lines: [{ itemId: t.items.compA, quantity: "100", unitCost: "2.40" }],
    });
    await approvePurchaseOrder(db, t.users.manager.ctx, po.id);
    const lineId = await poLine(po.id);
    const before = await onHand(db, t.items.compA);

    const k = key();
    const payload = { purchaseOrderId: po.id, idempotencyKey: k, lines: [{ lineId, quantity: "60", lotNumber: "LOT-A-001" }] };
    const first = await receivePurchaseOrder(db, t.users.warehouse.ctx, payload);
    expect(first.status).toBe("partially_received");
    expect(await onHand(db, t.items.compA)).toBe(before + 60);

    // Retrying the same request does not double-receive.
    const replay = await receivePurchaseOrder(db, t.users.warehouse.ctx, payload);
    expect(replay.replayed).toBe(true);
    expect(await onHand(db, t.items.compA)).toBe(before + 60);

    // Cannot receive more than outstanding (40 left).
    await expect(
      receivePurchaseOrder(db, t.users.warehouse.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId, quantity: "41", lotNumber: "LOT-A-002" }] }),
    ).rejects.toThrow(/only 40\.00 outstanding/);

    // Lot-tracked items require a lot number.
    await expect(
      receivePurchaseOrder(db, t.users.warehouse.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId, quantity: "10" }] }),
    ).rejects.toBeInstanceOf(ValidationError);

    const [mv] = await db.query<{ n: number }>(`select count(*) as n from inventory_movements where reference_id = $1 and movement_type = 'receipt'`, [po.id]);
    expect(Number(mv.n)).toBe(1);
    const [audit] = await db.query<{ summary: string; before: { status: string }; after: { status: string } }>(
      `select summary, before, after from audit_events where entity_id = $1 and action = 'purchase_order.received'`,
      [po.id],
    );
    expect(audit.summary).toContain("LOT-A-001");
    expect(audit.before.status).toBe("approved");
    expect(audit.after.status).toBe("partially_received");

    const done = await receivePurchaseOrder(db, t.users.warehouse.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId, quantity: "40", lotNumber: "LOT-A-001" }] });
    expect(done.status).toBe("received");
  });

  it("only allows receiving approved orders", async () => {
    const po = await createPurchaseOrder(db, t.users.planner.ctx, {
      supplierId: t.supplier,
      warehouseId: t.stores,
      expectedDate: "2026-03-20",
      lines: [{ itemId: t.items.compB, quantity: "10", unitCost: "1.20" }],
    });
    await expect(
      receivePurchaseOrder(db, t.users.warehouse.ctx, { purchaseOrderId: po.id, idempotencyKey: key(), lines: [{ lineId: await poLine(po.id), quantity: "5" }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Workflow 2 — BOM to work order", () => {
  it("checks readiness, issues materials, records good and scrap output and updates finished goods", async () => {
    await receiveStock(db, t.users.warehouse.ctx, { itemId: t.items.compB, warehouseId: t.stores, quantity: "50", reason: "test stock" });
    const wo = await createWorkOrder(db, t.users.planner.ctx, {
      itemId: t.items.product,
      quantity: "10",
      plannedStart: "2026-03-10",
      dueDate: "2026-03-12",
      warehouseId: t.fgWh,
      materialWarehouseId: t.stores,
    });
    const readiness = await materialReadiness(db, t.users.planner.ctx, wo.id);
    expect(readiness.map((r) => [r.sku, r.required])).toEqual([
      ["COMP-A", "20.0000"],
      ["COMP-B", "10.0000"],
    ]);

    // Draft orders cannot be issued to.
    await expect(
      issueMaterials(db, t.users.warehouse.ctx, { workOrderId: wo.id, idempotencyKey: key(), lines: [{ materialId: readiness[0].materialId, quantity: "1" }] }),
    ).rejects.toBeInstanceOf(ConflictError);

    const released = await releaseWorkOrder(db, t.users.planner.ctx, wo.id);
    expect(released.fullyAllocated).toBe(2);

    // Recording output before material is issued is rejected.
    await expect(
      recordProduction(db, t.users.planner.ctx, { workOrderId: wo.id, quantityGood: "1", idempotencyKey: key() }),
    ).rejects.toThrow(/Issue material first/);

    const aBefore = await onHand(db, t.items.compA);
    await issueMaterials(db, t.users.warehouse.ctx, {
      workOrderId: wo.id,
      idempotencyKey: key(),
      lines: readiness.map((r) => ({ materialId: r.materialId, quantity: r.required })),
    });
    expect(await onHand(db, t.items.compA)).toBe(aBefore - 20);

    const fgBefore = await onHand(db, t.items.product);
    const res = await recordProduction(db, t.users.planner.ctx, { workOrderId: wo.id, quantityGood: "5", quantityScrap: "1", idempotencyKey: key() });
    expect(res.status).toBe("in_progress");
    expect(res.lotNumber).toMatch(/^FG\d+-01$/);
    expect(await onHand(db, t.items.product)).toBe(fgBefore + 5);

    // Cannot exceed the planned quantity (6 of 10 done).
    await expect(
      recordProduction(db, t.users.planner.ctx, { workOrderId: wo.id, quantityGood: "5", idempotencyKey: key() }),
    ).rejects.toThrow(/only 4\.00 of 10\.00 remain/);

    const [row] = await db.query<{ quantity_completed: string; quantity_scrapped: string; status: string }>(
      `select quantity_completed, quantity_scrapped, status from work_orders where id = $1`,
      [wo.id],
    );
    expect(Number(row.quantity_completed)).toBe(5);
    expect(Number(row.quantity_scrapped)).toBe(1);

    await recordProduction(db, t.users.planner.ctx, { workOrderId: wo.id, quantityGood: "4", idempotencyKey: key() });
    await closeWorkOrder(db, t.users.manager.ctx, wo.id);
    const [closed] = await db.query<{ status: string; bom_revision: string }>(`select status, bom_revision from work_orders where id = $1`, [wo.id]);
    expect(closed.status).toBe("closed");
    expect(closed.bom_revision).toBe("A");
  });

  it("blocks issuing quarantined components", async () => {
    const po = await createPurchaseOrder(db, t.users.planner.ctx, {
      supplierId: t.supplier,
      warehouseId: t.stores,
      expectedDate: "2026-03-20",
      lines: [{ itemId: t.items.compA, quantity: "30", unitCost: "2.50" }],
    });
    await approvePurchaseOrder(db, t.users.manager.ctx, po.id);
    await receivePurchaseOrder(db, t.users.warehouse.ctx, {
      purchaseOrderId: po.id,
      idempotencyKey: key(),
      lines: [{ lineId: await poLine(po.id), quantity: "30", lotNumber: "LOT-Q-1", quarantine: true }],
    });
    const [lot] = await db.query<{ id: string }>(`select id from inventory_lots where lot_number = 'LOT-Q-1'`);
    const wo = await createWorkOrder(db, t.users.planner.ctx, { itemId: t.items.product, quantity: "2", plannedStart: "2026-03-10", dueDate: "2026-03-11", release: true });
    const r = await materialReadiness(db, t.users.planner.ctx, wo.id);
    await expect(
      issueMaterials(db, t.users.warehouse.ctx, { workOrderId: wo.id, idempotencyKey: key(), lines: [{ materialId: r[0].materialId, quantity: "4", lotId: lot.id }] }),
    ).rejects.toThrow(/quarantined/);
  });
});

describe("Workflow 3 — sales order to fulfillment", () => {
  it("reserves, ships partially, updates status and inventory, and invoices the shipped quantity", async () => {
    const cust = await createCustomer(db, t.users.sales.ctx, { code: "ACME", name: "Acme Pumps" });
    await receiveStock(db, t.users.warehouse.ctx, { itemId: t.items.product, warehouseId: t.fgWh, quantity: "8", lotNumber: "FG-TEST-1", reason: "test stock" });
    const so = await createSalesOrder(db, t.users.sales.ctx, {
      customerId: cust.id,
      warehouseId: t.fgWh,
      promisedDate: "2026-03-20",
      confirm: true,
      lines: [{ itemId: t.items.product, quantity: "12" }],
    });
    const reserved = await reserveSalesOrder(db, t.users.sales.ctx, so.id);
    const available = await onHand(db, t.items.product, t.fgWh);
    expect(Number(reserved.lines[0].reserved)).toBe(Math.min(12, available));

    const [line] = await db.query<{ id: string }>(`select id from sales_order_lines where sales_order_id = $1`, [so.id]);
    const before = await onHand(db, t.items.product, t.fgWh);
    await expect(
      shipSalesOrder(db, t.users.warehouse.ctx, { salesOrderId: so.id, idempotencyKey: key(), lines: [{ lineId: line.id, quantity: "13" }] }),
    ).rejects.toThrow(/only 12\.00 open/);

    const shipped = await shipSalesOrder(db, t.users.warehouse.ctx, {
      salesOrderId: so.id,
      idempotencyKey: key(),
      createInvoice: true,
      lines: [{ lineId: line.id, quantity: "5" }],
    });
    expect(shipped.status).toBe("partially_shipped");
    expect(await onHand(db, t.items.product, t.fgWh)).toBe(before - 5);
    const [inv] = await db.query<{ total: string; status: string }>(`select total, status from invoices where id = $1`, [shipped.invoice!.id]);
    expect(inv).toEqual({ total: "125.00", status: "draft" }); // 5 × 25.00
    const [sol] = await db.query<{ quantity_shipped: string; quantity_invoiced: string }>(`select quantity_shipped, quantity_invoiced from sales_order_lines where id = $1`, [line.id]);
    expect(Number(sol.quantity_shipped)).toBe(5);
    expect(Number(sol.quantity_invoiced)).toBe(5);
    await expect(createInvoice(db, t.users.finance.ctx, so.id)).rejects.toThrow(/no shipped quantity left/);
    const [history] = await db.query<{ n: number }>(`select count(*) as n from audit_events where entity_id = $1`, [so.id]);
    expect(Number(history.n)).toBeGreaterThanOrEqual(4); // created, confirmed, reserved, shipped
  });
});

describe("Workflow 4 — quality hold", () => {
  it("blocks issue from a held lot until an authorized release with a documented reason", async () => {
    await receiveStock(db, t.users.warehouse.ctx, { itemId: t.items.compA, warehouseId: t.stores, quantity: "10", lotNumber: "LOT-HOLD-1", reason: "test stock" });
    const [lot] = await db.query<{ id: string }>(`select id from inventory_lots where lot_number = 'LOT-HOLD-1'`);
    const ncr = await openQualityEvent(db, t.users.quality.ctx, {
      title: "Plating thickness out of tolerance",
      severity: "high",
      source: "incoming",
      lotId: lot.id,
      placeHold: true,
      holdReason: "Segregate pending MRB",
    });
    expect(ncr.holdId).toBeTruthy();
    const wo = await createWorkOrder(db, t.users.planner.ctx, { itemId: t.items.product, quantity: "1", plannedStart: "2026-03-10", dueDate: "2026-03-11", release: true });
    const r = await materialReadiness(db, t.users.planner.ctx, wo.id);
    const issueFromLot = () =>
      issueMaterials(db, t.users.warehouse.ctx, { workOrderId: wo.id, idempotencyKey: key(), lines: [{ materialId: r[0].materialId, quantity: "2", lotId: lot.id }] });
    await expect(issueFromLot()).rejects.toThrow(/quality hold/);

    // Only quality-authorized roles can release, and only with a documented reason.
    await expect(releaseLotHold(db, t.users.sales.ctx, { holdId: ncr.holdId!, reason: "Looks fine to me, ship it" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(releaseLotHold(db, t.users.quality.ctx, { holdId: ncr.holdId!, reason: "ok" })).rejects.toThrow();
    await releaseLotHold(db, t.users.quality.ctx, { holdId: ncr.holdId!, reason: "MRB: re-measured 10 pcs, all within tolerance" });

    await issueFromLot();
    const [audit] = await db.query<{ actor_name: string; before: { lotStatus: string }; after: { lotStatus: string } }>(
      `select actor_name, before, after from audit_events where entity_id = $1 and action = 'lot.hold_released'`,
      [lot.id],
    );
    expect(audit).toMatchObject({ actor_name: "quality user", before: { lotStatus: "hold" }, after: { lotStatus: "available" } });
  });
});

describe("inventory rules", () => {
  it("never allows negative inventory", async () => {
    const qty = await onHand(db, t.items.compB, t.stores);
    await expect(
      issueStock(db, t.users.warehouse.ctx, { itemId: t.items.compB, warehouseId: t.stores, quantity: String(qty + 1), reason: "test" }),
    ).rejects.toThrow(/only .* usable on hand/);
    await expect(db.query(`update inventory_balances set qty_on_hand = -1 where item_id = $1`, [t.items.compB])).rejects.toThrow();
  });

  it("keeps the movement ledger append-only and reconciled with balances", async () => {
    await expect(db.query(`update inventory_movements set quantity = 1`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from audit_events`)).rejects.toThrow(/append-only/);
    const [m] = await db.query<{ n: number }>(
      `select count(*) as n from (select item_id, warehouse_id, sum(quantity) q from inventory_movements group by 1, 2) m
       full join (select item_id, warehouse_id, sum(qty_on_hand) q from inventory_balances group by 1, 2) b using (item_id, warehouse_id)
       where coalesce(m.q, 0) <> coalesce(b.q, 0)`,
    );
    expect(Number(m.n)).toBe(0);
  });

  it("posts balanced journals for every transaction", async () => {
    const rows = await db.query<{ unbalanced: number }>(
      `select count(*) as unbalanced from (select journal_entry_id from journal_lines group by 1 having sum(debit) <> sum(credit)) x`,
    );
    expect(Number(rows[0].unbalanced)).toBe(0);
  });
});
