import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { add, dec, div, mul, num, toNumber, type Dec } from "@/lib/decimal";
import { explodeBom, grossComponentQty, rollupCosts, whereUsed, type BomMap } from "@/lib/domain/bom";
import { getActivity } from "./dashboard";

async function releasedBomMap(db: Sql, ctx: ServiceContext): Promise<BomMap> {
  const rows = await db.query<{ item_id: string; component_item_id: string; quantity_per: string; scrap_pct: string }>(
    `select b.item_id, bl.component_item_id, bl.quantity_per, bl.scrap_pct from boms b join bom_lines bl on bl.bom_id = b.id
     where b.organization_id = $1 and b.status = 'released' order by bl.line_no`,
    [ctx.orgId],
  );
  const map: BomMap = new Map();
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push({ componentItemId: r.component_item_id, quantityPer: dec(r.quantity_per), scrapPct: dec(r.scrap_pct) });
    map.set(r.item_id, list);
  }
  return map;
}

async function costContext(db: Sql, ctx: ServiceContext) {
  const items = await db.query<{ id: string; sku: string; name: string; item_type: string; standard_cost: string; uom: string; moq: string }>(
    `select id, sku, name, item_type, standard_cost, uom, min_order_qty as moq from items where organization_id = $1`,
    [ctx.orgId],
  );
  const routing = await db.query<{ item_id: string; setup_hours: string; run_hours_per_unit: string; hourly_rate: string }>(
    `select r.item_id, r.setup_hours, r.run_hours_per_unit, wc.hourly_rate from routing_operations r join work_centers wc on wc.id = r.work_center_id where r.organization_id = $1`,
    [ctx.orgId],
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const labor = (itemId: string): Dec => {
    const item = byId.get(itemId);
    let total = 0n;
    for (const op of routing.filter((r) => r.item_id === itemId)) {
      const perUnit = add(div(dec(op.setup_hours), dec(item?.moq ?? "1")), dec(op.run_hours_per_unit));
      total = add(total, mul(perUnit, dec(op.hourly_rate)));
    }
    return total;
  };
  return { items, byId, labor };
}

export async function listBoms(db: Sql, ctx: ServiceContext) {
  authorize(ctx, "engineering.view");
  const rows = await db.query<{ id: string; item_id: string; sku: string; name: string; family: string | null; revision: string; status: string; effective_from: string | null; effective_to: string | null; lines: number; released_at: Date | null; wos: number }>(
    `select b.id, b.item_id, i.sku, i.name, i.product_family as family, b.revision, b.status, b.effective_from::text, b.effective_to::text,
            (select count(*) from bom_lines bl where bl.bom_id = b.id) as lines, b.released_at,
            (select count(*) from work_orders wo where wo.bom_id = b.id) as wos
     from boms b join items i on i.id = b.item_id where b.organization_id = $1 order by i.sku, b.revision desc`,
    [ctx.orgId],
  );
  const map = await releasedBomMap(db, ctx);
  const { byId, labor } = await costContext(db, ctx);
  const rolled = rollupCosts(map.keys(), map, (id) => dec(byId.get(id)?.standard_cost ?? "0"), labor);
  return rows.map((r) => ({
    ...r,
    lines: Number(r.lines),
    wos: Number(r.wos),
    rolledCost: r.status === "released" && rolled.get(r.item_id) ? toNumber(rolled.get(r.item_id)!.total) : null,
    standardCost: num(byId.get(r.item_id)?.standard_cost ?? "0"),
    family: r.family ?? "",
  }));
}

export interface TreeNode {
  key: string;
  level: number;
  itemId: string;
  sku: string;
  name: string;
  type: string;
  uom: string;
  quantityPer: number;
  scrapPct: number;
  extendedQty: number;
  unitCost: number;
  extendedCost: number;
  parentKey: string | null;
  hasChildren: boolean;
}

export async function getBom(db: Sql, ctx: ServiceContext, id: string) {
  authorize(ctx, "engineering.view");
  const [bom] = await db.query<{ id: string; item_id: string; sku: string; name: string; uom: string; revision: string; status: string; effective_from: string | null; effective_to: string | null; notes: string | null; created_by: string | null; released_by: string | null; released_at: Date | null }>(
    `select b.id, b.item_id, i.sku, i.name, i.uom, b.revision, b.status, b.effective_from::text, b.effective_to::text, b.notes,
            cb.full_name as created_by, rb.full_name as released_by, b.released_at
     from boms b join items i on i.id = b.item_id left join profiles cb on cb.id = b.created_by left join profiles rb on rb.id = b.released_by
     where b.id = $1 and b.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!bom) throw new NotFoundError("BOM");
  const lines = await db.query<{ id: string; line_no: number; component_item_id: string; quantity_per: string; scrap_pct: string; reference: string | null }>(
    `select id, line_no, component_item_id, quantity_per, scrap_pct, reference from bom_lines where bom_id = $1 order by line_no`,
    [id],
  );
  const released = await releasedBomMap(db, ctx);
  // Explode this revision at the top level, released revisions below it.
  const map: BomMap = new Map(released);
  map.set(bom.item_id, lines.map((l) => ({ componentItemId: l.component_item_id, quantityPer: dec(l.quantity_per), scrapPct: dec(l.scrap_pct) })));
  const { byId, labor } = await costContext(db, ctx);
  const rolled = rollupCosts(map.keys(), map, (iid) => dec(byId.get(iid)?.standard_cost ?? "0"), labor);
  const unitCost = (iid: string) => (map.has(iid) ? rolled.get(iid)!.total : dec(byId.get(iid)?.standard_cost ?? "0"));
  let error: string | null = null;
  const tree: TreeNode[] = [];
  try {
    const exploded = explodeBom(bom.item_id, dec(1), map);
    exploded.forEach((e, idx) => {
      const it = byId.get(e.itemId);
      const key = `${e.path.join("/")}/${e.itemId}#${idx}`;
      const parentKey = e.level === 1 ? null : [...tree].reverse().find((t) => t.level === e.level - 1 && t.itemId === e.parentItemId)?.key ?? null;
      tree.push({
        key,
        level: e.level,
        itemId: e.itemId,
        sku: it?.sku ?? "?",
        name: it?.name ?? "",
        type: it?.item_type ?? "",
        uom: it?.uom ?? "ea",
        quantityPer: toNumber(e.quantityPer),
        scrapPct: toNumber(e.scrapPct),
        extendedQty: toNumber(e.extendedQty),
        unitCost: toNumber(unitCost(e.itemId)),
        extendedCost: toNumber(mul(e.extendedQty, e.hasChildren ? 0n : unitCost(e.itemId))),
        parentKey,
        hasChildren: e.hasChildren,
      });
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not explode BOM";
  }
  const top = rolled.get(bom.item_id);
  const lineDetail = lines.map((l) => {
    const it = byId.get(l.component_item_id);
    const gross = grossComponentQty(dec(1), dec(l.quantity_per), dec(l.scrap_pct));
    return {
      ...l,
      sku: it?.sku ?? "?",
      name: it?.name ?? "",
      type: it?.item_type ?? "",
      uom: it?.uom ?? "ea",
      unitCost: toNumber(unitCost(l.component_item_id)),
      extendedCost: toNumber(mul(gross, unitCost(l.component_item_id))),
    };
  });
  const usedIn = whereUsed(bom.item_id, released).map((u) => ({ ...u, sku: byId.get(u.assemblyId)?.sku ?? "?", name: byId.get(u.assemblyId)?.name ?? "" }));
  const revisions = await db.query<{ id: string; revision: string; status: string; effective_from: string | null; effective_to: string | null }>(
    `select id, revision, status, effective_from::text, effective_to::text from boms where item_id = $1 order by created_at desc`,
    [bom.item_id],
  );
  const changes = await db.query<{ id: string; change_number: string; title: string; status: string }>(
    `select id, change_number, title, status from engineering_changes where bom_id = $1 or item_id = $2 order by created_at desc`,
    [id, bom.item_id],
  );
  const components = await db.query<{ id: string; sku: string; name: string }>(
    `select id, sku, name from items where organization_id = $1 and id <> $2 and lifecycle_status <> 'obsolete' order by sku`,
    [ctx.orgId, bom.item_id],
  );
  const history = await getActivity(db, ctx, { entityType: "bom", entityId: id, limit: 30 });
  return {
    bom,
    lines: lineDetail,
    tree,
    error,
    cost: { material: top ? toNumber(top.material) : 0, labor: top ? toNumber(top.labor) : 0, total: top ? toNumber(top.total) : 0, standard: num(byId.get(bom.item_id)?.standard_cost ?? "0") },
    usedIn,
    revisions,
    changes,
    components,
    history,
  };
}

export async function listEngineeringChanges(db: Sql, ctx: ServiceContext) {
  authorize(ctx, "engineering.view");
  return db.query<{ id: string; change_number: string; title: string; reason: string | null; status: string; priority: string; sku: string; item_id: string; from_revision: string | null; to_revision: string; bom_id: string | null; requested_by: string | null; approved_by: string | null; created_at: Date; implemented_at: Date | null }>(
    `select e.id, e.change_number, e.title, e.reason, e.status, e.priority, i.sku, i.id as item_id, e.from_revision, e.to_revision, e.bom_id,
            rq.full_name as requested_by, ap.full_name as approved_by, e.created_at, e.implemented_at
     from engineering_changes e join items i on i.id = e.item_id left join profiles rq on rq.id = e.requested_by left join profiles ap on ap.id = e.approved_by
     where e.organization_id = $1 order by e.created_at desc`,
    [ctx.orgId],
  );
}
