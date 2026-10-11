import { z } from "zod";
import { qualityEventInput, holdInput, releaseHoldInput, updateEventInput, capaInput, inspectionInput } from "@/lib/validation";
import type { Database, Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recordAudit } from "./audit";
import { nextNumber } from "./numbering";


async function assertInOrg(tx: Sql, ctx: ServiceContext, table: string, id: string | null | undefined, label: string) {
  if (!id) return;
  const [row] = await tx.query(`select 1 from ${table} where id = $1 and organization_id = $2`, [id, ctx.orgId]);
  if (!row) throw new NotFoundError(label);
}

export async function openQualityEvent(db: Database, ctx: ServiceContext, raw: z.input<typeof qualityEventInput>) {
  authorize(ctx, "quality.manage");
  const input = qualityEventInput.parse(raw);
  if (input.placeHold) authorize(ctx, "quality.hold");
  return db.transaction(async (tx) => {
    let itemId = input.itemId ?? null;
    let siteId: string | null = null;
    if (input.lotId) {
      const [lot] = await tx.query<{ item_id: string }>(`select item_id from inventory_lots where id = $1 and organization_id = $2`, [input.lotId, ctx.orgId]);
      if (!lot) throw new NotFoundError("Lot");
      if (itemId && itemId !== lot.item_id) throw new ValidationError("The lot belongs to a different item.");
      itemId = lot.item_id;
    }
    await assertInOrg(tx, ctx, "items", itemId, "Item");
    await assertInOrg(tx, ctx, "purchase_orders", input.purchaseOrderId, "Purchase order");
    await assertInOrg(tx, ctx, "sales_orders", input.salesOrderId, "Sales order");
    await assertInOrg(tx, ctx, "suppliers", input.supplierId, "Supplier");
    await assertInOrg(tx, ctx, "customers", input.customerId, "Customer");
    if (input.workOrderId) {
      const [wo] = await tx.query<{ site_id: string }>(`select site_id from work_orders where id = $1 and organization_id = $2`, [input.workOrderId, ctx.orgId]);
      if (!wo) throw new NotFoundError("Work order");
      siteId = wo.site_id;
    }
    if (input.ownerId) {
      const [m] = await tx.query(`select 1 from memberships where organization_id = $1 and profile_id = $2 and is_active`, [ctx.orgId, input.ownerId]);
      if (!m) throw new ValidationError("The owner must be a member of this organization.");
    }
    const prefix = { ncr: "NCR", complaint: "CMP", deviation: "DEV", audit_finding: "AUD" }[input.eventType];
    const number = await nextNumber(tx, ctx.orgId, prefix);
    const [ev] = await tx.query<{ id: string }>(
      `insert into quality_events (organization_id, event_number, event_type, title, description, severity, status, source, site_id,
         item_id, lot_id, work_order_id, purchase_order_id, sales_order_id, supplier_id, customer_id, quantity_affected,
         owner_id, due_date, opened_by, opened_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::numeric,$17,$18,$19,$20,$20,$20) returning id`,
      [
        ctx.orgId, number, input.eventType, input.title, input.description ?? null, input.severity, input.source, siteId, itemId,
        input.lotId ?? null, input.workOrderId ?? null, input.purchaseOrderId ?? null, input.salesOrderId ?? null,
        input.supplierId ?? null, input.customerId ?? null, input.quantityAffected ?? null, input.ownerId ?? ctx.userId,
        input.dueDate ?? null, ctx.userId, ctx.now(),
      ],
    );
    await recordAudit(tx, ctx, {
      action: "quality_event.opened",
      entityType: "quality_event",
      entityId: ev.id,
      entityNumber: number,
      summary: `Opened ${number} (${input.severity}): ${input.title}`,
      after: { status: "open", severity: input.severity },
      siteId,
    });
    let hold: { id: string } | null = null;
    if (input.placeHold) {
      if (!input.lotId) throw new ValidationError("Select a lot to place on hold.", { lotId: "Required" });
      hold = await placeHoldTx(tx, ctx, { lotId: input.lotId, reason: input.holdReason ?? `${number}: ${input.title}`, qualityEventId: ev.id });
    }
    return { id: ev.id, number, holdId: hold?.id ?? null };
  });
}


export async function placeLotHold(db: Database, ctx: ServiceContext, raw: z.input<typeof holdInput>) {
  authorize(ctx, "quality.hold");
  const input = holdInput.parse(raw);
  return db.transaction((tx) => placeHoldTx(tx, ctx, input));
}

async function placeHoldTx(tx: Sql, ctx: ServiceContext, input: { lotId: string; reason: string; qualityEventId?: string | null }) {
  const [lot] = await tx.query<{ id: string; lot_number: string; status: string; item_id: string; sku: string }>(
    `select l.id, l.lot_number, l.status, l.item_id, i.sku from inventory_lots l join items i on i.id = l.item_id
     where l.id = $1 and l.organization_id = $2 for update of l`,
    [input.lotId, ctx.orgId],
  );
  if (!lot) throw new NotFoundError("Lot");
  if (lot.status === "hold") throw new ConflictError(`Lot ${lot.lot_number} is already on hold.`);
  if (input.qualityEventId) await assertInOrg(tx, ctx, "quality_events", input.qualityEventId, "Quality event");
  const [hold] = await tx.query<{ id: string }>(
    `insert into quality_holds (organization_id, lot_id, item_id, quality_event_id, status, reason, previous_lot_status, placed_by, placed_at)
     values ($1,$2,$3,$4,'active',$5,$6,$7,$8) returning id`,
    [ctx.orgId, lot.id, lot.item_id, input.qualityEventId ?? null, input.reason, lot.status, ctx.userId, ctx.now()],
  );
  await tx.query(`update inventory_lots set status = 'hold', updated_at = $2 where id = $1`, [lot.id, ctx.now()]);
  await recordAudit(tx, ctx, {
    action: "lot.hold_placed",
    entityType: "lot",
    entityId: lot.id,
    entityNumber: lot.lot_number,
    summary: `Placed lot ${lot.lot_number} (${lot.sku}) on quality hold: ${input.reason}`,
    before: { lotStatus: lot.status },
    after: { lotStatus: "hold" },
    metadata: { holdId: hold.id, qualityEventId: input.qualityEventId ?? null },
  });
  return { id: hold.id };
}


/** Release a quality hold. Requires the quality.hold permission and a documented reason. */
export async function releaseLotHold(db: Database, ctx: ServiceContext, raw: z.input<typeof releaseHoldInput>) {
  authorize(ctx, "quality.hold");
  const input = releaseHoldInput.parse(raw);
  return db.transaction(async (tx) => {
    const [hold] = await tx.query<{ id: string; lot_id: string; status: string; previous_lot_status: string; reason: string; lot_number: string; sku: string }>(
      `select h.id, h.lot_id, h.status, h.previous_lot_status, h.reason, l.lot_number, i.sku
       from quality_holds h join inventory_lots l on l.id = h.lot_id join items i on i.id = h.item_id
       where h.id = $1 and h.organization_id = $2 for update of h`,
      [input.holdId, ctx.orgId],
    );
    if (!hold) throw new NotFoundError("Quality hold");
    if (hold.status !== "active") throw new ConflictError("This hold was already released.");
    await tx.query(
      `update quality_holds set status = 'released', released_by = $2, released_at = $3, release_reason = $4 where id = $1`,
      [hold.id, ctx.userId, ctx.now(), input.reason],
    );
    const restored = hold.previous_lot_status === "hold" ? "available" : hold.previous_lot_status;
    await tx.query(`update inventory_lots set status = $2, updated_at = $3 where id = $1`, [hold.lot_id, restored, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "lot.hold_released",
      entityType: "lot",
      entityId: hold.lot_id,
      entityNumber: hold.lot_number,
      summary: `Released quality hold on lot ${hold.lot_number} (${hold.sku}): ${input.reason}`,
      before: { lotStatus: "hold", holdStatus: "active", holdReason: hold.reason },
      after: { lotStatus: restored, holdStatus: "released", releaseReason: input.reason },
      metadata: { holdId: hold.id },
    });
    return { id: hold.id, lotStatus: restored };
  });
}

/** Release a lot from incoming-inspection quarantine (no hold record). */
export async function releaseQuarantine(db: Database, ctx: ServiceContext, lotId: string, reason: string) {
  authorize(ctx, "quality.hold");
  if (!reason?.trim() || reason.trim().length < 5) throw new ValidationError("Document the release reason.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const [lot] = await tx.query<{ id: string; lot_number: string; status: string }>(
      `select id, lot_number, status from inventory_lots where id = $1 and organization_id = $2 for update`,
      [lotId, ctx.orgId],
    );
    if (!lot) throw new NotFoundError("Lot");
    if (lot.status !== "quarantine") throw new ConflictError(`Lot ${lot.lot_number} is not in quarantine.`);
    await tx.query(`update inventory_lots set status = 'available', updated_at = $2 where id = $1`, [lot.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "lot.quarantine_released",
      entityType: "lot",
      entityId: lot.id,
      entityNumber: lot.lot_number,
      summary: `Released lot ${lot.lot_number} from quarantine: ${reason.trim()}`,
      before: { lotStatus: "quarantine" },
      after: { lotStatus: "available" },
    });
    return { id: lot.id };
  });
}


export async function updateQualityEvent(db: Database, ctx: ServiceContext, raw: z.input<typeof updateEventInput>) {
  authorize(ctx, "quality.manage");
  const input = updateEventInput.parse(raw);
  return db.transaction(async (tx) => {
    const [ev] = await tx.query<{ id: string; event_number: string; status: string; event_type: string; lot_id: string | null; disposition: string | null; root_cause: string | null; site_id: string | null }>(
      `select id, event_number, status, event_type, lot_id, disposition, root_cause, site_id from quality_events where id = $1 and organization_id = $2 for update`,
      [input.id, ctx.orgId],
    );
    if (!ev) throw new NotFoundError("Quality event");
    if (["closed", "canceled"].includes(ev.status)) throw new ConflictError(`${ev.event_number} is already ${ev.status}.`);
    const disposition = input.disposition ?? ev.disposition;
    if (input.status === "closed") {
      if (ev.event_type === "ncr" && !disposition) throw new ValidationError("Choose a disposition before closing an NCR.", { disposition: "Required" });
      if (!input.closureNotes) throw new ValidationError("Closure notes are required.", { closureNotes: "Required" });
      const [active] = await tx.query(`select 1 from quality_holds where quality_event_id = $1 and status = 'active'`, [ev.id]);
      if (active && disposition !== "scrap" && disposition !== "return_to_supplier") {
        throw new ValidationError("Release the linked lot hold (or disposition the lot as scrap/return) before closing.");
      }
      const [openCapa] = await tx.query(`select 1 from capa_actions where quality_event_id = $1 and status not in ('verified','closed')`, [ev.id]);
      if (openCapa) throw new ValidationError("Verify or close the linked CAPA actions before closing.");
    }
    const closing = input.status === "closed" || input.status === "canceled";
    await tx.query(
      `update quality_events set status = $2, disposition = $3, root_cause = coalesce($4, root_cause), closure_notes = coalesce($5, closure_notes),
         closed_by = case when $6 then $7::uuid else closed_by end, closed_at = case when $6 then $8::timestamptz else closed_at end, updated_at = $8
       where id = $1`,
      [ev.id, input.status, disposition ?? null, input.rootCause ?? null, input.closureNotes ?? null, closing, ctx.userId, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: `quality_event.${input.status === "closed" ? "closed" : "updated"}`,
      entityType: "quality_event",
      entityId: ev.id,
      entityNumber: ev.event_number,
      summary: `${ev.event_number}: ${ev.status.replace("_", " ")} → ${input.status.replace("_", " ")}${disposition ? ` (disposition: ${disposition.replace(/_/g, " ")})` : ""}`,
      before: { status: ev.status, disposition: ev.disposition, rootCause: ev.root_cause },
      after: { status: input.status, disposition, rootCause: input.rootCause ?? ev.root_cause },
      siteId: ev.site_id,
    });
    return { id: ev.id };
  });
}


export async function createCapa(db: Database, ctx: ServiceContext, raw: z.input<typeof capaInput>) {
  authorize(ctx, "quality.manage");
  const input = capaInput.parse(raw);
  return db.transaction(async (tx) => {
    await assertInOrg(tx, ctx, "quality_events", input.qualityEventId, "Quality event");
    const number = await nextNumber(tx, ctx.orgId, "CAPA");
    const [row] = await tx.query<{ id: string }>(
      `insert into capa_actions (organization_id, capa_number, quality_event_id, action_type, description, owner_id, due_date, status, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$9) returning id`,
      [ctx.orgId, number, input.qualityEventId ?? null, input.actionType, input.description, input.ownerId ?? ctx.userId, input.dueDate, ctx.userId, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: "capa.created",
      entityType: "capa",
      entityId: row.id,
      entityNumber: number,
      summary: `Opened ${input.actionType} action ${number}: ${input.description.slice(0, 80)}`,
    });
    return { id: row.id, number };
  });
}

export async function updateCapaStatus(
  db: Database,
  ctx: ServiceContext,
  id: string,
  status: "open" | "in_progress" | "verified" | "closed",
  notes?: string,
) {
  authorize(ctx, "quality.manage");
  return db.transaction(async (tx) => {
    const [capa] = await tx.query<{ id: string; capa_number: string; status: string }>(
      `select id, capa_number, status from capa_actions where id = $1 and organization_id = $2 for update`,
      [id, ctx.orgId],
    );
    if (!capa) throw new NotFoundError("CAPA");
    if (capa.status === "closed") throw new ConflictError(`${capa.capa_number} is closed.`);
    if ((status === "verified" || status === "closed") && !notes?.trim()) {
      throw new ValidationError("Effectiveness/verification notes are required.", { notes: "Required" });
    }
    await tx.query(
      `update capa_actions set status = $2, verification_notes = coalesce($3, verification_notes),
         completed_at = case when $2 in ('verified','closed') then coalesce(completed_at, $4::timestamptz) else completed_at end, updated_at = $4
       where id = $1`,
      [capa.id, status, notes?.trim() || null, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: "capa.updated",
      entityType: "capa",
      entityId: capa.id,
      entityNumber: capa.capa_number,
      summary: `${capa.capa_number}: ${capa.status.replace("_", " ")} → ${status.replace("_", " ")}`,
      before: { status: capa.status },
      after: { status },
    });
    return { id: capa.id };
  });
}


export async function recordInspection(db: Database, ctx: ServiceContext, raw: z.input<typeof inspectionInput>) {
  authorize(ctx, "quality.manage");
  const input = inspectionInput.parse(raw);
  if (Number(input.quantityRejected) > Number(input.quantityInspected)) {
    throw new ValidationError("Rejected quantity cannot exceed inspected quantity.", { quantityRejected: "Too large" });
  }
  return db.transaction(async (tx) => {
    await assertInOrg(tx, ctx, "items", input.itemId, "Item");
    await assertInOrg(tx, ctx, "purchase_orders", input.purchaseOrderId, "Purchase order");
    await assertInOrg(tx, ctx, "work_orders", input.workOrderId, "Work order");
    let lotNumber: string | null = null;
    if (input.lotId) {
      const [lot] = await tx.query<{ lot_number: string; item_id: string }>(`select lot_number, item_id from inventory_lots where id = $1 and organization_id = $2`, [input.lotId, ctx.orgId]);
      if (!lot) throw new NotFoundError("Lot");
      if (lot.item_id !== input.itemId) throw new ValidationError("The lot belongs to a different item.");
      lotNumber = lot.lot_number;
    }
    const number = await nextNumber(tx, ctx.orgId, "INS");
    const [row] = await tx.query<{ id: string }>(
      `insert into inspections (organization_id, inspection_number, inspection_type, item_id, lot_id, purchase_order_id, work_order_id,
         quantity_inspected, quantity_rejected, result, inspector_id, inspected_at, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11,$12,$13) returning id`,
      [ctx.orgId, number, input.inspectionType, input.itemId, input.lotId ?? null, input.purchaseOrderId ?? null, input.workOrderId ?? null,
        input.quantityInspected, input.quantityRejected, input.result, ctx.userId, ctx.now(), input.notes ?? null],
    );
    await recordAudit(tx, ctx, {
      action: "inspection.recorded",
      entityType: "inspection",
      entityId: row.id,
      entityNumber: number,
      summary: `${input.inspectionType.replace("_", "-")} inspection ${number}: ${input.result.toUpperCase()}${lotNumber ? ` (lot ${lotNumber})` : ""}, ${input.quantityRejected} rejected of ${input.quantityInspected}`,
    });
    return { id: row.id, number };
  });
}
