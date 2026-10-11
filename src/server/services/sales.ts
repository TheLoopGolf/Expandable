import { z } from "zod";
import type { Database, Sql } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays } from "@/lib/dates";
import { add, cmp, dec, max, min, mul, neg, sub, toStr, type Dec } from "@/lib/decimal";
import { recordAudit } from "./audit";
import { withIdempotency } from "./idempotency";
import { postJournal } from "./journal";
import { nextNumber } from "./numbering";
import { availability, closeReservations, getReservation, loadItem, loadWarehouse, pickStock, postMovement, setReservation } from "./inventory-core";
import { isoDate, money, optionalText, positiveQty, uuid } from "./schemas";

export const customerInput = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  contactName: optionalText,
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: optionalText,
  segment: optionalText,
  paymentTermsDays: z.coerce.number().int().min(0).max(180).default(30),
  creditLimit: money.optional().nullable(),
  shipTo: optionalText,
});

export async function createCustomer(db: Database, ctx: ServiceContext, raw: z.input<typeof customerInput>) {
  authorize(ctx, "sales.manage");
  const input = customerInput.parse(raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.query(`select 1 from customers where organization_id = $1 and lower(code) = lower($2)`, [ctx.orgId, input.code]);
    if (dup) throw new ValidationError(`Customer code ${input.code} already exists.`, { code: "Already exists" });
    const [row] = await tx.query<{ id: string }>(
      `insert into customers (organization_id, code, name, contact_name, email, phone, segment, payment_terms_days, credit_limit, ship_to, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11) returning id`,
      [ctx.orgId, input.code.toUpperCase(), input.name, input.contactName ?? null, input.email ?? null, input.phone ?? null, input.segment ?? null,
        input.paymentTermsDays, input.creditLimit ?? null, input.shipTo ?? null, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: "customer.created",
      entityType: "customer",
      entityId: row.id,
      entityNumber: input.code.toUpperCase(),
      summary: `Added customer ${input.name}`,
    });
    return { id: row.id };
  });
}

export const salesOrderInput = z.object({
  customerId: uuid,
  warehouseId: uuid,
  orderDate: isoDate.optional(),
  requestedDate: isoDate.optional().nullable(),
  promisedDate: isoDate,
  customerPo: optionalText,
  notes: optionalText,
  confirm: z.boolean().optional(),
  lines: z
    .array(z.object({ itemId: uuid, quantity: positiveQty, unitPrice: money.optional(), promisedDate: isoDate.optional() }))
    .min(1, "Add at least one line"),
});

export async function createSalesOrder(db: Database, ctx: ServiceContext, raw: z.input<typeof salesOrderInput>) {
  authorize(ctx, "sales.manage");
  const input = salesOrderInput.parse(raw);
  return db.transaction(async (tx) => {
    const [customer] = await tx.query<{ id: string; name: string; is_active: boolean }>(
      `select id, name, is_active from customers where id = $1 and organization_id = $2`,
      [input.customerId, ctx.orgId],
    );
    if (!customer) throw new NotFoundError("Customer");
    if (!customer.is_active) throw new ValidationError(`${customer.name} is inactive.`);
    const wh = await loadWarehouse(tx, ctx, input.warehouseId);
    const orderDate = input.orderDate ?? today(ctx);
    if (input.promisedDate < orderDate) throw new ValidationError("Promised date cannot be before the order date.", { promisedDate: "Too early" });
    const number = await nextNumber(tx, ctx.orgId, "SO");
    const [so] = await tx.query<{ id: string }>(
      `insert into sales_orders (organization_id, so_number, customer_id, site_id, warehouse_id, status, order_date, requested_date,
         promised_date, customer_po, notes, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$12) returning id`,
      [ctx.orgId, number, customer.id, wh.site_id, wh.id, orderDate, input.requestedDate ?? null, input.promisedDate, input.customerPo ?? null, input.notes ?? null, ctx.userId, ctx.now()],
    );
    let total = 0n;
    let lineNo = 0;
    for (const line of input.lines) {
      const item = await loadItem(tx, ctx, line.itemId);
      if (item.lifecycle_status === "obsolete" || item.lifecycle_status === "hold") {
        throw new ValidationError(`${item.sku} is ${item.lifecycle_status} and cannot be sold.`);
      }
      const price = line.unitPrice ?? item.list_price;
      if (price == null) throw new ValidationError(`${item.sku} has no list price; enter a unit price.`);
      lineNo++;
      await tx.query(
        `insert into sales_order_lines (organization_id, sales_order_id, line_no, item_id, quantity_ordered, unit_price, promised_date)
         values ($1,$2,$3,$4,$5::numeric,$6::numeric,$7)`,
        [ctx.orgId, so.id, lineNo, item.id, line.quantity, price, line.promisedDate ?? input.promisedDate],
      );
      total = add(total, mul(dec(line.quantity), dec(price)));
    }
    await recordAudit(tx, ctx, {
      action: "sales_order.created",
      entityType: "sales_order",
      entityId: so.id,
      entityNumber: number,
      summary: `Created ${number} for ${customer.name} ($${toStr(total, 2)}, promised ${input.promisedDate})`,
      after: { status: "draft", total: toStr(total, 2) },
      siteId: wh.site_id,
    });
    if (input.confirm) await confirmSalesOrderTx(tx, ctx, so.id);
    return { id: so.id, number };
  });
}

async function loadSo(tx: Sql, ctx: ServiceContext, soId: string) {
  const [so] = await tx.query<{ id: string; so_number: string; status: string; site_id: string; warehouse_id: string; customer_id: string; customer_name: string; payment_terms_days: number }>(
    `select so.id, so.so_number, so.status, so.site_id, so.warehouse_id, so.customer_id, c.name as customer_name, c.payment_terms_days
     from sales_orders so join customers c on c.id = so.customer_id
     where so.id = $1 and so.organization_id = $2 for update of so`,
    [soId, ctx.orgId],
  );
  if (!so) throw new NotFoundError("Sales order");
  return so;
}

export async function confirmSalesOrder(db: Database, ctx: ServiceContext, soId: string) {
  authorize(ctx, "sales.manage");
  return db.transaction((tx) => confirmSalesOrderTx(tx, ctx, soId));
}

async function confirmSalesOrderTx(tx: Sql, ctx: ServiceContext, soId: string) {
  const so = await loadSo(tx, ctx, soId);
  if (so.status !== "draft") throw new ConflictError(`${so.so_number} is already ${so.status.replace("_", " ")}.`);
  await tx.query(`update sales_orders set status = 'confirmed', confirmed_at = $2, updated_at = $2 where id = $1`, [so.id, ctx.now()]);
  await recordAudit(tx, ctx, {
    action: "sales_order.confirmed",
    entityType: "sales_order",
    entityId: so.id,
    entityNumber: so.so_number,
    summary: `Confirmed ${so.so_number} for ${so.customer_name}`,
    before: { status: "draft" },
    after: { status: "confirmed" },
    siteId: so.site_id,
  });
  return { id: so.id, number: so.so_number };
}

interface SoLine {
  id: string;
  line_no: number;
  item_id: string;
  sku: string;
  quantity_ordered: string;
  quantity_shipped: string;
  quantity_invoiced: string;
  unit_price: string;
  standard_cost: string;
}

async function loadSoLines(tx: Sql, soId: string): Promise<SoLine[]> {
  return tx.query<SoLine>(
    `select l.id, l.line_no, l.item_id, i.sku, l.quantity_ordered, l.quantity_shipped, l.quantity_invoiced, l.unit_price, i.standard_cost
     from sales_order_lines l join items i on i.id = l.item_id where l.sales_order_id = $1 order by l.line_no for update of l`,
    [soId],
  );
}

/** Reserve available finished goods for every open line (soft allocation). */
export async function reserveSalesOrder(db: Database, ctx: ServiceContext, soId: string) {
  authorize(ctx, "sales.ship");
  return db.transaction(async (tx) => {
    const so = await loadSo(tx, ctx, soId);
    if (!["confirmed", "partially_shipped"].includes(so.status)) throw new ConflictError(`${so.so_number} is ${so.status.replace("_", " ")}; confirm it before reserving.`);
    const lines = await loadSoLines(tx, so.id);
    const result: { sku: string; open: string; reserved: string }[] = [];
    for (const l of lines) {
      const open = max(sub(dec(l.quantity_ordered), dec(l.quantity_shipped)), 0n);
      const existing = (await getReservation(tx, ctx, "sales_order_line", l.id))?.quantity ?? 0n;
      const avail = await availability(tx, ctx, l.item_id, so.warehouse_id);
      const target = min(open, max(add(avail.available, existing), 0n));
      await setReservation(tx, ctx, { itemId: l.item_id, warehouseId: so.warehouse_id, demandType: "sales_order_line", demandId: l.id, quantity: target });
      result.push({ sku: l.sku, open: toStr(open), reserved: toStr(target) });
    }
    await recordAudit(tx, ctx, {
      action: "sales_order.reserved",
      entityType: "sales_order",
      entityId: so.id,
      entityNumber: so.so_number,
      summary: `Reserved stock for ${so.so_number}: ${result.map((r) => `${r.sku} ${r.reserved.replace(/\.?0+$/, "") || "0"}/${r.open.replace(/\.?0+$/, "") || "0"}`).join(", ")}`,
      metadata: { lines: result },
      siteId: so.site_id,
    });
    return { id: so.id, lines: result };
  });
}

export async function releaseSalesOrderReservations(db: Database, ctx: ServiceContext, soId: string) {
  authorize(ctx, "sales.ship");
  return db.transaction(async (tx) => {
    const so = await loadSo(tx, ctx, soId);
    const lines = await loadSoLines(tx, so.id);
    await closeReservations(tx, ctx, "sales_order_line", lines.map((l) => l.id));
    await recordAudit(tx, ctx, {
      action: "sales_order.reservation_released",
      entityType: "sales_order",
      entityId: so.id,
      entityNumber: so.so_number,
      summary: `Released stock reservations on ${so.so_number}`,
      siteId: so.site_id,
    });
    return { id: so.id };
  });
}

export const shipInput = z.object({
  salesOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  carrier: optionalText,
  trackingNumber: optionalText,
  createInvoice: z.boolean().optional(),
  lines: z.array(z.object({ lineId: uuid, quantity: positiveQty })).min(1, "Enter a quantity for at least one line"),
});

/**
 * Confirm a (partial) shipment: consumes FEFO stock excluding held lots, prefers this
 * order's reservation, updates shipped quantities and order status, books COGS and
 * optionally drafts an invoice for the shipped quantity.
 */
export async function shipSalesOrder(db: Database, ctx: ServiceContext, raw: z.input<typeof shipInput>) {
  authorize(ctx, "sales.ship");
  const input = shipInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "sales.ship", input, async () => {
      const so = await loadSo(tx, ctx, input.salesOrderId);
      if (!["confirmed", "partially_shipped"].includes(so.status)) throw new ConflictError(`${so.so_number} is ${so.status.replace("_", " ")} and cannot be shipped.`);
      const lines = await loadSoLines(tx, so.id);
      const byId = new Map(lines.map((l) => [l.id, l]));
      const number = await nextNumber(tx, ctx.orgId, "SH");
      const [shipment] = await tx.query<{ id: string }>(
        `insert into shipments (organization_id, shipment_number, sales_order_id, warehouse_id, carrier, tracking_number, ship_date, shipped_at, shipped_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [ctx.orgId, number, so.id, so.warehouse_id, input.carrier ?? null, input.trackingNumber ?? null, today(ctx), ctx.now(), ctx.userId],
      );
      let cogs = 0n;
      let value = 0n;
      const shipped: { sku: string; quantity: string; lots: string[] }[] = [];
      const seen = new Set<string>();
      for (const req of input.lines) {
        const l = byId.get(req.lineId);
        if (!l) throw new NotFoundError("Sales order line");
        if (seen.has(l.id)) throw new ValidationError("Each line can appear only once per shipment.");
        seen.add(l.id);
        const q = dec(req.quantity);
        const open = sub(dec(l.quantity_ordered), dec(l.quantity_shipped));
        if (cmp(q, open) > 0) throw new ValidationError(`Line ${l.line_no} (${l.sku}): cannot ship ${toStr(q, 2)}; only ${toStr(open, 2)} open.`);
        const own = (await getReservation(tx, ctx, "sales_order_line", l.id))?.quantity ?? 0n;
        const avail = await availability(tx, ctx, l.item_id, so.warehouse_id);
        const forThis = add(avail.available, own);
        if (cmp(q, forThis) > 0 && cmp(q, avail.usable) <= 0) {
          throw new ValidationError(`${l.sku}: only ${toStr(max(forThis, 0n), 2)} available for this order; the rest is reserved for other demand.`);
        }
        const picks = await pickStock(tx, ctx, { itemId: l.item_id, warehouseId: so.warehouse_id, quantity: q, purpose: `ship ${l.sku} on ${so.so_number}` });
        const cost = dec(l.standard_cost);
        for (const p of picks) {
          const movementId = await postMovement(tx, ctx, {
            type: "shipment", itemId: l.item_id, warehouseId: so.warehouse_id, binId: p.binId, lotId: p.lotId,
            quantity: neg(p.quantity), unitCost: cost, referenceType: "sales_order", referenceId: so.id, referenceNumber: so.so_number, reason: number,
          });
          await tx.query(
            `insert into shipment_lines (organization_id, shipment_id, sales_order_line_id, item_id, lot_id, bin_id, quantity, unit_price, unit_cost, movement_id)
             values ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10)`,
            [ctx.orgId, shipment.id, l.id, l.item_id, p.lotId, p.binId, toStr(p.quantity), l.unit_price, toStr(cost), movementId],
          );
        }
        await tx.query(`update sales_order_lines set quantity_shipped = quantity_shipped + $2::numeric where id = $1`, [l.id, toStr(q)]);
        await setReservation(tx, ctx, { itemId: l.item_id, warehouseId: so.warehouse_id, demandType: "sales_order_line", demandId: l.id, quantity: max(sub(own, q), 0n) });
        cogs = add(cogs, mul(q, cost));
        value = add(value, mul(q, dec(l.unit_price)));
        shipped.push({ sku: l.sku, quantity: toStr(q), lots: picks.map((p) => p.lotNumber).filter((x): x is string => !!x) });
      }
      const [open] = await tx.query<{ open_lines: number }>(
        `select count(*) filter (where quantity_shipped < quantity_ordered) as open_lines from sales_order_lines where sales_order_id = $1`,
        [so.id],
      );
      const newStatus = Number(open.open_lines) === 0 ? "shipped" : "partially_shipped";
      await tx.query(`update sales_orders set status = $2, updated_at = $3 where id = $1`, [so.id, newStatus, ctx.now()]);
      if (newStatus === "shipped") await closeReservations(tx, ctx, "sales_order_line", lines.map((l) => l.id));
      await postJournal(tx, ctx, {
        description: `${number} shipment for ${so.so_number}`,
        sourceType: "shipment",
        sourceId: shipment.id,
        lines: [
          { account: "5000", amount: cogs },
          { account: "1300", amount: neg(cogs) },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "sales_order.shipped",
        entityType: "sales_order",
        entityId: so.id,
        entityNumber: so.so_number,
        summary: `Shipped ${shipped.map((s) => `${s.quantity.replace(/\.?0+$/, "")} × ${s.sku}`).join(", ")} on ${so.so_number} (${number}, $${toStr(value, 2)})`,
        before: { status: so.status },
        after: { status: newStatus },
        metadata: { shipmentNumber: number, shipped },
        siteId: so.site_id,
      });
      let invoice: { id: string; number: string } | null = null;
      if (input.createInvoice) invoice = await createInvoiceTx(tx, ctx, so.id, shipment.id);
      return { id: so.id, number: so.so_number, status: newStatus, shipmentId: shipment.id, shipmentNumber: number, invoice };
    }),
  );
}

/** Draft an invoice for shipped-but-uninvoiced quantities (optionally one shipment only). */
export async function createInvoice(db: Database, ctx: ServiceContext, soId: string, shipmentId?: string) {
  authorize(ctx, "finance.manage");
  return db.transaction((tx) => createInvoiceTx(tx, ctx, soId, shipmentId));
}

async function createInvoiceTx(tx: Sql, ctx: ServiceContext, soId: string, shipmentId?: string) {
  const so = await loadSo(tx, ctx, soId);
  const rows = await tx.query<{ line_id: string; item_id: string; sku: string; name: string; unit_price: string; to_invoice: string }>(
    shipmentId
      ? `select l.id as line_id, l.item_id, i.sku, i.name, l.unit_price,
                least(sum(sl.quantity), l.quantity_shipped - l.quantity_invoiced) as to_invoice
         from shipment_lines sl join sales_order_lines l on l.id = sl.sales_order_line_id join items i on i.id = l.item_id
         where sl.shipment_id = $2 and l.sales_order_id = $1
         group by l.id, l.item_id, i.sku, i.name, l.unit_price, l.quantity_shipped, l.quantity_invoiced, l.line_no order by l.line_no`
      : `select l.id as line_id, l.item_id, i.sku, i.name, l.unit_price, l.quantity_shipped - l.quantity_invoiced as to_invoice
         from sales_order_lines l join items i on i.id = l.item_id where l.sales_order_id = $1 order by l.line_no`,
    shipmentId ? [so.id, shipmentId] : [so.id],
  );
  const billable = rows.filter((r) => dec(r.to_invoice) > 0n);
  if (billable.length === 0) throw new ConflictError(`${so.so_number} has no shipped quantity left to invoice.`);
  const number = await nextNumber(tx, ctx.orgId, "INV");
  const invoiceDate = today(ctx);
  let subtotal = 0n;
  const [inv] = await tx.query<{ id: string }>(
    `insert into invoices (organization_id, invoice_number, customer_id, sales_order_id, shipment_id, status, invoice_date, due_date, created_by, created_at)
     values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9) returning id`,
    [ctx.orgId, number, so.customer_id, so.id, shipmentId ?? null, invoiceDate, addDays(invoiceDate, so.payment_terms_days), ctx.userId, ctx.now()],
  );
  for (const r of billable) {
    const q = dec(r.to_invoice);
    const amount = mul(q, dec(r.unit_price));
    subtotal = add(subtotal, amount);
    await tx.query(
      `insert into invoice_lines (organization_id, invoice_id, sales_order_line_id, item_id, description, quantity, unit_price, amount)
       values ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric)`,
      [ctx.orgId, inv.id, r.line_id, r.item_id, `${r.sku} — ${r.name}`, toStr(q), r.unit_price, toStr(amount, 2)],
    );
    await tx.query(`update sales_order_lines set quantity_invoiced = quantity_invoiced + $2::numeric where id = $1`, [r.line_id, toStr(q)]);
  }
  await tx.query(`update invoices set subtotal = $2::numeric, total = $2::numeric where id = $1`, [inv.id, toStr(subtotal, 2)]);
  await recordAudit(tx, ctx, {
    action: "invoice.created",
    entityType: "invoice",
    entityId: inv.id,
    entityNumber: number,
    summary: `Drafted invoice ${number} for ${so.so_number} ($${toStr(subtotal, 2)})`,
    metadata: { salesOrder: so.so_number },
    siteId: so.site_id,
  });
  return { id: inv.id, number };
}

export async function issueInvoice(db: Database, ctx: ServiceContext, invoiceId: string) {
  authorize(ctx, "finance.manage");
  return db.transaction(async (tx) => {
    const [inv] = await tx.query<{ id: string; invoice_number: string; status: string; total: string }>(
      `select id, invoice_number, status, total from invoices where id = $1 and organization_id = $2 for update`,
      [invoiceId, ctx.orgId],
    );
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "draft") throw new ConflictError(`${inv.invoice_number} is already ${inv.status}.`);
    await tx.query(`update invoices set status = 'issued', issued_at = $2 where id = $1`, [inv.id, ctx.now()]);
    const total = dec(inv.total);
    await postJournal(tx, ctx, {
      description: `${inv.invoice_number} customer invoice`,
      sourceType: "invoice",
      sourceId: inv.id,
      lines: [
        { account: "1200", amount: total },
        { account: "4000", amount: neg(total) },
      ],
    });
    await recordAudit(tx, ctx, {
      action: "invoice.issued",
      entityType: "invoice",
      entityId: inv.id,
      entityNumber: inv.invoice_number,
      summary: `Issued invoice ${inv.invoice_number} ($${toStr(total, 2)})`,
      before: { status: "draft" },
      after: { status: "issued" },
    });
    return { id: inv.id };
  });
}

export async function recordCustomerPayment(db: Database, ctx: ServiceContext, invoiceId: string, amountRaw?: string, paymentDate?: string) {
  authorize(ctx, "finance.manage");
  return db.transaction(async (tx) => {
    const [inv] = await tx.query<{ id: string; invoice_number: string; status: string; total: string; amount_paid: string }>(
      `select id, invoice_number, status, total, amount_paid from invoices where id = $1 and organization_id = $2 for update`,
      [invoiceId, ctx.orgId],
    );
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "issued") throw new ConflictError(`${inv.invoice_number} is ${inv.status}; only issued invoices take payments.`);
    const open = sub(dec(inv.total), dec(inv.amount_paid));
    const amount: Dec = amountRaw ? dec(amountRaw) : open;
    if (amount <= 0n || cmp(amount, open) > 0) throw new ValidationError(`Payment must be between 0.01 and ${toStr(open, 2)}.`, { amount: "Out of range" });
    const number = await nextNumber(tx, ctx.orgId, "PAY");
    await tx.query(
      `insert into payments (organization_id, payment_number, direction, invoice_id, amount, payment_date, method, created_by, created_at)
       values ($1,$2,'received',$3,$4::numeric,$5,'ach',$6,$7)`,
      [ctx.orgId, number, inv.id, toStr(amount, 2), paymentDate ?? today(ctx), ctx.userId, ctx.now()],
    );
    const paidInFull = cmp(amount, open) === 0;
    await tx.query(
      `update invoices set amount_paid = amount_paid + $2::numeric, status = case when $3 then 'paid' else status end,
         paid_at = case when $3 then $4 else paid_at end where id = $1`,
      [inv.id, toStr(amount, 2), paidInFull, ctx.now()],
    );
    await postJournal(tx, ctx, {
      description: `${number} payment on ${inv.invoice_number}`,
      sourceType: "payment",
      lines: [
        { account: "1000", amount },
        { account: "1200", amount: neg(amount) },
      ],
    });
    await recordAudit(tx, ctx, {
      action: "invoice.payment_received",
      entityType: "invoice",
      entityId: inv.id,
      entityNumber: inv.invoice_number,
      summary: `Received $${toStr(amount, 2)} on ${inv.invoice_number}${paidInFull ? " (paid in full)" : ""}`,
      before: { status: inv.status, amountPaid: inv.amount_paid },
      after: { status: paidInFull ? "paid" : inv.status },
    });
    return { id: inv.id, paidInFull };
  });
}

export async function cancelSalesOrder(db: Database, ctx: ServiceContext, soId: string, reason: string) {
  authorize(ctx, "sales.manage");
  if (!reason?.trim()) throw new ValidationError("Give a reason for canceling.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const so = await loadSo(tx, ctx, soId);
    if (!["draft", "confirmed", "on_hold"].includes(so.status)) throw new ConflictError(`${so.so_number} is ${so.status.replace("_", " ")}; shipped orders cannot be canceled.`);
    const lines = await loadSoLines(tx, so.id);
    if (lines.some((l) => dec(l.quantity_shipped) > 0n)) throw new ConflictError(`${so.so_number} has shipments; close the remaining quantity instead.`);
    await closeReservations(tx, ctx, "sales_order_line", lines.map((l) => l.id));
    await tx.query(`update sales_orders set status = 'canceled', canceled_at = $2, updated_at = $2 where id = $1`, [so.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "sales_order.canceled",
      entityType: "sales_order",
      entityId: so.id,
      entityNumber: so.so_number,
      summary: `Canceled ${so.so_number}: ${reason.trim()}`,
      before: { status: so.status },
      after: { status: "canceled" },
      siteId: so.site_id,
    });
    return { id: so.id };
  });
}

/** Close the unshipped remainder of a partially shipped order. */
export async function closeSalesOrder(db: Database, ctx: ServiceContext, soId: string, reason: string) {
  authorize(ctx, "sales.manage");
  if (!reason?.trim()) throw new ValidationError("Give a reason for closing.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const so = await loadSo(tx, ctx, soId);
    if (!["partially_shipped", "shipped"].includes(so.status)) throw new ConflictError(`${so.so_number} is ${so.status.replace("_", " ")}.`);
    const lines = await loadSoLines(tx, so.id);
    await closeReservations(tx, ctx, "sales_order_line", lines.map((l) => l.id));
    await tx.query(`update sales_orders set status = 'closed', closed_at = $2, updated_at = $2 where id = $1`, [so.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "sales_order.closed",
      entityType: "sales_order",
      entityId: so.id,
      entityNumber: so.so_number,
      summary: `Closed ${so.so_number}: ${reason.trim()}`,
      before: { status: so.status },
      after: { status: "closed" },
      siteId: so.site_id,
    });
    return { id: so.id };
  });
}

/**
 * Basic available-to-promise: usable on-hand minus all open reservations/allocations,
 * plus scheduled supply (open POs and work orders) by date. Ignores capacity and
 * unreleased planned orders.
 */
export async function availableToPromise(tx: Sql, ctx: ServiceContext, itemId: string, warehouseId: string) {
  const item = await loadItem(tx, ctx, itemId);
  const now = await availability(tx, ctx, itemId, warehouseId);
  const supply = await tx.query<{ source: string; ref: string; date: string; quantity: string }>(
    `select 'purchase_order' as source, po.po_number as ref, pol.expected_date as date, pol.quantity_ordered - pol.quantity_received as quantity
     from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
     where pol.organization_id = $1 and pol.item_id = $2 and po.warehouse_id = $3 and po.status in ('approved','partially_received')
       and pol.quantity_received < pol.quantity_ordered
     union all
     select 'work_order', wo.wo_number, wo.due_date, wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped
     from work_orders wo
     where wo.organization_id = $1 and wo.item_id = $2 and wo.warehouse_id = $3 and wo.status in ('released','in_progress','on_hold')
       and wo.quantity_planned > wo.quantity_completed + wo.quantity_scrapped
     order by date`,
    [ctx.orgId, itemId, warehouseId],
  );
  let running = now.available;
  const timeline = supply.map((s) => {
    running = add(running, dec(s.quantity));
    return { ...s, cumulative: toStr(running) };
  });
  return {
    item: { id: item.id, sku: item.sku, name: item.name, uom: item.uom },
    usable: toStr(now.usable),
    reserved: toStr(now.reserved),
    availableNow: toStr(now.available),
    incoming: timeline,
    limitations:
      "Estimate only: on-hand excludes held/expired lots and subtracts all open reservations and work-order allocations; incoming supply uses expected dates of approved POs and open work orders. Capacity, unreleased planned orders and quality inspection time are not considered.",
  };
}
