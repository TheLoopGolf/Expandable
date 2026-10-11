"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current";
import { clearSession, writePreference, ORG_COOKIE, RANGE_COOKIE, SITE_COOKIE } from "@/server/auth/session";
import { config } from "@/server/config";
import { isRangeKey } from "@/lib/dates";

export async function switchOrganization(orgId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Only organizations the user is an active member of can be selected.
  if (!user.memberships.some((m) => m.orgId === orgId)) return { ok: false as const, error: "You are not a member of that organization." };
  await writePreference(ORG_COOKIE, orgId);
  await writePreference(SITE_COOKIE, "all");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setSitePreference(siteId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (siteId !== "all" && !user.sites.some((s) => s.id === siteId)) return { ok: false as const, error: "Unknown site." };
  await writePreference(SITE_COOKIE, siteId);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setRangePreference(range: string) {
  if (!isRangeKey(range)) return { ok: false as const, error: "Unknown range." };
  await writePreference(RANGE_COOKIE, range);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function signOut() {
  if (config.authMode === "supabase") {
    const { supabaseServerClient } = await import("@/server/auth/supabase");
    const supabase = await supabaseServerClient();
    await supabase.auth.signOut();
  }
  await clearSession();
  redirect("/login");
}

export interface SearchHit {
  type: string;
  label: string;
  sublabel: string;
  href: string;
}

/** Global search across records the signed-in user's organization owns. */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const db = await getDb();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const can = (p: string) => user.permissions.includes(p as never);
  const hits: SearchHit[] = [];
  const org = user.ctx.orgId;
  if (can("inventory.view")) {
    const items = await db.query<{ id: string; sku: string; name: string }>(
      `select id, sku, name from items where organization_id = $1 and (sku ilike $2 or name ilike $2) order by sku limit 6`,
      [org, like],
    );
    hits.push(...items.map((i) => ({ type: "Item", label: i.sku, sublabel: i.name, href: `/inventory/items/${i.id}` })));
    const lots = await db.query<{ lot_number: string; sku: string; status: string }>(
      `select l.lot_number, i.sku, l.status from inventory_lots l join items i on i.id = l.item_id where l.organization_id = $1 and l.lot_number ilike $2 order by l.created_at desc limit 5`,
      [org, like],
    );
    hits.push(...lots.map((l) => ({ type: "Lot", label: l.lot_number, sublabel: `${l.sku} · ${l.status}`, href: `/inventory/lots?lot=${encodeURIComponent(l.lot_number)}` })));
  }
  if (can("sales.view")) {
    const sos = await db.query<{ id: string; so_number: string; name: string; status: string }>(
      `select so.id, so.so_number, c.name, so.status from sales_orders so join customers c on c.id = so.customer_id
       where so.organization_id = $1 and (so.so_number ilike $2 or c.name ilike $2 or so.customer_po ilike $2) order by so.order_date desc limit 6`,
      [org, like],
    );
    hits.push(...sos.map((s) => ({ type: "Sales order", label: s.so_number, sublabel: `${s.name} · ${s.status.replace("_", " ")}`, href: `/sales/orders/${s.id}` })));
    const cs = await db.query<{ id: string; code: string; name: string }>(
      `select id, code, name from customers where organization_id = $1 and (code ilike $2 or name ilike $2) limit 4`,
      [org, like],
    );
    hits.push(...cs.map((c) => ({ type: "Customer", label: c.name, sublabel: c.code, href: `/sales/customers?customer=${c.id}` })));
  }
  if (can("purchasing.view")) {
    const pos = await db.query<{ id: string; po_number: string; name: string; status: string }>(
      `select po.id, po.po_number, s.name, po.status from purchase_orders po join suppliers s on s.id = po.supplier_id
       where po.organization_id = $1 and (po.po_number ilike $2 or s.name ilike $2) order by po.order_date desc limit 6`,
      [org, like],
    );
    hits.push(...pos.map((p) => ({ type: "Purchase order", label: p.po_number, sublabel: `${p.name} · ${p.status.replace("_", " ")}`, href: `/purchasing/orders/${p.id}` })));
    const ss = await db.query<{ id: string; code: string; name: string }>(
      `select id, code, name from suppliers where organization_id = $1 and (code ilike $2 or name ilike $2) limit 4`,
      [org, like],
    );
    hits.push(...ss.map((s) => ({ type: "Supplier", label: s.name, sublabel: s.code, href: `/purchasing/suppliers?supplier=${s.id}` })));
  }
  if (can("production.view")) {
    const wos = await db.query<{ id: string; wo_number: string; sku: string; status: string }>(
      `select wo.id, wo.wo_number, i.sku, wo.status from work_orders wo join items i on i.id = wo.item_id
       where wo.organization_id = $1 and (wo.wo_number ilike $2 or i.sku ilike $2) order by wo.created_at desc limit 6`,
      [org, like],
    );
    hits.push(...wos.map((w) => ({ type: "Work order", label: w.wo_number, sublabel: `${w.sku} · ${w.status.replace("_", " ")}`, href: `/production/work-orders/${w.id}` })));
  }
  if (can("quality.view")) {
    const qe = await db.query<{ id: string; event_number: string; title: string }>(
      `select id, event_number, title from quality_events where organization_id = $1 and (event_number ilike $2 or title ilike $2) order by opened_at desc limit 5`,
      [org, like],
    );
    hits.push(...qe.map((e) => ({ type: "Quality", label: e.event_number, sublabel: e.title, href: `/quality/events/${e.id}` })));
  }
  return hits;
}
