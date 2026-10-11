import Link from "next/link";
import { ArrowRight, CircleAlert, Clock3, PackageX, ShieldAlert, TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityItem, InventoryAlert, QueueRow } from "@/server/queries/dashboard";

export function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      {children}
      <ArrowRight className="size-3" />
    </Link>
  );
}

export function ProductionQueue({ rows, today }: { rows: QueueRow[]; today: string }) {
  if (rows.length === 0) return <EmptyState title="No open work orders" description="Released and in-progress work orders appear here." className="m-4" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Work order</th>
            <th className="px-2 py-2 font-medium">Product</th>
            <th className="px-2 py-2 text-right font-medium">Qty</th>
            <th className="w-36 px-2 py-2 font-medium">Progress</th>
            <th className="px-2 py-2 font-medium">Due</th>
            <th className="px-2 py-2 font-medium">Line</th>
            <th className="px-2 py-2 font-medium">Blocker</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href={`/production/work-orders/${r.id}`} className="font-medium text-primary hover:underline">
                  {r.number}
                </Link>
              </td>
              <td className="max-w-[220px] px-2 py-2">
                <div className="font-medium">{r.sku}</div>
                <div className="truncate text-xs text-muted-foreground">{r.itemName}</div>
              </td>
              <td className="px-2 py-2 text-right tabular">{formatNumber(r.planned, 0)}</td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-2">
                  <Progress value={r.progress} className="h-1.5" aria-label={`${r.number} progress`} />
                  <span className="w-9 text-right text-xs tabular text-muted-foreground">{r.progress.toFixed(0)}%</span>
                </div>
              </td>
              <td className={cn("px-2 py-2 whitespace-nowrap tabular", r.late && "font-medium text-destructive")}>{formatDate(r.dueDate, { year: false })}</td>
              <td className="px-2 py-2 text-xs whitespace-nowrap text-muted-foreground">{r.workCenter ?? "—"}</td>
              <td className="max-w-[220px] px-2 py-2 text-xs">
                {r.blocker ? (
                  <span className="inline-flex items-start gap-1 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span className="line-clamp-2">{r.blocker}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                <StatusBadge status={r.status} late={r.late && r.status !== "draft"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">As of {today}</span>
    </div>
  );
}

const ALERT_ICON = {
  critical_shortage: PackageX,
  shortage: PackageX,
  below_safety: CircleAlert,
  expiring: Clock3,
  expired: Clock3,
  on_hold: ShieldAlert,
  unallocated: CircleAlert,
} as const;

const ALERT_LABEL = {
  critical_shortage: "Critical shortage",
  shortage: "Shortage",
  below_safety: "Below safety stock",
  expiring: "Expiring soon",
  expired: "Expired",
  on_hold: "Held stock",
  unallocated: "Unallocated",
} as const;

export function AlertsList({ alerts, limit = 9 }: { alerts: InventoryAlert[]; limit?: number }) {
  if (alerts.length === 0) return <EmptyState title="No inventory alerts" description="Stock covers all open demand." className="m-4" />;
  return (
    <ul className="divide-y">
      {alerts.slice(0, limit).map((a, i) => {
        const Icon = ALERT_ICON[a.kind];
        return (
          <li key={i}>
            <Link href={a.href} className="flex gap-3 px-4 py-2.5 hover:bg-muted/40">
              <Icon
                className="mt-0.5 size-4 shrink-0"
                style={{ color: `var(--status-${a.severity === "critical" ? "critical" : a.severity === "serious" ? "serious" : "warning"})` }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium">
                  {a.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{ALERT_LABEL[a.kind]}</span> · {a.detail}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
      {alerts.length > limit && <li className="px-4 py-2 text-xs text-muted-foreground">+{alerts.length - limit} more alerts</li>}
    </ul>
  );
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchasing/orders/${id}`,
  sales_order: (id) => `/sales/orders/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  item: (id) => `/inventory/items/${id}`,
  quality_event: (id) => `/quality/events/${id}`,
  bom: (id) => `/engineering/boms/${id}`,
  engineering_change: () => `/engineering/changes`,
  mrp_run: () => `/planning/mrp`,
  invoice: () => `/finance?tab=invoices`,
  supplier_bill: () => `/finance?tab=payables`,
  lot: () => `/inventory/lots`,
  capa: () => `/quality`,
  inspection: () => `/quality?tab=inspections`,
};

export function entityHref(type: string, id: string | null) {
  if (!id) return null;
  return ENTITY_HREF[type]?.(id) ?? null;
}

export function ActivityFeed({ items, now }: { items: ActivityItem[]; now: Date }) {
  if (items.length === 0) return <EmptyState title="No activity yet" className="m-4" />;
  return (
    <ol className="divide-y">
      {items.map((a) => {
        const href = entityHref(a.entityType, a.entityId);
        return (
          <li key={a.id} className="flex gap-3 px-4 py-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-snug">
                {href ? (
                  <Link href={href} className="hover:underline">
                    {a.summary}
                  </Link>
                ) : (
                  a.summary
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {a.actor} · <time dateTime={a.occurredAt}>{formatRelative(a.occurredAt, now)}</time>
                {a.seed && <span className="ml-1.5 rounded bg-secondary px-1 py-px text-[10px]">demo history</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
