import { z } from "zod";
import type { Database, Sql } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { dec } from "@/lib/decimal";
import { findBomCycle, type BomMap } from "@/lib/domain/bom";
import { recordAudit } from "./audit";
import { nextNumber } from "./numbering";
import { isoDate, optionalText, positiveQty, qty, uuid } from "./schemas";

export const bomLinesInput = z
  .array(
    z.object({
      componentItemId: uuid,
      quantityPer: positiveQty,
      scrapPct: qty.default("0").refine((v) => Number(v) < 100, "Scrap must be below 100%"),
      reference: optionalText,
    }),
  )
  .min(1, "Add at least one component");

export const bomInput = z.object({
  itemId: uuid,
  revision: z.string().trim().min(1).max(10),
  effectiveFrom: isoDate.optional().nullable(),
  notes: optionalText,
  lines: bomLinesInput,
});

/** Effective BOM graph used for cycle checks: released + draft revisions (excluding one bom). */
async function loadBomGraph(tx: Sql, ctx: ServiceContext, excludeBomId?: string): Promise<BomMap> {
  const rows = await tx.query<{ item_id: string; component_item_id: string; quantity_per: string; scrap_pct: string }>(
    `select b.item_id, bl.component_item_id, bl.quantity_per, bl.scrap_pct
     from boms b join bom_lines bl on bl.bom_id = b.id
     where b.organization_id = $1 and b.status <> 'obsolete' and ($2::uuid is null or b.id <> $2::uuid)`,
    [ctx.orgId, excludeBomId ?? null],
  );
  const map: BomMap = new Map();
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push({ componentItemId: r.component_item_id, quantityPer: dec(r.quantity_per), scrapPct: dec(r.scrap_pct) });
    map.set(r.item_id, list);
  }
  return map;
}

async function assertNoCycle(tx: Sql, ctx: ServiceContext, assemblyId: string, componentIds: string[], excludeBomId?: string) {
  if (componentIds.includes(assemblyId)) throw new ValidationError("An assembly cannot contain itself.");
  if (new Set(componentIds).size !== componentIds.length) throw new ValidationError("Each component can appear only once per BOM.");
  const graph = await loadBomGraph(tx, ctx, excludeBomId);
  const cycle = findBomCycle(graph, { assemblyId, componentIds });
  if (cycle) {
    const skus = await tx.query<{ id: string; sku: string }>(`select id, sku from items where organization_id = $1`, [ctx.orgId]);
    const bySku = new Map(skus.map((s) => [s.id, s.sku]));
    throw new ValidationError(`Circular BOM reference: ${cycle.map((id) => bySku.get(id) ?? id).join(" → ")}`);
  }
}

async function insertLines(tx: Sql, ctx: ServiceContext, bomId: string, lines: z.output<typeof bomLinesInput>) {
  let n = 0;
  for (const l of lines) {
    const [comp] = await tx.query<{ lifecycle_status: string; sku: string }>(`select lifecycle_status, sku from items where id = $1 and organization_id = $2`, [l.componentItemId, ctx.orgId]);
    if (!comp) throw new NotFoundError("Component item");
    if (comp.lifecycle_status === "obsolete") throw new ValidationError(`${comp.sku} is obsolete and cannot be added to a BOM.`);
    n++;
    await tx.query(
      `insert into bom_lines (organization_id, bom_id, line_no, component_item_id, quantity_per, scrap_pct, reference)
       values ($1,$2,$3,$4,$5::numeric,$6::numeric,$7)`,
      [ctx.orgId, bomId, n * 10, l.componentItemId, l.quantityPer, l.scrapPct, l.reference ?? null],
    );
  }
}

export async function createBom(db: Database, ctx: ServiceContext, raw: z.input<typeof bomInput>) {
  authorize(ctx, "engineering.manage");
  const input = bomInput.parse(raw);
  return db.transaction((tx) => createBomTx(tx, ctx, input));
}

export async function createBomTx(tx: Sql, ctx: ServiceContext, input: z.output<typeof bomInput>) {
  const [item] = await tx.query<{ id: string; sku: string; item_type: string }>(`select id, sku, item_type from items where id = $1 and organization_id = $2`, [input.itemId, ctx.orgId]);
  if (!item) throw new NotFoundError("Item");
  if (item.item_type !== "manufactured") throw new ValidationError(`${item.sku} is a purchased item; only manufactured items have BOMs.`);
  const [dup] = await tx.query(`select 1 from boms where item_id = $1 and revision = $2`, [item.id, input.revision]);
  if (dup) throw new ValidationError(`${item.sku} already has revision ${input.revision}.`, { revision: "Exists" });
  await assertNoCycle(tx, ctx, item.id, input.lines.map((l) => l.componentItemId));
  const [bom] = await tx.query<{ id: string }>(
    `insert into boms (organization_id, item_id, revision, status, effective_from, notes, created_by, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,$6,$7,$7) returning id`,
    [ctx.orgId, item.id, input.revision, input.effectiveFrom ?? null, input.notes ?? null, ctx.userId, ctx.now()],
  );
  await insertLines(tx, ctx, bom.id, input.lines);
  await recordAudit(tx, ctx, {
    action: "bom.created",
    entityType: "bom",
    entityId: bom.id,
    entityNumber: `${item.sku} rev ${input.revision}`,
    summary: `Created draft BOM ${item.sku} rev ${input.revision} with ${input.lines.length} components`,
  });
  return { id: bom.id };
}

export async function updateBomLines(db: Database, ctx: ServiceContext, bomId: string, rawLines: z.input<typeof bomLinesInput>, notes?: string) {
  authorize(ctx, "engineering.manage");
  const lines = bomLinesInput.parse(rawLines);
  return db.transaction(async (tx) => {
    const [bom] = await tx.query<{ id: string; item_id: string; revision: string; status: string; sku: string }>(
      `select b.id, b.item_id, b.revision, b.status, i.sku from boms b join items i on i.id = b.item_id where b.id = $1 and b.organization_id = $2 for update of b`,
      [bomId, ctx.orgId],
    );
    if (!bom) throw new NotFoundError("BOM");
    if (bom.status !== "draft") throw new ConflictError(`${bom.sku} rev ${bom.revision} is ${bom.status}; create a new revision (ECO) to change it.`);
    await assertNoCycle(tx, ctx, bom.item_id, lines.map((l) => l.componentItemId), bom.id);
    const before = await tx.query(`select component_item_id, quantity_per, scrap_pct from bom_lines where bom_id = $1 order by line_no`, [bom.id]);
    await tx.query(`delete from bom_lines where bom_id = $1`, [bom.id]);
    await insertLines(tx, ctx, bom.id, lines);
    await tx.query(`update boms set notes = coalesce($2, notes), updated_at = $3 where id = $1`, [bom.id, notes ?? null, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "bom.updated",
      entityType: "bom",
      entityId: bom.id,
      entityNumber: `${bom.sku} rev ${bom.revision}`,
      summary: `Edited draft BOM ${bom.sku} rev ${bom.revision} (${lines.length} components)`,
      before,
      after: lines,
    });
    return { id: bom.id };
  });
}

export async function releaseBom(db: Database, ctx: ServiceContext, bomId: string, changeId?: string | null) {
  authorize(ctx, "engineering.release");
  return db.transaction((tx) => releaseBomTx(tx, ctx, bomId, changeId));
}

/** Release a draft revision: previous released revision becomes obsolete; item revision advances. */
export async function releaseBomTx(tx: Sql, ctx: ServiceContext, bomId: string, changeId?: string | null) {
  const [bom] = await tx.query<{ id: string; item_id: string; revision: string; status: string; sku: string }>(
    `select b.id, b.item_id, b.revision, b.status, i.sku from boms b join items i on i.id = b.item_id where b.id = $1 and b.organization_id = $2 for update of b`,
    [bomId, ctx.orgId],
  );
  if (!bom) throw new NotFoundError("BOM");
  if (bom.status !== "draft") throw new ConflictError(`${bom.sku} rev ${bom.revision} is already ${bom.status}.`);
  const [{ n }] = await tx.query<{ n: number }>(`select count(*) as n from bom_lines where bom_id = $1`, [bom.id]);
  if (Number(n) === 0) throw new ValidationError("A BOM needs at least one component before release.");
  const lines = await tx.query<{ component_item_id: string }>(`select component_item_id from bom_lines where bom_id = $1`, [bom.id]);
  await assertNoCycle(tx, ctx, bom.item_id, lines.map((l) => l.component_item_id), bom.id);
  const [prev] = await tx.query<{ id: string; revision: string }>(`select id, revision from boms where item_id = $1 and status = 'released'`, [bom.item_id]);
  const asOf = today(ctx);
  if (prev) {
    await tx.query(`update boms set status = 'obsolete', effective_to = $2, updated_at = $3 where id = $1`, [prev.id, asOf, ctx.now()]);
    await tx.query(`update item_revisions set status = 'superseded' where item_id = $1 and revision = $2`, [bom.item_id, prev.revision]);
  }
  await tx.query(
    `update boms set status = 'released', released_by = $2, released_at = $3, effective_from = coalesce(effective_from, $4), updated_at = $3 where id = $1`,
    [bom.id, ctx.userId, ctx.now(), asOf],
  );
  await tx.query(`update items set revision = $2, updated_at = $3 where id = $1`, [bom.item_id, bom.revision, ctx.now()]);
  await tx.query(
    `insert into item_revisions (organization_id, item_id, revision, status, effective_from, change_id, notes)
     values ($1,$2,$3,'released',$4,$5,$6)
     on conflict (item_id, revision) do update set status = 'released', effective_from = excluded.effective_from, change_id = excluded.change_id`,
    [ctx.orgId, bom.item_id, bom.revision, asOf, changeId ?? null, prev ? `Supersedes rev ${prev.revision}` : "Initial release"],
  );
  await recordAudit(tx, ctx, {
    action: "bom.released",
    entityType: "bom",
    entityId: bom.id,
    entityNumber: `${bom.sku} rev ${bom.revision}`,
    summary: `Released BOM ${bom.sku} rev ${bom.revision}${prev ? ` (rev ${prev.revision} obsoleted)` : ""}`,
    before: { status: "draft", releasedRevision: prev?.revision ?? null },
    after: { status: "released", releasedRevision: bom.revision },
  });
  return { id: bom.id };
}

/** Copy a BOM into a new draft revision (starting point for an engineering change). */
export async function copyBomRevision(db: Database, ctx: ServiceContext, bomId: string, newRevision: string) {
  authorize(ctx, "engineering.manage");
  return db.transaction((tx) => copyBomRevisionTx(tx, ctx, bomId, newRevision));
}

async function copyBomRevisionTx(tx: Sql, ctx: ServiceContext, bomId: string, newRevision: string) {
  const rev = newRevision.trim();
  if (!rev) throw new ValidationError("Enter the new revision.", { revision: "Required" });
  const [bom] = await tx.query<{ id: string; item_id: string; revision: string; sku: string }>(
    `select b.id, b.item_id, b.revision, i.sku from boms b join items i on i.id = b.item_id where b.id = $1 and b.organization_id = $2`,
    [bomId, ctx.orgId],
  );
  if (!bom) throw new NotFoundError("BOM");
  const [dup] = await tx.query(`select 1 from boms where item_id = $1 and revision = $2`, [bom.item_id, rev]);
  if (dup) throw new ValidationError(`Revision ${rev} already exists for ${bom.sku}.`, { revision: "Exists" });
  const [copy] = await tx.query<{ id: string }>(
    `insert into boms (organization_id, item_id, revision, status, notes, created_by, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,$6,$6) returning id`,
    [ctx.orgId, bom.item_id, rev, `Copied from rev ${bom.revision}`, ctx.userId, ctx.now()],
  );
  await tx.query(
    `insert into bom_lines (organization_id, bom_id, line_no, component_item_id, quantity_per, scrap_pct, reference, notes)
     select organization_id, $2, line_no, component_item_id, quantity_per, scrap_pct, reference, notes from bom_lines where bom_id = $1`,
    [bom.id, copy.id],
  );
  await recordAudit(tx, ctx, {
    action: "bom.revision_created",
    entityType: "bom",
    entityId: copy.id,
    entityNumber: `${bom.sku} rev ${rev}`,
    summary: `Created draft revision ${rev} of ${bom.sku} from rev ${bom.revision}`,
  });
  return { id: copy.id };
}

export const ecoInput = z.object({
  itemId: uuid,
  title: z.string().trim().min(5).max(160),
  description: optionalText,
  reason: optionalText,
  toRevision: z.string().trim().min(1).max(10),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

/** Open an engineering change; creates the draft BOM revision it will release. */
export async function createEngineeringChange(db: Database, ctx: ServiceContext, raw: z.input<typeof ecoInput>) {
  authorize(ctx, "engineering.manage");
  const input = ecoInput.parse(raw);
  return db.transaction(async (tx) => {
    const [item] = await tx.query<{ id: string; sku: string; revision: string; item_type: string }>(
      `select id, sku, revision, item_type from items where id = $1 and organization_id = $2`,
      [input.itemId, ctx.orgId],
    );
    if (!item) throw new NotFoundError("Item");
    const [released] = await tx.query<{ id: string }>(`select id from boms where item_id = $1 and status = 'released'`, [item.id]);
    let bomId: string | null = null;
    if (item.item_type === "manufactured" && released) {
      bomId = (await copyBomRevisionTx(tx, ctx, released.id, input.toRevision)).id;
    }
    const number = await nextNumber(tx, ctx.orgId, "ECO");
    const [eco] = await tx.query<{ id: string }>(
      `insert into engineering_changes (organization_id, change_number, title, description, reason, item_id, from_revision, to_revision,
         bom_id, status, priority, requested_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12,$12) returning id`,
      [ctx.orgId, number, input.title, input.description ?? null, input.reason ?? null, item.id, item.revision, input.toRevision, bomId, input.priority, ctx.userId, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: "eco.created",
      entityType: "engineering_change",
      entityId: eco.id,
      entityNumber: number,
      summary: `Opened ${number} for ${item.sku} rev ${item.revision} → ${input.toRevision}: ${input.title}`,
    });
    return { id: eco.id, number, bomId };
  });
}

const TRANSITIONS: Record<string, { from: string[]; to: string; permission: "engineering.manage" | "engineering.release" }> = {
  submit: { from: ["draft"], to: "in_review", permission: "engineering.manage" },
  approve: { from: ["in_review"], to: "approved", permission: "engineering.release" },
  reject: { from: ["in_review", "approved"], to: "rejected", permission: "engineering.release" },
  implement: { from: ["approved"], to: "implemented", permission: "engineering.release" },
  cancel: { from: ["draft", "in_review"], to: "canceled", permission: "engineering.manage" },
};

export async function advanceEngineeringChange(db: Database, ctx: ServiceContext, ecoId: string, action: keyof typeof TRANSITIONS) {
  const t = TRANSITIONS[action];
  if (!t) throw new ValidationError("Unknown action.");
  authorize(ctx, t.permission);
  return db.transaction(async (tx) => {
    const [eco] = await tx.query<{ id: string; change_number: string; status: string; bom_id: string | null; requested_by: string | null }>(
      `select id, change_number, status, bom_id, requested_by from engineering_changes where id = $1 and organization_id = $2 for update`,
      [ecoId, ctx.orgId],
    );
    if (!eco) throw new NotFoundError("Engineering change");
    if (!t.from.includes(eco.status)) throw new ConflictError(`${eco.change_number} is ${eco.status.replace("_", " ")}; cannot ${action}.`);
    if (action === "implement" && eco.bom_id) {
      await releaseBomTx(tx, ctx, eco.bom_id, eco.id);
    }
    if ((action === "reject" || action === "cancel") && eco.bom_id) {
      await tx.query(`update boms set status = 'obsolete', updated_at = $2 where id = $1 and status = 'draft'`, [eco.bom_id, ctx.now()]);
    }
    await tx.query(
      `update engineering_changes set status = $2,
         approved_by = case when $3 = 'approve' then $4::uuid else approved_by end,
         approved_at = case when $3 = 'approve' then $5::timestamptz else approved_at end,
         implemented_by = case when $3 = 'implement' then $4::uuid else implemented_by end,
         implemented_at = case when $3 = 'implement' then $5::timestamptz else implemented_at end,
         updated_at = $5
       where id = $1`,
      [eco.id, t.to, action, ctx.userId, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: `eco.${action}`,
      entityType: "engineering_change",
      entityId: eco.id,
      entityNumber: eco.change_number,
      summary: `${eco.change_number}: ${eco.status.replace("_", " ")} → ${t.to.replace("_", " ")}`,
      before: { status: eco.status },
      after: { status: t.to },
    });
    return { id: eco.id, status: t.to };
  });
}
