/**
 * "Today" scenarios layered on top of the simulated history so reviewers can walk the
 * four core workflows immediately (see README → Demo walkthrough).
 */
import type { Database } from "../db";
import { addDays, type IsoDate } from "@/lib/dates";
import { approvePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "../services/purchasing";
import { createWorkOrder, holdWorkOrder } from "../services/production";
import { createSalesOrder, reserveSalesOrder, shipSalesOrder } from "../services/sales";
import { createCapa, openQualityEvent } from "../services/quality";
import { receiveStock } from "../services/inventory";
import { availability } from "../services/inventory-core";
import { toStr } from "@/lib/decimal";
import { runMrpPlanning } from "../services/planning";
import { createEngineeringChange, advanceEngineeringChange } from "../services/engineering";
import type { World } from "./master";
import { idemKey, yymmdd, type Rng } from "./util";

export async function todayScenarios(db: Database, world: World, rng: Rng, today: IsoDate, log: (m: string) => void) {
  const { items, warehouses, suppliers, customers, ctx } = world;

  // Workflow 1 — an approved PO for 100 units of a lot-tracked component, ready to receive.
  const po = await createPurchaseOrder(db, ctx.riley, {
    supplierId: suppliers.GPS,
    warehouseId: warehouses["MPL-STORES"].id,
    orderDate: addDays(today, -12),
    expectedDate: addDays(today, 3),
    notes: "Demo workflow 1: receive 60 with a lot number, then the remaining 40",
    lines: [{ itemId: items["RTD-PT100"].id, quantity: "100", unitCost: "6.2000" }],
  });
  await approvePurchaseOrder(db, ctx.jordan, po.id);
  log(`  workflow 1 PO: ${po.number}`);

  // A second PO received into quarantine today (pending incoming inspection).
  const qpo = await createPurchaseOrder(db, ctx.riley, {
    supplierId: suppliers.JDT,
    warehouseId: warehouses["RST-MAIN"].id,
    orderDate: addDays(today, -30),
    expectedDate: addDays(today, -1),
    lines: [{ itemId: items["LCD-43"].id, quantity: "60", unitCost: "21.9000" }],
  });
  await approvePurchaseOrder(db, ctx.jordan, qpo.id);
  const [qline] = await db.query<{ id: string }>(`select id from purchase_order_lines where purchase_order_id = $1`, [qpo.id]);
  await receivePurchaseOrder(db, ctx.sam, {
    purchaseOrderId: qpo.id,
    idempotencyKey: idemKey("gr"),
    lines: [{ lineId: qline.id, quantity: "40", lotNumber: `JDT-${yymmdd(today)}-Q1`, quarantine: true }],
  });

  // Workflow 2 — kit with a two-component BOM: components on hand, a released WO for 10 with
  // materials allocated, ready for issue and output recording. History depends on the time of
  // day the seed runs, so top up whatever the simulation left short.
  const stores = warehouses["MPL-STORES"].id;
  const freeQty = async (itemId: string) =>
    Math.max(0, Math.floor(Number(toStr((await db.transaction((tx) => availability(tx, ctx.riley, itemId, stores))).available))));
  await receiveStock(db, ctx.sam, {
    itemId: items["CASE-CAL"].id,
    warehouseId: stores,
    quantity: "30",
    reason: "Cycle-count found pallet in overflow location",
  });
  const probesForKit = await freeQty(items["PROBE-REF"].id);
  if (probesForKit < 10) {
    await receiveStock(db, ctx.sam, {
      itemId: items["PROBE-REF"].id,
      warehouseId: stores,
      quantity: String(12 - probesForKit),
      lotNumber: `GPS-${yymmdd(addDays(today, -20))}-71`,
      reason: "Probes returned from the calibration lab after re-certification",
    });
  }
  const kitWo = await createWorkOrder(db, ctx.riley, {
    itemId: items["FG-CALKIT"].id,
    quantity: "10",
    plannedStart: today,
    dueDate: addDays(today, 3),
    warehouseId: warehouses["MPL-FG"].id,
    materialWarehouseId: warehouses["MPL-STORES"].id,
    release: true,
    notes: "Demo workflow 2: issue the allocated materials, then record 5 good + 1 scrap",
  });
  log(`  workflow 2 WO: ${kitWo.number}`);

  // Workflow 3 — sales order with stock available for a partial shipment.
  await receiveStock(db, ctx.sam, {
    itemId: items["FG-ECM100"].id,
    warehouseId: warehouses["MPL-FG"].id,
    quantity: "36",
    lotNumber: `FG-RTN-${yymmdd(today)}`,
    reason: "Customer-return units re-certified by quality (RMA-0042)",
  });
  const lakeshore = customers.find((c) => c.code === "LMD")!;
  const so = await createSalesOrder(db, ctx.taylor, {
    customerId: lakeshore.id,
    warehouseId: warehouses["MPL-FG"].id,
    orderDate: addDays(today, -2),
    promisedDate: addDays(today, 4),
    customerPo: "LMD-PO-88412",
    notes: "Demo workflow 3: reserve, ship a partial quantity, invoice the delivered quantity",
    confirm: true,
    lines: [
      { itemId: items["FG-ECM100"].id, quantity: "24" },
      { itemId: items["FG-SNS420"].id, quantity: "10" },
    ],
  });
  await reserveSalesOrder(db, ctx.taylor, so.id);
  log(`  workflow 3 SO: ${so.number}`);

  // Workflow 4 — NCR + quality hold on a reference-probe lot that blocks kit production.
  await receiveStock(db, ctx.sam, {
    itemId: items["PROBE-REF"].id,
    warehouseId: warehouses["MPL-STORES"].id,
    quantity: "40",
    lotNumber: `GPS-${yymmdd(addDays(today, -6))}-77`,
    reason: "Late-booked receipt from consignment stock",
  });
  const [probeLot] = await db.query<{ id: string; lot_number: string }>(
    `select id, lot_number from inventory_lots where organization_id = $1 and item_id = $2 and lot_number = $3`,
    [world.org.id, items["PROBE-REF"].id, `GPS-${yymmdd(addDays(today, -6))}-77`],
  );
  const ncr = await openQualityEvent(db, ctx.casey, {
    eventType: "ncr",
    title: "Reference probe calibration drift beyond ±0.1 °C",
    description: "Two of five sampled probes read 0.14 °C high at the 100 °C point. Lot segregated pending supplier data.",
    severity: "high",
    source: "incoming",
    lotId: probeLot.id,
    supplierId: suppliers.GPS,
    dueDate: addDays(today, 7),
    placeHold: true,
    holdReason: "Calibration drift found at incoming inspection — do not issue to production",
  });
  await createCapa(db, ctx.casey, {
    qualityEventId: ncr.id,
    actionType: "corrective",
    description: "Request supplier calibration data and add 100% verification for next three lots",
    dueDate: addDays(today, 10),
  });
  // Size the kit order so usable (non-held) probes cannot cover it: it reads "blocked" until
  // quality releases the held lot. Sized from live availability so the scenario holds on any seed date.
  const probeFree = await freeQty(items["PROBE-REF"].id);
  const kitQty = probeFree + 6; // the held lot (40) covers the gap once released
  const caseFree = await freeQty(items["CASE-CAL"].id);
  if (caseFree < kitQty) {
    await receiveStock(db, ctx.sam, { itemId: items["CASE-CAL"].id, warehouseId: stores, quantity: String(kitQty - caseFree + 4), reason: "Carry cases returned from field-service loaner pool" });
  }
  const blockedWo = await createWorkOrder(db, ctx.riley, {
    itemId: items["FG-CALKIT"].id,
    quantity: String(kitQty),
    plannedStart: addDays(today, 1),
    dueDate: addDays(today, 4),
    warehouseId: warehouses["MPL-FG"].id,
    materialWarehouseId: stores,
    priority: "high",
    release: true,
    notes: "Demo workflow 4: short until the PROBE-REF lot on quality hold is released",
  });
  log(`  workflow 4 WO: ${blockedWo.number} (${kitQty} kits, ${probeFree} usable probes)`);
  log(`  workflow 4 NCR: ${ncr.number} (lot ${probeLot.lot_number})`);

  // Overdue CAPA and an open critical event for the quality dashboard.
  const crit = await openQualityEvent(db, ctx.casey, {
    eventType: "complaint",
    title: "Field failure: PMC-500 relay welded closed",
    description: "Customer reports a pump that would not stop; relay contacts welded. Unit returned for analysis.",
    severity: "critical",
    source: "customer",
    itemId: items["FG-PMC500"].id,
    customerId: customers.find((c) => c.code === "HIP")!.id,
    dueDate: addDays(today, -2),
  });
  await createCapa(db, ctx.casey, {
    qualityEventId: crit.id,
    actionType: "corrective",
    description: "Derate relay contact rating and add inrush limiting; verify on 3 builds",
    dueDate: addDays(today, -3),
  });

  // A work order put on hold with a documented blocker.
  const [inProgress] = await db.query<{ id: string }>(
    `select id from work_orders where organization_id = $1 and status in ('in_progress','released') and site_id = $2 order by due_date limit 1`,
    [world.org.id, world.sites.RST],
  );
  if (inProgress) await holdWorkOrder(db, ctx.jordan, inProgress.id, "Torque fixture on ASM-R out of calibration; awaiting metrology");

  // Draft sales orders awaiting confirmation.
  for (const code of ["MBA", "EPC"]) {
    const c = customers.find((x) => x.code === code)!;
    await createSalesOrder(db, ctx.taylor, {
      customerId: c.id,
      warehouseId: warehouses[code === "EPC" ? "RST-MAIN" : "MPL-FG"].id,
      promisedDate: addDays(today, rng.int(14, 24)),
      customerPo: `${code}-Q${rng.int(1000, 9999)}`,
      lines: code === "EPC" ? [{ itemId: items["FG-PMC750"].id, quantity: "4" }] : [{ itemId: items["FG-ECM200"].id, quantity: "18" }, { itemId: items["FG-SNS310"].id, quantity: "12" }],
    });
  }

  // Engineering change in review for the dual-channel module.
  const eco = await createEngineeringChange(db, ctx.jordan, {
    itemId: items["SA-PCB200"].id,
    title: "Replace gate driver with automotive-grade equivalent",
    reason: "Supplier end-of-life notice for current driver package",
    description: "Swap IC-DRV-H for qualified alternate; no footprint change.",
    toRevision: "B",
    priority: "high",
  });
  await advanceEngineeringChange(db, ctx.jordan, eco.id, "submit");

  // Partial shipments today on a few open orders (backlog shows partially shipped work).
  const openLines = await db.query<{ so_id: string; line_id: string; open: string; usable: string }>(
    `select so.id as so_id, l.id as line_id, l.quantity_ordered - l.quantity_shipped as open,
            coalesce((select sum(b.qty_on_hand) from inventory_balances b left join inventory_lots lt on lt.id = b.lot_id
                      where b.item_id = l.item_id and b.warehouse_id = so.warehouse_id and (lt.id is null or lt.status = 'available')), 0) as usable
     from sales_orders so join sales_order_lines l on l.sales_order_id = so.id
     where so.organization_id = $1 and so.status = 'confirmed' and so.id <> $2 and l.quantity_ordered - l.quantity_shipped >= 4
     order by so.promised_date, so.so_number limit 6`,
    [world.org.id, so.id],
  );
  let partials = 0;
  for (const l of openLines) {
    if (partials >= 3) break;
    const qty = Math.floor(Math.min(Number(l.open) / 2, Number(l.usable)));
    if (qty < 1) continue;
    try {
      await shipSalesOrder(db, ctx.sam, {
        salesOrderId: l.so_id,
        idempotencyKey: idemKey("sh"),
        carrier: "Lakes Parcel",
        lines: [{ lineId: l.line_id, quantity: String(qty) }],
      });
      partials++;
    } catch {
      /* stock committed elsewhere */
    }
  }

  // A large forward order for pump controllers drives multi-level MRP suggestions.
  await createSalesOrder(db, ctx.taylor, {
    customerId: customers.find((c) => c.code === "HIP")!.id,
    warehouseId: warehouses["RST-MAIN"].id,
    orderDate: addDays(today, -1),
    promisedDate: addDays(today, 38),
    customerPo: "HIP-BLANKET-2291",
    notes: "Blanket release for municipal pump-station retrofit program",
    confirm: true,
    lines: [
      { itemId: items["FG-PMC750"].id, quantity: "24" },
      { itemId: items["FG-PMC500"].id, quantity: "30", promisedDate: addDays(today, 45) },
    ],
  });

  // Firm production plan for the next two weeks (released near-term, draft further out).
  const firmPlan: [string, number, number][] = [
    ["FG-ECM100", 40, 4],
    ["FG-SNS420", 30, 5],
    ["FG-ECM200", 25, 8],
    ["FG-PMC500", 10, 9],
    ["FG-SNS310", 30, 11],
  ];
  for (const [sku, qty, offset] of firmPlan) {
    const item = items[sku];
    const start = addDays(today, offset);
    const site = item.wh === "RST-MAIN" ? "RST" : "MPL";
    await createWorkOrder(db, ctx.riley, {
      itemId: item.id,
      quantity: String(qty),
      plannedStart: start,
      dueDate: addDays(start, Math.max(2, item.lead)),
      warehouseId: warehouses[item.wh].id,
      materialWarehouseId: world.materialWarehouse[site],
      priority: "normal",
      release: offset <= 5,
      notes: "Weekly production plan",
    });
  }

  // MRP run so the planning workbench has live suggestions.
  const run = await runMrpPlanning(db, ctx.riley, { horizonDays: 60 });
  log(`  MRP ${run.number}: ${run.summary.suggestions} suggestions`);
}
