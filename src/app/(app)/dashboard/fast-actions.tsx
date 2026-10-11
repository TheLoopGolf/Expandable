import Link from "next/link";
import { QUICK_ACTIONS } from "@/lib/quick-actions";
import type { Permission } from "@/lib/permissions";

export function FastActions({ permissions }: { permissions: Permission[] }) {
  const actions = QUICK_ACTIONS.filter((a) => permissions.includes(a.permission));
  if (actions.length === 0) return null;
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Quick actions">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-[13px] font-medium transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground group-hover:bg-primary group-hover:text-primary-foreground">
            <a.icon className="size-4" />
          </span>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
