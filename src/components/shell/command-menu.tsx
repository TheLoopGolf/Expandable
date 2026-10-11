"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { QUICK_ACTIONS } from "@/lib/quick-actions";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { NAV } from "@/lib/nav";
import type { Permission } from "@/lib/permissions";
import { globalSearch, type SearchHit } from "@/app/(app)/shell-actions";
import { NAV_ICONS } from "./icons";

export function CommandMenu({ open, onOpenChange, permissions }: { open: boolean; onOpenChange: (open: boolean) => void; permissions: Permission[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => setHits(await globalSearch(query)));
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  };

  const q = query.trim().toLowerCase();
  const navItems = useMemo(
    () => NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).filter((i) => permissions.includes(i.permission) && (!q || i.title.toLowerCase().includes(q))),
    [permissions, q],
  );
  const actions = QUICK_ACTIONS.filter((a) => permissions.includes(a.permission) && (!q || a.label.toLowerCase().includes(q)));
  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.type] ??= []).push(h);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search ForgeFlow" description="Search SKUs, orders, lots, customers and suppliers, or jump to a page">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search SKU, PO, SO, WO, lot, customer, supplier…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>{pending ? "Searching…" : "No matches in this organization."}</CommandEmpty>
          {pending && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching records…
            </div>
          )}
          {Object.entries(grouped).map(([type, list]) => (
            <CommandGroup key={type} heading={type}>
              {list.map((h) => (
                <CommandItem key={h.href + h.label} value={h.href + h.label} onSelect={() => go(h.href)}>
                  <span className="font-medium">{h.label}</span>
                  <span className="truncate text-muted-foreground">{h.sublabel}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {actions.length > 0 && (
            <CommandGroup heading="Quick actions">
              {actions.map((a) => (
                <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                  <a.icon className="text-muted-foreground" />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          {navItems.length > 0 && (
            <CommandGroup heading="Go to">
              {navItems.map((i) => {
                const Icon = NAV_ICONS[i.icon];
                return (
                  <CommandItem key={i.href} value={i.title} onSelect={() => go(i.href)}>
                    {Icon && <Icon className="text-muted-foreground" />}
                    {i.title}
                    <span className="ml-auto text-xs text-muted-foreground">{i.group}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
