import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getScheduleBoard } from "@/server/queries/production";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule board" };

export default async function ScheduleBoardPage() {
  const user = await requirePermission("production.view");
  const db = await getDb();
  const board = await getScheduleBoard(db, user.ctx, user.siteId, user.today);
  return (
    <>
      <PageHeader
        title="Work center queue"
        description="Open operations by work center in due-date order. Load is the sum of planned hours for operations not yet done, shown in days of rated capacity (infinite-capacity view — no automatic leveling)."
        breadcrumbs={[{ label: "Production", href: "/production" }, { label: "Schedule board" }]}
      />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {board.map((wc) => (
          <section key={wc.id} className="flex w-[290px] shrink-0 flex-col rounded-xl border bg-card" aria-label={wc.name}>
            <header className="border-b px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{wc.code}</span>
                <span className="text-xs text-muted-foreground">{wc.site}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{wc.name}</div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span>
                  {formatNumber(wc.load, 1)} h queued · {wc.ops.length} ops
                </span>
                <span className={cn("font-medium", wc.days > 5 ? "text-destructive" : wc.days > 3 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {formatNumber(wc.days, 1)} days
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", wc.days > 5 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, (wc.days / 10) * 100)}%` }} />
              </div>
            </header>
            <ol className="flex max-h-[68vh] flex-col gap-2 overflow-y-auto p-2">
              {wc.ops.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted-foreground">Queue empty</li>}
              {wc.ops.map((o) => (
                <li key={`${o.wo_id}-${o.seq}`}>
                  <Link href={`/production/work-orders/${o.wo_id}`} className={cn("block rounded-lg border bg-background p-2.5 text-xs transition-colors hover:border-primary/50", o.late && "border-l-2 border-l-destructive")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{o.wo_number}</span>
                      <StatusBadge status={o.status} late={o.late} />
                    </div>
                    <div className="mt-1 font-medium">{o.sku}</div>
                    <div className="text-muted-foreground">
                      Op {o.seq}: {o.description} · {formatNumber(o.hours, 1)} h
                    </div>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground">
                      <span>Start {formatDate(o.planned_start, { year: false })}</span>
                      <span className={o.late ? "font-medium text-destructive" : ""}>Due {formatDate(o.due_date, { year: false })}</span>
                    </div>
                    {o.blocker && (
                      <div className="mt-1.5 flex items-start gap-1 text-amber-700 dark:text-amber-300">
                        <TriangleAlert className="mt-px size-3 shrink-0" />
                        <span>{o.blocker}</span>
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
