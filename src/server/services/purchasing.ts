import { z } from "zod";
import type { Database, Sql } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays } from "@/lib/dates";
import { add, cmp, dec, mul, neg, sub, toStr } from "@/lib/decimal";
import { recordAudit } from "./audit";
import { withIdempotency } from "./idempotency";
import { postJournal } from "./journal";
import { nextNumber } from "./numbering";
import { assertBin, loadItem, loadWarehouse, postMovement, upsertLot } from "./inventory-core";
import { isoDate, money, optionalText, positiveQty, uuid } from "./schemas";

export const purchaseOrderInput = z.object({
  supplierId: uuid,
  warehouseId: uuid,
  orderDate: isoDate.optional(),
  expectedDate: isoDate,
  notes: optionalText,
  source: z.enum(["manual", "mrp"]).default("manual"),
  submitForApproval: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        itemId: uuid,
        quantity: positiveQty,
        unitCost: money,
        expectedDate: isoDate.optional(),
      }),
    )
    .min(1, "Add at least one line"),
});

export async function createPurchaseOrder(db: Database, ctx: ServiceContext, raw: z.input<typeof purchaseOrderInput>) {
  authorize(ctx, "purchasing.manage");
  const input = purchaseOrderInput.parse(raw);
  return db.transaction((tx) => createPurchaseOrderTx(tx, ctx, input));
}

export async function createPurchaseOrderTx(tx: Sql, ctx: ServiceContext, input: z.output<typeof purchaseOrderInput>) {
  const [supplier] = await tx.query<{ id: string; name: string; is_active: boolean }>(
    `select id, name, is_active from suppliers where id = $1 and organization_id = $2`,
    [input.supplierId, ctx.orgId],
  );
  if (!supplier) throw new NotFoundError("Supplier");
  if (!supplier.is_active) throw new ValidationError(`${supplier.name} is inactive.`);
  const wh = await loadWarehouse(tx, ctx, input.warehouseId);
  const orderDate = input.orderDate ?? today(ctx);
  if (input.expectedDate < orderDate) throw new ValidationError("Expected date cannot be before the order date.", { expectedDate: "Too early" });
  const number = await nextNumber(tx, ctx.orgId, "PO");
  const [po] = await tx.query<{ id: string }>(
    `insert into purchase_orders (organization_id, po_number, supplier_id, site_id, warehouse_id, status, order_date,
       expected_date, notes, source, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$11) returning id`,
    [ctx.orgId, number, supplier.id, wh.site_id, wh.id, orderDate, input.expectedDate, input.notes ?? null, input.source, ctx.userId, ctx.now()],
  );
  let total = 0n;
  let lineNo = 0;
  for (const line of input.lines) {
    const item = await loadItem(tx, ctx, line.itemId);
    if (item.lifecycle_status === "obsolete") throw new ValidationError(`${item.sku} is obsolete and cannot be purchased.`);
    lineNo++;
    await tx.query(
      `insert into purchase_order_lines (organization_id, purchase_order_id, line_no, item_id, quantity_ordered, unit_cost, expected_date)
       values ($1,$2,$3,$4,$5::numeric,$6::numeric,$7)`,
      [ctx.orgId, po.id, lineNo, item.id, line.quantity, line.unitCost, line.expectedDate ?? input.expectedDate],
    );
    total = add(total, mul(dec(line.quantity), dec(line.unitCost)));
  }
  await recordAudit(tx, ctx, {
    action: "purchase_order.created",
    entityType: "purchase_order",
    entityId: po.id,
    entityNumber: number,
    summary: `Created ${number} for ${supplier.name} (${lineNo} line${lineNo === 1 ? "" : "s"}, $${toStr(total, 2)})`,
    after: { status: "draft", total: toStr(total, 2) },
    siteId: wh.site_id,
  });
  return { id: po.id, number };
}

async function loadPo(tx: Sql, ctx: ServiceContext, poId: string) {
  const [po] = await tx.query<{ id: string; po_number: string; status: string; site_id: string; warehouse_id: string; supplier_id: string; supplier_name: string }>(
    `select po.id, po.po_number, po.status, po.site_id, po.warehouse_id, po.supplier_id, s.name as supplier_name
     from purchase_orders po join suppliers s on s.id = po.supplier_id
     where po.id = $1 and po.organization_id = $2 for update of po`,
    [poId, ctx.orgId],
  );
  if (!po) throw new NotFoundError("Purchase order");
  return po;
}

export async function approvePurchaseOrder(db: Database, ctx: ServiceContext, poId: string) {
  authorize(ctx, "purchasing.approve");
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, ctx, poId);
    if (po.status !== "draft") throw new ConflictError(`${po.po_number} is ${po.status}; only draft orders can be approved.`);
    await tx.query(`update purchase_orders set status = 'approved', approved_by = $2, approved_at = $3, updated_at = $3 where id = $1`, [
      po.id,
      ctx.userId,
      ctx.now(),
    ]);
    await recordAudit(tx, ctx, {
      action: "purchase_order.approved",
      entityType: "purchase_order",
      entityId: po.id,
      entityNumber: po.po_number,
      summary: `Approved ${po.po_number} (${po.supplier_name})`,
      before: { status: po.status },
      after: { status: "approved" },
      siteId: po.site_id,
    });
    return { id: po.id, number: po.po_number };
  });
}

export async function cancelPurchaseOrder(db: Database, ctx: ServiceContext, poId: string, reason: string) {
  authorize(ctx, "purchasing.approve");
  if (!reason?.trim()) throw new ValidationError("A cancellation reason is required.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, ctx, poId);
    if (!["draft", "approved"].includes(po.status)) {
      throw new ConflictError(`${po.po_number} is ${po.status.replace("_", " ")}; received orders cannot be canceled.`);
    }
    await tx.query(`update purchase_orders set status = 'canceled', canceled_at = $2, updated_at = $2 where id = $1`, [po.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "purchase_order.canceled",
      entityType: "purchase_order",
      entityId: po.id,
      entityNumber: po.po_number,
      summary: `Canceled ${po.po_number}: ${reason.trim()}`,
      before: { status: po.status },
      after: { status: "canceled" },
      metadata: { reason: reason.trim() },
      siteId: po.site_id,
    });
    return { id: po.id };
  });
}

export const receiveInput = z.object({
  purchaseOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  lines: z
    .array(
      z.object({
        lineId: uuid,
        quantity: positiveQty,
        lotNumber: optionalText,
        expiresOn: isoDate.optional().nullable(),
        binId: uuid.optional().nullable(),
        quarantine: z.boolean().optional(),
      }),
    )
    .min(1, "Enter a quantity for at least one line"),
});

/**
 * Receive against a purchase order. Validates outstanding quantity per line, creates or
 * reuses lots, posts receipt movements at standard cost, books GRNI and purchase price
 * variance, and moves the PO to Partially Received / Received. Idempotent per key.
 */
export async function receivePurchaseOrder(db: Database, ctx: ServiceContext, raw: z.input<typeof receiveInput>) {
  authorize(ctx, "purchasing.receive");
  const input = receiveInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "purchasing.receive", input, async () => {
      const po = await loadPo(tx, ctx, input.purchaseOrderId);
      if (!["approved", "partially_received"].includes(po.status)) {
        throw new ConflictError(`${po.po_number} is ${po.status.replace("_", " ")}; only approved orders can be received.`);
      }
      const wh = await loadWarehouse(tx, ctx, po.warehouse_id);
      const seen = new Set<string>();
      const receipts: { number: string; sku: string; quantity: string; lotNumber: string | null }[] = [];
      let inventoryValue = 0n;
      let poValue = 0n;

      for (const line of input.lines) {
        if (seen.has(line.lineId)) throw new ValidationError("Each PO line can appear only once per receipt.");
        seen.add(line.lineId);
        const [pol] = await tx.query<{ id: string; line_no: number; item_id: string; quantity_ordered: string; quantity_received: string; unit_cost: string }>(
          `select id, line_no, item_id, quantity_ordered, quantity_received, unit_cost
           from purchase_order_lines where id = $1 and purchase_order_id = $2 and organization_id = $3 for update`,
          [line.lineId, po.id, ctx.orgId],
        );
        if (!pol) throw new NotFoundError("Purchase order line");
        const item = await loadItem(tx, ctx, pol.item_id);
        const q = dec(line.quantity);
        const outstanding = sub(dec(pol.quantity_ordered), dec(pol.quantity_received));
        if (cmp(q, outstanding) > 0) {
          throw new ValidationError(
            `Line ${pol.line_no} (${item.sku}): cannot receive ${toStr(q, 2)}; only ${toStr(outstanding, 2)} outstanding.`,
            { [`lines.${pol.line_no}.quantity`]: "Exceeds outstanding quantity" },
          );
        }
        await assertBin(tx, ctx, wh.id, line.binId);
        let lotId: string | null = null;
        let lotNumber: string | null = null;
        if (item.tracking !== "none") {
          if (!line.lotNumber) {
            throw new ValidationError(`Line ${pol.line_no} (${item.sku}) is lot-tracked; enter a lot number.`, {
              [`lines.${pol.line_no}.lotNumber`]: "Required",
            });
          }
          const lot = await upsertLot(tx, ctx, {
            itemId: item.id,
            lotNumber: line.lotNumber,
            origin: "purchase",
            originRef: po.po_number,
            supplierId: po.supplier_id,
            expiresOn: line.expiresOn ?? (item.shelf_life_days ? addDays(today(ctx), item.shelf_life_days) : null),
            status: line.quarantine ? "quarantine" : "available",
          });
          lotId = lot.id;
          lotNumber = lot.lot_number;
        }
        const receiptNumber = await nextNumber(tx, ctx.orgId, "GR");
        const std = dec(item.standard_cost);
        const movementId = await postMovement(tx, ctx, {
          type: "receipt",
          itemId: item.id,
          warehouseId: wh.id,
          binId: line.binId ?? null,
          lotId,
          quantity: q,
          unitCost: std,
          referenceType: "purchase_order",
          referenceId: po.id,
          referenceNumber: po.po_number,
          reason: receiptNumber,
        });
        await tx.query(
          `insert into goods_receipts (organization_id, receipt_number, purchase_order_id, purchase_order_line_id, item_id,
             warehouse_id, bin_id, lot_id, quantity, unit_cost, movement_id, received_by, received_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,$11,$12,$13)`,
          [ctx.orgId, receiptNumber, po.id, pol.id, item.id, wh.id, line.binId ?? null, lotId, toStr(q), pol.unit_cost, movementId, ctx.userId, ctx.now()],
        );
        await tx.query(`update purchase_order_lines set quantity_received = quantity_received + $2::numeric where id = $1`, [pol.id, toStr(q)]);
        inventoryValue = add(inventoryValue, mul(q, std));
        poValue = add(poValue, mul(q, dec(pol.unit_cost)));
        receipts.push({ number: receiptNumber, sku: item.sku, quantity: toStr(q), lotNumber });
      }

      const [totals] = await tx.query<{ open_lines: number }>(
        `select count(*) filter (where quantity_received < quantity_ordered) as open_lines
         from purchase_order_lines where purchase_order_id = $1`,
        [po.id],
      );
      const newStatus = Number(totals.open_lines) === 0 ? "received" : "partially_received";
      await tx.query(`update purchase_orders set status = $2, updated_at = $3 where id = $1`, [po.id, newStatus, ctx.now()]);

      await postJournal(tx, ctx, {
        description: `${po.po_number} goods receipt`,
        sourceType: "goods_receipt",
        sourceId: po.id,
        lines: [
          { account: "1300", amount: inventoryValue, memo: "Inventory at standard" },
          { account: "5100", amount: sub(poValue, inventoryValue), memo: "Purchase price variance" },
          { account: "2100", amount: neg(poValue), memo: "Goods received not invoiced" },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "purchase_order.received",
        entityType: "purchase_order",
        entityId: po.id,
        entityNumber: po.po_number,
        summary: `Received ${receipts.map((r) => `${r.quantity.replace(/\.?0+$/, "")} × ${r.sku}${r.lotNumber ? ` (lot ${r.lotNumber})` : ""}`).join(", ")} on ${po.po_number}`,
        before: { status: po.status },
        after: { status: newStatus },
        metadata: { receipts },
        siteId: po.site_id,
      });
      return { id: po.id, number: po.po_number, status: newStatus, receipts };
    }),
  );
}

/** Close the remaining open quantity of a partially received order (short-close). */
export async function closePurchaseOrder(db: Database, ctx: ServiceContext, poId: string, reason: string) {
  authorize(ctx, "purchasing.approve");
  if (!reason?.trim()) throw new ValidationError("A reason is required to short-close an order.");
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, ctx, poId);
    if (po.status !== "partially_received") throw new ConflictError("Only partially received orders can be short-closed.");
    await tx.query(`update purchase_orders set status = 'closed', updated_at = $2 where id = $1`, [po.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "purchase_order.closed",
      entityType: "purchase_order",
      entityId: po.id,
      entityNumber: po.po_number,
      summary: `Short-closed ${po.po_number}: ${reason.trim()}`,
      before: { status: po.status },
      after: { status: "closed" },
      siteId: po.site_id,
    });
    return { id: po.id };
  });
}

/** Create a supplier bill (AP) for everything received and not yet billed on a PO. */
export async function createSupplierBill(db: Database, ctx: ServiceContext, poId: string, billDate?: string) {
  authorize(ctx, "finance.manage");
  return db.transaction(async (tx) => {
    const po = await loadPo(tx, ctx, poId);
    const [amounts] = await tx.query<{ received: string; billed: string; terms: number }>(
      `select
         coalesce((select sum(gr.quantity * gr.unit_cost) from goods_receipts gr where gr.purchase_order_id = $1), 0) as received,
         coalesce((select sum(total) from supplier_bills b where b.purchase_order_id = $1 and b.status <> 'void'), 0) as billed,
         (select payment_terms_days from suppliers where id = $2) as terms`,
      [po.id, po.supplier_id],
    );
    const amount = sub(dec(amounts.received), dec(amounts.billed));
    if (amount <= 0n) throw new ConflictError(`${po.po_number} has no received value left to bill.`);
    const number = await nextNumber(tx, ctx.orgId, "BILL");
    const date = billDate ?? today(ctx);
    const [bill] = await tx.query<{ id: string }>(
      `insert into supplier_bills (organization_id, bill_number, supplier_id, purchase_order_id, status, bill_date, due_date, total, created_at)
       values ($1,$2,$3,$4,'open',$5,$6,$7::numeric,$8) returning id`,
      [ctx.orgId, number, po.supplier_id, po.id, date, addDays(date, Number(amounts.terms ?? 30)), toStr(amount, 2), ctx.now()],
    );
    await postJournal(tx, ctx, {
      description: `${number} supplier bill for ${po.po_number}`,
      sourceType: "supplier_bill",
      sourceId: bill.id,
      lines: [
        { account: "2100", amount },
        { account: "2000", amount: neg(amount) },
      ],
    });
    await recordAudit(tx, ctx, {
      action: "supplier_bill.created",
      entityType: "supplier_bill",
      entityId: bill.id,
      entityNumber: number,
      summary: `Recorded supplier bill ${number} for ${po.po_number} ($${toStr(amount, 2)})`,
      siteId: po.site_id,
    });
    return { id: bill.id, number };
  });
}

export async function paySupplierBill(db: Database, ctx: ServiceContext, billId: string, paymentDate?: string) {
  authorize(ctx, "finance.manage");
  return db.transaction(async (tx) => {
    const [bill] = await tx.query<{ id: string; bill_number: string; total: string; amount_paid: string; status: string }>(
      `select id, bill_number, total, amount_paid, status from supplier_bills where id = $1 and organization_id = $2 for update`,
      [billId, ctx.orgId],
    );
    if (!bill) throw new NotFoundError("Supplier bill");
    if (bill.status !== "open") throw new ConflictError(`${bill.bill_number} is ${bill.status}.`);
    const amount = sub(dec(bill.total), dec(bill.amount_paid));
    const number = await nextNumber(tx, ctx.orgId, "PAY");
    await tx.query(
      `insert into payments (organization_id, payment_number, direction, supplier_bill_id, amount, payment_date, method, created_by, created_at)
       values ($1,$2,'sent',$3,$4::numeric,$5,'ach',$6,$7)`,
      [ctx.orgId, number, bill.id, toStr(amount, 2), paymentDate ?? today(ctx), ctx.userId, ctx.now()],
    );
    await tx.query(`update supplier_bills set amount_paid = total, status = 'paid' where id = $1`, [bill.id]);
    await postJournal(tx, ctx, {
      description: `${number} payment of ${bill.bill_number}`,
      sourceType: "payment",
      lines: [
        { account: "2000", amount },
        { account: "1000", amount: neg(amount) },
      ],
    });
    await recordAudit(tx, ctx, {
      action: "supplier_bill.paid",
      entityType: "supplier_bill",
      entityId: bill.id,
      entityNumber: bill.bill_number,
      summary: `Paid ${bill.bill_number} ($${toStr(amount, 2)})`,
      before: { status: "open" },
      after: { status: "paid" },
    });
    return { id: bill.id };
  });
}

export const supplierInput = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  contactName: optionalText,
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: optionalText,
  paymentTermsDays: z.coerce.number().int().min(0).max(180).default(30),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(365).default(14),
});

export async function createSupplier(db: Database, ctx: ServiceContext, raw: z.input<typeof supplierInput>) {
  authorize(ctx, "purchasing.manage");
  const input = supplierInput.parse(raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.query(`select 1 from suppliers where organization_id = $1 and lower(code) = lower($2)`, [ctx.orgId, input.code]);
    if (dup) throw new ValidationError(`Supplier code ${input.code} already exists.`, { code: "Already exists" });
    const [row] = await tx.query<{ id: string }>(
      `insert into suppliers (organization_id, code, name, contact_name, email, phone, payment_terms_days, default_lead_time_days, rating)
       values ($1,$2,$3,$4,$5,$6,$7,$8,null) returning id`,
      [ctx.orgId, input.code.toUpperCase(), input.name, input.contactName ?? null, input.email ?? null, input.phone ?? null, input.paymentTermsDays, input.defaultLeadTimeDays],
    );
    await recordAudit(tx, ctx, {
      action: "supplier.created",
      entityType: "supplier",
      entityId: row.id,
      entityNumber: input.code.toUpperCase(),
      summary: `Added supplier ${input.name}`,
    });
    return { id: row.id };
  });
}
