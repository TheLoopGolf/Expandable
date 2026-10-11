import { addDays, maxDate, startOfWeek, type IsoDate } from "../dates";
import { add, ceilUnit, cmp, dec, max, sub, toStr, type Dec } from "../decimal";
import { grossComponentQty, lowLevelCodes, type BomMap } from "./bom";

export interface MrpItem {
  id: string;
  sku: string;
  name: string;
  itemType: "purchased" | "manufactured";
  leadTimeDays: number;
  safetyStock: Dec;
  minOrderQty: Dec;
  supplierId: string | null;
}

export interface MrpSourceRef {
  type: "sales_order" | "work_order" | "purchase_order" | "planned_order";
  ref: string;
  id?: string;
}

export interface MrpDemand {
  itemId: string;
  date: IsoDate;
  quantity: Dec;
  source: MrpSourceRef;
}

export interface MrpSupply {
  itemId: string;
  date: IsoDate;
  quantity: Dec;
  source: MrpSourceRef;
}

export interface MrpInput {
  today: IsoDate;
  horizonDays: number;
  items: MrpItem[];
  bomMap: BomMap;
  /** Usable on-hand (excludes held, quarantined and expired lots). */
  onHand: Map<string, Dec>;
  demands: MrpDemand[];
  supplies: MrpSupply[];
}

export interface PegEntry {
  type: MrpSourceRef["type"];
  ref: string;
  id?: string;
  date: IsoDate;
  quantity: string;
}

export interface PlannedOrder {
  itemId: string;
  type: "purchase" | "manufacture";
  supplierId: string | null;
  quantity: Dec;
  needDate: IsoDate;
  releaseDate: IsoDate;
  isLate: boolean;
  explanation: string;
  pegging: PegEntry[];
}

export interface ProjectionBucket {
  weekStart: IsoDate;
  grossRequirements: Dec;
  scheduledReceipts: Dec;
  plannedReceipts: Dec;
  projectedOnHand: Dec;
}

export interface MrpResult {
  planned: PlannedOrder[];
  projections: Map<string, { startingOnHand: Dec; buckets: ProjectionBucket[] }>;
  itemsPlanned: number;
}

const fmt = (d: Dec) => {
  const s = toStr(d, 4);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

/**
 * Time-phased MRP (lot-for-lot with minimum order quantity and safety stock).
 *
 * Items are processed in low-level-code order so dependent demand from parent planned
 * orders is known before a component is netted. Past-due demand and supply are treated
 * as due today. Suggestions are returned, never executed.
 */
export function runMrp(input: MrpInput): MrpResult {
  const { today, items, bomMap } = input;
  const horizonEnd = addDays(today, input.horizonDays);
  const llc = lowLevelCodes(
    items.map((i) => i.id),
    bomMap,
  );
  const ordered = [...items].sort(
    (a, b) => (llc.get(a.id) ?? 0) - (llc.get(b.id) ?? 0) || a.sku.localeCompare(b.sku),
  );

  const demandsByItem = new Map<string, MrpDemand[]>();
  for (const d of input.demands) {
    if (d.date > horizonEnd) continue;
    const list = demandsByItem.get(d.itemId) ?? [];
    list.push({ ...d, date: maxDate(d.date, today) });
    demandsByItem.set(d.itemId, list);
  }
  const suppliesByItem = new Map<string, MrpSupply[]>();
  for (const s of input.supplies) {
    if (s.date > horizonEnd) continue;
    const list = suppliesByItem.get(s.itemId) ?? [];
    list.push({ ...s, date: maxDate(s.date, today) });
    suppliesByItem.set(s.itemId, list);
  }

  const planned: PlannedOrder[] = [];
  const projections: MrpResult["projections"] = new Map();
  let itemsPlanned = 0;

  for (const item of ordered) {
    const demands = demandsByItem.get(item.id) ?? [];
    const supplies = suppliesByItem.get(item.id) ?? [];
    const startingOnHand = input.onHand.get(item.id) ?? 0n;
    if (demands.length === 0 && supplies.length === 0 && cmp(startingOnHand, item.safetyStock) >= 0) {
      continue;
    }
    itemsPlanned++;

    type Event = { date: IsoDate; kind: "supply" | "demand"; qty: Dec; source: MrpSourceRef };
    const events: Event[] = [
      ...supplies.map((s) => ({ date: s.date, kind: "supply" as const, qty: s.quantity, source: s.source })),
      ...demands.map((d) => ({ date: d.date, kind: "demand" as const, qty: d.quantity, source: d.source })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "supply" ? -1 : 1));

    let projected = startingOnHand;
    let pendingPegs: PegEntry[] = [];
    const itemPlanned: PlannedOrder[] = [];

    const plan = (needDate: IsoDate) => {
      const shortfall = sub(item.safetyStock, projected);
      const qty = ceilUnit(max(shortfall, item.minOrderQty));
      const releaseDate = addDays(needDate, -item.leadTimeDays);
      const isLate = releaseDate < today;
      const type = item.itemType === "manufactured" ? "manufacture" : "purchase";
      const drivers = pendingPegs.length
        ? pendingPegs
            .slice(0, 4)
            .map((p) => `${p.ref} (${fmt(dec(p.quantity))})`)
            .join(", ") + (pendingPegs.length > 4 ? ` and ${pendingPegs.length - 4} more` : "")
        : "safety stock replenishment";
      const parts = [
        `Projected balance of ${item.sku} falls to ${fmt(projected)} on ${needDate}` +
          (item.safetyStock > 0n ? ` (safety stock ${fmt(item.safetyStock)})` : "") +
          `, driven by ${drivers}.`,
        `Suggest ${type === "purchase" ? "buying" : "making"} ${fmt(qty)}` +
          (cmp(qty, ceilUnit(shortfall)) > 0 ? ` (minimum order ${fmt(item.minOrderQty)})` : "") +
          ` due ${needDate}; release by ${releaseDate} for a ${item.leadTimeDays}-day lead time.`,
      ];
      if (isLate) {
        parts.push(`Release date is ${-(addDaysDiff(releaseDate, today))} day(s) in the past — expedite or reschedule.`);
      }
      const order: PlannedOrder = {
        itemId: item.id,
        type,
        supplierId: type === "purchase" ? item.supplierId : null,
        quantity: qty,
        needDate,
        releaseDate,
        isLate,
        explanation: parts.join(" "),
        pegging: pendingPegs,
      };
      itemPlanned.push(order);
      projected = add(projected, qty);
      pendingPegs = [];

      // Dependent demand for components of a planned manufacture order, due at release.
      if (type === "manufacture") {
        for (const line of bomMap.get(item.id) ?? []) {
          const compQty = grossComponentQty(qty, line.quantityPer, line.scrapPct);
          const list = demandsByItem.get(line.componentItemId) ?? [];
          list.push({
            itemId: line.componentItemId,
            date: maxDate(releaseDate, today),
            quantity: compQty,
            source: { type: "planned_order", ref: `Planned WO ${item.sku}` },
          });
          demandsByItem.set(line.componentItemId, list);
        }
      }
    };

    if (cmp(projected, item.safetyStock) < 0) plan(today);
    for (const ev of events) {
      if (ev.kind === "supply") {
        projected = add(projected, ev.qty);
      } else {
        projected = sub(projected, ev.qty);
        pendingPegs.push({ type: ev.source.type, ref: ev.source.ref, id: ev.source.id, date: ev.date, quantity: toStr(ev.qty) });
        if (cmp(projected, item.safetyStock) < 0) plan(ev.date);
      }
    }
    planned.push(...itemPlanned);

    // Weekly time-phased projection for the workbench grid.
    const buckets: ProjectionBucket[] = [];
    let running = startingOnHand;
    const firstWeek = startOfWeek(today);
    const weeks = Math.ceil(input.horizonDays / 7) + 1;
    for (let w = 0; w < weeks; w++) {
      const weekStart = addDays(firstWeek, w * 7);
      const weekEnd = addDays(weekStart, 6);
      const inWeek = (d: IsoDate) => d >= weekStart && d <= weekEnd;
      const gross = events.filter((e) => e.kind === "demand" && inWeek(e.date)).reduce((a, e) => add(a, e.qty), 0n);
      const sched = events.filter((e) => e.kind === "supply" && inWeek(e.date)).reduce((a, e) => add(a, e.qty), 0n);
      const plannedQty = itemPlanned.filter((p) => inWeek(p.needDate)).reduce((a, p) => add(a, p.quantity), 0n);
      running = add(sub(add(running, sched), gross), plannedQty);
      buckets.push({ weekStart, grossRequirements: gross, scheduledReceipts: sched, plannedReceipts: plannedQty, projectedOnHand: running });
    }
    projections.set(item.id, { startingOnHand, buckets });
  }

  // Keep a stable, useful order: late first, then by need date.
  planned.sort((a, b) => Number(b.isLate) - Number(a.isLate) || a.needDate.localeCompare(b.needDate));
  return { planned, projections, itemsPlanned };
}

function addDaysDiff(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
