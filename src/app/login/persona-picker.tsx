"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { loginAsPersona } from "./actions";

export interface Persona {
  id: string;
  name: string;
  title: string | null;
  email: string;
  roleName: string;
  roleDescription: string;
  orgName: string;
}

export function PersonaPicker({ personas }: { personas: Persona[] }) {
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {personas.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setChosen(p.id);
              startTransition(async () => {
                const res = await loginAsPersona(p.id);
                if (res && !res.ok) toast.error(res.error);
              });
            }}
            className={cn(
              "group flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
              chosen === p.id && "border-primary",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {p.name.split(" ").map((x) => x[0]).join("")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">{p.roleName}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {p.title ?? p.email} · {p.orgName}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{p.roleDescription}</span>
            </span>
            {pending && chosen === p.id ? (
              <Loader2 className="mt-1 size-4 animate-spin text-muted-foreground" />
            ) : (
              <ArrowRight className="mt-1 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
