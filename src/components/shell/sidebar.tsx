"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { NAV, isActive } from "@/lib/nav";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ICONS } from "./icons";
import { Logo } from "./logo";

export function SidebarNav({
  permissions,
  collapsed,
  onNavigate,
}: {
  permissions: Permission[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-2.5 py-3">
      {NAV.map((group) => {
        const items = group.items.filter((i) => permissions.includes(i.permission));
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const active = isActive(pathname, item);
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {Icon && <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />}
                    {!collapsed && <span className="truncate">{item.title}</span>}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.title}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function DesktopSidebar({
  permissions,
  collapsed,
  onToggle,
  footer,
}: {
  permissions: Permission[];
  collapsed: boolean;
  onToggle: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-sidebar-border px-3.5", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" aria-label="ForgeFlow home">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav permissions={permissions} collapsed={collapsed} />
      </div>
      {!collapsed && footer}
      <div className={cn("border-t border-sidebar-border p-2", collapsed && "flex justify-center")}>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft className="size-4" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
