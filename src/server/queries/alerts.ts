import type { Sql } from "../db";
import type { ServiceContext } from "../context";
import { getInventoryAlerts, type DashboardFilters } from "./dashboard";
import { formatDate } from "@/lib/format";

export interface ShellAlert {
  title: string;
  detail: string;
  href: string;
  severity: "critical" | "serious" | "warning";
}

/** Alerts for the top-bar bell: material, inbound supply and quality exceptions. */
export async function getShellAlerts(db: Sql, ctx: ServiceContext, f: DashboardFilters, canSee: (p: string) => boolean): Promise<ShellAlert[]> {
  const out: ShellAlert[] = [];
  if (canSee("inventory.view")) {
    const inv = await getInventoryAlerts(db, ctx, f);
    out.push(...inv.filter((a) => a.severity !== "warning" || a.kind === "expiring").slice(0, 15));
  }
  if (canSee("purchasing.view")) {
    const late = await db.query<{ id: string; po_number: string; supplier: string; expected_date: string }>(
      `select po.id, po.po_number, s.name as supplier, po.expected_date::text from purchase_orders po join suppliers s on s.id = po.supplier_id
       join warehouses w on w.id = po.warehouse_id
       where po.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid) and po.status in ('approved','partially_received') and po.expected_date < $3::date
       order by po.expected_date limit 10`,
      [ctx.orgId, f.siteId, f.today],
    );
    out.push(...late.map((p) => ({ title: `${p.po_number} late from ${p.supplier}`, detail: `Expected ${formatDate(p.expected_date)}; inbound supply overdue`, href: `/purchasing/orders/${p.id}`, severity: "serious" as const })));
  }
  if (canSee("quality.view")) {
    const overdue = await db.query<{ id: string; capa_number: string; description: string; due_date: string; event_id: string | null }>(
      `select id, capa_number, description, due_date::text, quality_event_id as event_id from capa_actions
       where organization_id = $1 and status in ('open','in_progress') and due_date < $2::date order by due_date limit 10`,
      [ctx.orgId, f.today],
    );
    out.push(...overdue.map((c) => ({ title: `${c.capa_number} overdue`, detail: c.description, href: c.event_id ? `/quality/events/${c.event_id}` : "/quality", severity: "serious" as const })));
    const critical = await db.query<{ id: string; event_number: string; title: string }>(
      `select id, event_number, title from quality_events where organization_id = $1 and severity = 'critical' and status in ('open','investigating','pending_disposition') limit 5`,
      [ctx.orgId],
    );
    out.push(...critical.map((e) => ({ title: `${e.event_number} critical quality event`, detail: e.title, href: `/quality/events/${e.id}`, severity: "critical" as const })));
  }
  const rank = { critical: 0, serious: 1, warning: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
