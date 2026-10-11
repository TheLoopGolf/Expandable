import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { toNumber } from "@/lib/decimal";
import { runMrp } from "@/lib/domain/mrp";
import { loadMrpInput } from "../services/planning";

export async function getMrpWorkbench(db: Sql, ctx: ServiceContext, opts: { siteId: string | null; horizonDays: number; itemId?: string | null }) {
  authorize(ctx, "production.view");
  const runs = await db.query<{ id: string; run_number: string; started_at: Date; horizon_days: number; summary: Record<string, number>; site: string | null; created_by: string | null }>(
    `select r.id, r.run_number, r.started_at, r.horizon_days, r.summary, s.name as site, p.full_name as created_by
     from mrp_runs r left join sites s on s.id = r.site_id left join profiles p on p.id = r.created_by
     where r.organization_id = $1 order by r.started_at desc limit 10`,
    [ctx.orgId],
  );
  const latest = runs[0] ?? null;
  const suggestions = latest
    ? await db.query<{
        id: string; suggestion_type: string; item_id: string; sku: string; name: string; uom: string; supplier: string | null; quantity: string; need_date: string;
        release_date: string; is_late: boolean; explanation: string; pegging: { type: string; ref: string; id?: string; date: string; quantity: string }[]; status: string;
        created_document_type: string | null; created_document_id: string | null; created_document_number: string | null; standard_cost: string;
      }>(
        `select s.id, s.suggestion_type, s.item_id, i.sku, i.name, i.uom, sp.name as supplier, s.quantity, s.need_date::text, s.release_date::text, s.is_late, s.explanation,
                s.pegging, s.status, s.created_document_type, s.created_document_id, s.created_document_number, i.standard_cost
         from mrp_suggestions s join items i on i.id = s.item_id left join suppliers sp on sp.id = s.supplier_id
         where s.mrp_run_id = $1 order by s.is_late desc, s.need_date, i.sku`,
        [latest.id],
      )
    : [];
  // Live time-phased projection (recomputed now, not the persisted run) for the selected item.
  const input = await loadMrpInput(db, ctx, opts.siteId);
  const live = runMrp({ ...input, horizonDays: opts.horizonDays });
  const items = new Map(input.items.map((i) => [i.id, i]));
  const plannedItems = [...live.projections.keys()].map((id) => ({ id, sku: items.get(id)?.sku ?? "?", name: items.get(id)?.name ?? "" })).sort((a, b) => a.sku.localeCompare(b.sku));
  const selected = opts.itemId && live.projections.has(opts.itemId) ? opts.itemId : (suggestions[0]?.item_id ?? plannedItems[0]?.id ?? null);
  const projection = selected ? live.projections.get(selected)! : null;
  return {
    runs,
    latest,
    suggestions: suggestions.map((s) => ({ ...s, quantity: Number(s.quantity), value: Number(s.quantity) * Number(s.standard_cost) })),
    plannedItems,
    selected,
    selectedItem: selected ? { id: selected, sku: items.get(selected)?.sku ?? "", name: items.get(selected)?.name ?? "", leadTime: items.get(selected)?.leadTimeDays ?? 0, safety: toNumber(items.get(selected)?.safetyStock ?? 0n) } : null,
    projection: projection
      ? {
          startingOnHand: toNumber(projection.startingOnHand),
          buckets: projection.buckets.map((b) => ({ weekStart: b.weekStart, gross: toNumber(b.grossRequirements), scheduled: toNumber(b.scheduledReceipts), planned: toNumber(b.plannedReceipts), projected: toNumber(b.projectedOnHand) })),
        }
      : null,
    liveCount: live.planned.length,
  };
}
