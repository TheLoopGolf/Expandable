/** A small second tenant used to demonstrate (and test) organization isolation. */
import type { Database } from "../db";
import { addDays, type IsoDate } from "@/lib/dates";
import { ensureChartOfAccounts } from "../services/journal";
import { createBomTx, releaseBomTx } from "../services/engineering";
import { receiveStock } from "../services/inventory";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "../services/purchasing";
import { createSalesOrder, shipSalesOrder } from "../services/sales";
import { createWorkOrder, issueMaterials, materialReadiness, recordProduction } from "../services/production";
import { COBALT } from "./data";
import { idemKey, SeedClock, seedContext, startOfDayInstant } from "./util";

export async function seedCobalt(db: Database, clock: SeedClock, today: IsoDate, averyId: string) {
  const [org] = await db.query<{ id: string }>(
    `insert into organizations (name, slug, timezone, is_demo) values ($1,$2,$3,true) returning id`,
    [COBALT.name, COBALT.slug, COBALT.timezone],
  );
  await db.transaction((tx) => ensureChartOfAccounts(tx, org.id));
  const [site] = await db.query<{ id: string }>(
    `insert into sites (organization_id, code, name, timezone, address) values ($1,'DEN','Denver Fabrication Shop',$2,'77 Mesa Industrial Pkwy, Denver, CO') returning id`,
    [org.id, COBALT.timezone],
  );
  const [wh] = await db.query<{ id: string }>(
    `insert into warehouses (organization_id, site_id, code, name, kind) values ($1,$2,'DEN-MAIN','Denver Main Stores','general') returning id`,
    [org.id, site.id],
  );
  const [drew] = await db.query<{ id: string }>(
    `insert into profiles (email, full_name, title) values ('drew.kim@cobaltridge.example','Drew Kim','Plant Manager')
     on conflict (email) do update set full_name = excluded.full_name returning id`,
  );
  await db.query(`insert into memberships (organization_id, profile_id, role_key, default_site_id) values ($1,$2,'admin',$3)`, [org.id, drew.id, site.id]);
  await db.query(`insert into memberships (organization_id, profile_id, role_key, default_site_id) values ($1,$2,'manager',$3)`, [org.id, averyId, site.id]);
  const [wc] = await db.query<{ id: string }>(
    `insert into work_centers (organization_id, site_id, code, name, kind, hourly_rate) values ($1,$2,'WELD-1','Robotic Weld Cell','welding',72) returning id`,
    [org.id, site.id],
  );
  const [sup] = await db.query<{ id: string }>(
    `insert into suppliers (organization_id, code, name, payment_terms_days, default_lead_time_days, rating) values ($1,'FRS','Front Range Steel',30,10,4.2) returning id`,
    [org.id],
  );
  const [cust] = await db.query<{ id: string }>(
    `insert into customers (organization_id, code, name, segment, payment_terms_days) values ($1,'SPE','Summit Peak Equipment','OEM',30) returning id`,
    [org.id],
  );
  const item = async (sku: string, name: string, type: string, cost: string, price: string | null) => {
    const [row] = await db.query<{ id: string }>(
      `insert into items (organization_id, sku, name, item_type, category, uom, standard_cost, list_price, preferred_supplier_id, lead_time_days,
         reorder_point, safety_stock, min_order_qty, default_warehouse_id, product_family)
       values ($1,$2,$3,$4,$5,'ea',$6::numeric,$7::numeric,$8,10,20,10,10,$9,$10) returning id`,
      [org.id, sku, name, type, type === "purchased" ? "Raw Material" : "Finished Good", cost, price, type === "purchased" ? sup.id : null, wh.id, type === "purchased" ? null : "Brackets"],
    );
    return row.id;
  };
  const tube = await item("CR-TUBE-2", "Square steel tube 2 in × 6 ft", "purchased", "18.40", null);
  const plate = await item("CR-PLATE-38", "Steel plate 3/8 in, 12 × 12", "purchased", "11.10", null);
  const coat = await item("CR-POWDER-BLK", "Black powder coat (kg)", "purchased", "9.80", null);
  const frame = await item("CR-FRM-100", "Equipment frame weldment", "manufactured", "96.00", "189.00");
  await db.query(
    `insert into routing_operations (organization_id, item_id, seq, work_center_id, description, setup_hours, run_hours_per_unit) values ($1,$2,10,$3,'Weld & coat',0.5,0.4)`,
    [org.id, frame, wc.id],
  );

  const start = addDays(today, -40);
  clock.set(new Date(startOfDayInstant(start, COBALT.timezone).getTime() + 8 * 3_600_000));
  const orgRef = { id: org.id, name: COBALT.name, timezone: COBALT.timezone };
  const ctx = seedContext(clock, orgRef, { id: drew.id, name: "Drew Kim" });
  await db.transaction(async (tx) => {
    const bom = await createBomTx(tx, ctx, {
      itemId: frame,
      revision: "A",
      notes: "Initial release",
      effectiveFrom: start,
      lines: [
        { componentItemId: tube, quantityPer: "2", scrapPct: "0", reference: undefined },
        { componentItemId: plate, quantityPer: "4", scrapPct: "0", reference: undefined },
        { componentItemId: coat, quantityPer: "0.5", scrapPct: "0", reference: undefined },
      ],
    });
    await releaseBomTx(tx, ctx, bom.id);
  });
  for (const [id, q] of [[tube, "60"], [plate, "100"], [coat, "30"]] as const) {
    await receiveStock(db, ctx, { itemId: id, warehouseId: wh.id, quantity: q, reason: "Opening balance (system cut-over)", opening: true });
  }
  const po = await createPurchaseOrder(db, ctx, {
    supplierId: sup.id,
    warehouseId: wh.id,
    orderDate: start,
    expectedDate: addDays(start, 10),
    lines: [
      { itemId: tube, quantity: "40", unitCost: "18.10" },
      { itemId: plate, quantity: "80", unitCost: "11.25" },
    ],
  });
  await approvePurchaseOrder(db, ctx, po.id);
  clock.set(new Date(startOfDayInstant(addDays(start, 11), COBALT.timezone).getTime() + 9 * 3_600_000));
  const lines = await db.query<{ id: string; quantity_ordered: string }>(`select id, quantity_ordered from purchase_order_lines where purchase_order_id = $1`, [po.id]);
  await receivePurchaseOrder(db, ctx, { purchaseOrderId: po.id, idempotencyKey: idemKey("cr"), lines: lines.map((l) => ({ lineId: l.id, quantity: l.quantity_ordered })) });

  const wo = await createWorkOrder(db, ctx, { itemId: frame, quantity: "20", plannedStart: addDays(start, 12), dueDate: addDays(start, 18), warehouseId: wh.id, materialWarehouseId: wh.id, release: true });
  const ready = await materialReadiness(db, ctx, wo.id);
  await issueMaterials(db, ctx, { workOrderId: wo.id, idempotencyKey: idemKey("cr"), lines: ready.map((r) => ({ materialId: r.materialId, quantity: r.remaining })) });
  clock.set(new Date(startOfDayInstant(addDays(start, 16), COBALT.timezone).getTime() + 9 * 3_600_000));
  await recordProduction(db, ctx, { workOrderId: wo.id, quantityGood: "19", quantityScrap: "1", idempotencyKey: idemKey("cr") });
  const so = await createSalesOrder(db, ctx, {
    customerId: cust.id,
    warehouseId: wh.id,
    orderDate: addDays(start, 15),
    promisedDate: addDays(start, 25),
    confirm: true,
    lines: [{ itemId: frame, quantity: "12" }],
  });
  clock.set(new Date(startOfDayInstant(addDays(start, 24), COBALT.timezone).getTime() + 10 * 3_600_000));
  const [sol] = await db.query<{ id: string }>(`select id from sales_order_lines where sales_order_id = $1`, [so.id]);
  await shipSalesOrder(db, ctx, { salesOrderId: so.id, idempotencyKey: idemKey("cr"), lines: [{ lineId: sol.id, quantity: "12" }], createInvoice: true });
  await createSalesOrder(db, ctx, {
    customerId: cust.id,
    warehouseId: wh.id,
    orderDate: addDays(today, -3),
    promisedDate: addDays(today, 12),
    confirm: true,
    lines: [{ itemId: frame, quantity: "15" }],
  });
  return { orgId: org.id };
}
