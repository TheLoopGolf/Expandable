import { formatDateTime } from "@/lib/format";
import type { ActivityItem } from "@/server/queries/dashboard";

/** Audit/business history for a record, newest first. */
export function HistoryList({ items, timeZone }: { items: ActivityItem[]; timeZone?: string }) {
  if (items.length === 0) return <div className="px-4 py-6 text-center text-xs text-muted-foreground">No history recorded.</div>;
  return (
    <ol className="relative space-y-0 px-4 py-3">
      {items.map((a, i) => (
        <li key={a.id} className="relative flex gap-3 pb-3">
          {i < items.length - 1 && <span className="absolute top-3 left-[3px] h-full w-px bg-border" aria-hidden />}
          <span className="relative mt-1.5 size-[7px] shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-[13px]">{a.summary}</div>
            <div className="text-xs text-muted-foreground">
              {a.actor} · {formatDateTime(a.occurredAt, timeZone)}
              {a.seed && <span className="ml-1.5 rounded bg-secondary px-1 text-[10px]">demo history</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
