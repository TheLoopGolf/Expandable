import type { Database } from "../db";
import { ROLES, ROLE_KEYS } from "@/lib/permissions";
import { add, ceilUnit, dec, div, mul, round, toStr, type Dec } from "@/lib/decimal";
import { grossComponentQty, rollupCosts, type BomMap } from "@/lib/domain/bom";
import type { IsoDate } from "@/lib/dates";
import { ensureChartOfAccounts } from "../services/journal";
import { createBomTx, releaseBomTx } from "../services/engineering";
import type { ServiceContext } from "../context";
import {
  BOMS,
  CUSTOMERS,
  ITEMS,
  NORTHSTAR,
  PEOPLE,
  PRODUCTION_SITE,
  ROUTINGS,
  SITES,
  SUPPLIERS,
  WAREHOUSES,
  WEEKLY_DEMAND,
  WORK_CENTERS,
  type PersonKey,
  type SeedItem,
} from "./data";
import { SeedClock, seedContext } from "./util";

export interface WorldItem extends SeedItem {
  id: string;
  standardCost: Dec;
}

export interface Stocking {
  itemId: string;
  warehouseId: string;
  weekly: Dec;
  safety: Dec;
  reorderPoint: Dec;
  target: Dec;
}

export interface World {
  org: { id: string; name: string; timezone: string };
  people: Record<PersonKey, { id: string; name: string }>;
  ctx: Record<PersonKey, ServiceContext>;
  sites: Record<string, string>;
  warehouses: Record<string, { id: string; siteCode: string }>;
  bins: Record<string, string[]>;
  workCenters: Record<string, string>;
  suppliers: Record<string, string>;
  customers: { id: string; code: string; name: string }[];
  items: Record<string, WorldItem>;
  itemsById: Map<string, WorldItem>;
  bomMap: BomMap;
  stocking: Stocking[];
  materialWarehouse: Record<"MPL" | "RST", string>;
}

export async function upsertRoles(db: Database) {
  let order = 0;
  for (const key of ROLE_KEYS) {
    const r = ROLES[key];
    await db.query(
      `insert into roles (key, name, description, permissions, sort_order) values ($1, $2, $3, $4::text[], $5)
       on conflict (key) do update set name = excluded.name, description = excluded.description,
         permissions = excluded.permissions, sort_order = excluded.sort_order`,
      [key, r.name, r.description, `{${r.permissions.join(",")}}`, order++],
    );
  }
}

export async function createNorthstarMaster(db: Database, clock: SeedClock, bomReleaseDate: IsoDate): Promise<World> {
  const [org] = await db.query<{ id: string }>(
    `insert into organizations (name, slug, timezone, is_demo, settings) values ($1, $2, $3, true, $4::jsonb) returning id`,
    [
      NORTHSTAR.name,
      NORTHSTAR.slug,
      NORTHSTAR.timezone,
      JSON.stringify({ features: { allowPartialShipments: true, mrpIncludeDraftSupply: true, autoInvoiceOnShipment: true, requireIncomingInspection: false } }),
    ],
  );
  const orgRef = { id: org.id, name: NORTHSTAR.name, timezone: NORTHSTAR.timezone };
  await db.transaction((tx) => ensureChartOfAccounts(tx, org.id));

  const sites: Record<string, string> = {};
  for (const s of SITES) {
    const [row] = await db.query<{ id: string }>(
      `insert into sites (organization_id, code, name, timezone, address) values ($1,$2,$3,$4,$5) returning id`,
      [org.id, s.code, s.name, NORTHSTAR.timezone, s.address],
    );
    sites[s.code] = row.id;
  }

  const people = {} as World["people"];
  for (const p of PEOPLE) {
    const [row] = await db.query<{ id: string }>(
      `insert into profiles (email, full_name, title) values ($1,$2,$3)
       on conflict (email) do update set full_name = excluded.full_name returning id`,
      [p.email, p.name, p.title],
    );
    people[p.key] = { id: row.id, name: p.name };
    await db.query(`insert into memberships (organization_id, profile_id, role_key, default_site_id) values ($1,$2,$3,$4)`, [
      org.id,
      row.id,
      p.role,
      sites.MPL,
    ]);
  }

  const warehouses: World["warehouses"] = {};
  const bins: World["bins"] = {};
  for (const w of WAREHOUSES) {
    const [row] = await db.query<{ id: string }>(
      `insert into warehouses (organization_id, site_id, code, name, kind) values ($1,$2,$3,$4,$5) returning id`,
      [org.id, sites[w.site], w.code, w.name, w.kind],
    );
    warehouses[w.code] = { id: row.id, siteCode: w.site };
    bins[w.code] = [];
    for (const b of w.bins) {
      const [bin] = await db.query<{ id: string }>(
        `insert into bins (organization_id, warehouse_id, code, description) values ($1,$2,$3,$4) returning id`,
        [org.id, row.id, b, b === "RECV" || b === "DOCK" ? "Receiving dock" : b === "SHIP" ? "Shipping staging" : null],
      );
      if (b !== "RECV" && b !== "DOCK" && b !== "SHIP") bins[w.code].push(bin.id);
    }
  }

  const workCenters: Record<string, string> = {};
  for (const wc of WORK_CENTERS) {
    const [row] = await db.query<{ id: string }>(
      `insert into work_centers (organization_id, site_id, code, name, kind, capacity_hours_per_day, hourly_rate) values ($1,$2,$3,$4,$5,$6::numeric,$7::numeric) returning id`,
      [org.id, sites[wc.site], wc.code, wc.name, wc.kind, wc.hours, wc.rate],
    );
    workCenters[wc.code] = row.id;
  }

  const suppliers: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const [row] = await db.query<{ id: string }>(
      `insert into suppliers (organization_id, code, name, contact_name, email, phone, payment_terms_days, default_lead_time_days, rating)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric) returning id`,
      [org.id, s.code, s.name, s.contact, `orders@${s.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, "+1 555 01" + String(SUPPLIERS.indexOf(s)).padStart(2, "0"), s.terms, s.lead, s.rating],
    );
    suppliers[s.code] = row.id;
  }

  const customers: World["customers"] = [];
  for (const c of CUSTOMERS) {
    const [row] = await db.query<{ id: string }>(
      `insert into customers (organization_id, code, name, contact_name, email, segment, payment_terms_days, credit_limit, ship_to)
       values ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9) returning id`,
      [org.id, c.code, c.name, "Purchasing Desk", `purchasing@${c.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, c.segment, c.terms, c.credit, `${c.name}, Receiving Dock`],
    );
    customers.push({ id: row.id, code: c.code, name: c.name });
  }

  // Items (manufactured costs are rolled up after BOMs exist)
  const items: Record<string, WorldItem> = {};
  for (const it of ITEMS) {
    const [row] = await db.query<{ id: string }>(
      `insert into items (organization_id, sku, name, item_type, category, product_family, uom, revision, standard_cost, list_price,
         preferred_supplier_id, lead_time_days, min_order_qty, tracking, shelf_life_days, default_warehouse_id)
       values ($1,$2,$3,$4,$5,$6,$7,'A',$8::numeric,$9::numeric,$10,$11,$12::numeric,$13,$14,$15) returning id`,
      [
        org.id, it.sku, it.name, it.type, it.category, it.family ?? null, it.uom ?? "ea", it.cost ?? "0", it.price ?? null,
        it.supplier ? suppliers[it.supplier] : null, it.lead, it.moq, it.tracking ?? "none", it.shelfLife ?? null, warehouses[it.wh].id,
      ],
    );
    items[it.sku] = { ...it, id: row.id, standardCost: dec(it.cost ?? "0") };
  }
  const itemsById = new Map(Object.values(items).map((i) => [i.id, i]));

  for (const [sku, ops] of Object.entries(ROUTINGS)) {
    let seq = 10;
    for (const [wc, setup, run, description] of ops) {
      await db.query(
        `insert into routing_operations (organization_id, item_id, seq, work_center_id, description, setup_hours, run_hours_per_unit)
         values ($1,$2,$3,$4,$5,$6::numeric,$7::numeric)`,
        [org.id, items[sku].id, seq, workCenters[wc], description, setup, run],
      );
      seq += 10;
    }
  }

  clock.set(new Date(`${bomReleaseDate}T15:00:00Z`));
  const engCtx = seedContext(clock, orgRef, people.jordan);
  // Create BOMs bottom-up (subassemblies first) so cycle checks see a consistent graph.
  const order = Object.keys(BOMS).sort((a, b) => Number(a.startsWith("FG-")) - Number(b.startsWith("FG-")));
  for (const sku of order) {
    await db.transaction(async (tx) => {
      const bom = await createBomTx(tx, engCtx, {
        itemId: items[sku].id,
        revision: "A",
        effectiveFrom: bomReleaseDate,
        notes: "Initial production release",
        lines: BOMS[sku].map(([c, q, s]) => ({ componentItemId: items[c].id, quantityPer: q, scrapPct: s ?? "0", reference: undefined })),
      });
      await releaseBomTx(tx, engCtx, bom.id);
    });
  }

  const bomMap: BomMap = new Map();
  for (const [sku, lines] of Object.entries(BOMS)) {
    bomMap.set(
      items[sku].id,
      lines.map(([c, q, s]) => ({ componentItemId: items[c].id, quantityPer: dec(q), scrapPct: dec(s ?? "0") })),
    );
  }

  // Standard cost roll-up: material + labor (setup amortized over the minimum batch).
  const rates = new Map<string, Dec>(WORK_CENTERS.map((w) => [w.code, dec(w.rate)]));
  const labor = (itemId: string): Dec => {
    const item = itemsById.get(itemId)!;
    const ops = ROUTINGS[item.sku] ?? [];
    let total = 0n;
    for (const [wc, setup, run] of ops) {
      const perUnit = add(div(dec(setup), dec(item.moq)), dec(run));
      total = add(total, mul(perUnit, rates.get(wc)!));
    }
    return total;
  };
  const rolled = rollupCosts(itemsById.keys(), bomMap, (id) => itemsById.get(id)!.standardCost, labor);
  for (const item of Object.values(items)) {
    if (item.type !== "manufactured") continue;
    const cost = round(rolled.get(item.id)!.total, 2);
    item.standardCost = cost;
    await db.query(`update items set standard_cost = $2::numeric where id = $1`, [item.id, toStr(cost, 2)]);
  }

  // Stocking parameters from expected weekly demand exploded through the BOMs per site.
  const materialWarehouse = { MPL: warehouses["MPL-STORES"].id, RST: warehouses["RST-MAIN"].id };
  const usage = new Map<string, Dec>(); // `${itemId}:${whId}` -> weekly usage
  const addUsage = (itemId: string, whId: string, q: Dec) => {
    const k = `${itemId}:${whId}`;
    usage.set(k, add(usage.get(k) ?? 0n, q));
  };
  const explode = (itemId: string, q: Dec) => {
    const item = itemsById.get(itemId)!;
    const site = PRODUCTION_SITE[item.sku];
    for (const line of bomMap.get(itemId) ?? []) {
      const need = grossComponentQty(q, line.quantityPer, line.scrapPct);
      addUsage(line.componentItemId, materialWarehouse[site], need);
      if (bomMap.has(line.componentItemId)) explode(line.componentItemId, need);
    }
  };
  for (const [sku, weekly] of Object.entries(WEEKLY_DEMAND)) {
    addUsage(items[sku].id, warehouses[items[sku].wh].id, dec(weekly));
    explode(items[sku].id, dec(weekly));
  }

  const stocking: Stocking[] = [];
  const perItem = new Map<string, { rop: Dec; safety: Dec }>();
  for (const [key, weekly] of usage) {
    const [itemId, warehouseId] = key.split(":");
    const item = itemsById.get(itemId)!;
    const safety = ceilUnit(mul(weekly, dec("0.6")));
    const leadWeeks = div(dec(item.lead), dec(7));
    const reorderPoint = ceilUnit(add(mul(weekly, leadWeeks), safety));
    const weeksCover = item.type === "manufactured" ? dec("1.5") : dec(3);
    const lot = dec(item.moq) > mul(weekly, weeksCover) ? dec(item.moq) : ceilUnit(mul(weekly, weeksCover));
    const target = add(reorderPoint, lot);
    stocking.push({ itemId, warehouseId, weekly, safety, reorderPoint, target });
    const agg = perItem.get(itemId) ?? { rop: 0n, safety: 0n };
    perItem.set(itemId, { rop: add(agg.rop, reorderPoint), safety: add(agg.safety, safety) });
  }
  for (const [itemId, agg] of perItem) {
    await db.query(`update items set reorder_point = $2::numeric, safety_stock = $3::numeric where id = $1`, [itemId, toStr(agg.rop), toStr(agg.safety)]);
  }

  const ctx = {} as World["ctx"];
  for (const p of PEOPLE) ctx[p.key] = seedContext(clock, orgRef, people[p.key]);

  return {
    org: orgRef,
    people,
    ctx,
    sites,
    warehouses,
    bins,
    workCenters,
    suppliers,
    customers,
    items,
    itemsById,
    bomMap,
    stocking,
    materialWarehouse,
  };
}
