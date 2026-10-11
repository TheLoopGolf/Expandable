"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, RotateCcw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import { Field, selectClass } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ROLES, ROLE_KEYS } from "@/lib/permissions";
import type { AuditRow } from "@/server/queries/settings";
import { addMemberAction, auditDetailAction, resetDemoDataAction, updateMemberAction, updateOrganizationAction } from "./actions";

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
export function OrganizationForm({
  org,
  flags,
  canEdit,
}: {
  org: { name: string; timezone: string; features: Record<string, boolean> };
  flags: { key: string; label: string }[];
  canEdit: boolean;
}) {
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [features, setFeatures] = useState(org.features);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useServerAction();
  const dirty = name !== org.name || timezone !== org.timezone || flags.some((f) => features[f.key] !== org.features[f.key]);

  const save = () => {
    setErrors({});
    run(async () => {
      const res = await updateOrganizationAction({ name, timezone, features });
      if (!res.ok && res.fieldErrors) setErrors(res.fieldErrors);
      return res;
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Organization profile</h2>
          <p className="text-xs text-muted-foreground">The timezone defines business dates for every transaction, KPI and report.</p>
        </div>
        <Field label="Name" htmlFor="org-name" error={errors.name}>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Timezone (IANA)" htmlFor="org-tz" error={errors.timezone} hint="For example America/Chicago or Europe/Berlin">
          <Input id="org-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Operating policies</h2>
          <p className="text-xs text-muted-foreground">Enforced by the server on every transaction, not only in the UI.</p>
        </div>
        {flags.map((f) => (
          <label key={f.key} className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
            <span className="text-[13px] leading-snug">{f.label}</span>
            <Switch checked={!!features[f.key]} onCheckedChange={(v) => setFeatures((s) => ({ ...s, [f.key]: v }))} disabled={!canEdit} aria-label={f.label} />
          </label>
        ))}
      </div>
      {canEdit && (
        <div className="flex justify-end gap-2 lg:col-span-2">
          <Button
            variant="outline"
            disabled={!dirty || pending}
            onClick={() => {
              setName(org.name);
              setTimezone(org.timezone);
              setFeatures(org.features);
            }}
          >
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending && <Loader2 className="animate-spin" />}Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
export interface MemberRow {
  profile_id: string;
  full_name: string;
  email: string;
  title: string | null;
  role_key: string;
  is_active: boolean;
  joined: string;
  last_action: string | null;
}

function MemberControls({ m, isSelf }: { m: MemberRow; isSelf: boolean }) {
  const { pending, run } = useServerAction();
  return (
    <div className="flex items-center gap-2">
      <select
        className={`${selectClass} w-40`}
        value={m.role_key}
        disabled={pending || isSelf}
        aria-label={`Role for ${m.full_name}`}
        onChange={(e) => run(() => updateMemberAction(m.profile_id, e.target.value, m.is_active))}
      >
        {ROLE_KEYS.map((r) => (
          <option key={r} value={r}>
            {ROLES[r].name}
          </option>
        ))}
      </select>
      <Switch
        checked={m.is_active}
        disabled={pending || isSelf}
        aria-label={`${m.full_name} active`}
        onCheckedChange={(v) => run(() => updateMemberAction(m.profile_id, m.role_key, v))}
      />
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}

export function MembersTable({ rows, canManage, selfId }: { rows: MemberRow[]; canManage: boolean; selfId: string }) {
  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.full_name}
              {row.original.profile_id === selfId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
            </div>
            <div className="text-xs text-muted-foreground">{row.original.title ?? "—"}</div>
          </div>
        ),
      },
      { accessorKey: "email", header: "Email" },
      {
        id: "role",
        accessorFn: (r) => r.role_key,
        header: "Role",
        meta: { csv: (r) => ROLES[r.role_key as keyof typeof ROLES]?.name ?? r.role_key },
        cell: ({ row }) =>
          canManage ? (
            <MemberControls m={row.original} isSelf={row.original.profile_id === selfId} />
          ) : (
            <span>{ROLES[row.original.role_key as keyof typeof ROLES]?.name ?? row.original.role_key}</span>
          ),
      },
      {
        id: "status",
        accessorFn: (r) => (r.is_active ? "active" : "inactive"),
        header: "Status",
        meta: { csv: (r) => (r.is_active ? "Active" : "Inactive") },
        cell: ({ row }) => (row.original.is_active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>),
      },
      {
        accessorKey: "last_action",
        header: "Last activity",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.last_action ? formatRelative(row.original.last_action) : "—"}</span>,
      },
    ],
    [canManage, selfId],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      csvName="members"
      syncUrl={false}
      searchPlaceholder="Search name or email…"
      filters={[
        { id: "role", label: "Role", options: ROLE_KEYS.map((r) => ({ value: r, label: ROLES[r].name })) },
        { id: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
      ]}
      toolbar={canManage ? <AddMemberDialog /> : undefined}
    />
  );
}

function AddMemberDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", title: "", role: "viewer" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useServerAction();
  const submit = () => {
    setErrors({});
    run(
      async () => {
        const res = await addMemberAction({ ...form, title: form.title || undefined, role: form.role as (typeof ROLE_KEYS)[number] });
        if (!res.ok && res.fieldErrors) setErrors(res.fieldErrors);
        return res;
      },
      () => {
        setOpen(false);
        setForm({ fullName: "", email: "", title: "", role: "viewer" });
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            In demo mode the new person appears on the sign-in screen. With Supabase auth they sign in with the same email address.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Full name" htmlFor="m-name" error={errors.fullName}>
            <Input id="m-name" value={form.fullName} onChange={(e) => setForm((s) => ({ ...s, fullName: e.target.value }))} />
          </Field>
          <Field label="Email" htmlFor="m-email" error={errors.email}>
            <Input id="m-email" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
          </Field>
          <Field label="Job title (optional)" htmlFor="m-title">
            <Input id="m-title" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
          </Field>
          <Field label="Role" htmlFor="m-role" hint={ROLES[form.role as keyof typeof ROLES]?.description}>
            <select id="m-role" className={selectClass} value={form.role} onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
const ENTITY_HREF: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchasing/orders/${id}`,
  sales_order: (id) => `/sales/orders/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  item: (id) => `/inventory/items/${id}`,
  bom: (id) => `/engineering/boms/${id}`,
  quality_event: (id) => `/quality/events/${id}`,
};

type AuditDetail = { before: unknown; after: unknown; metadata: unknown };

function AuditDiff({ id }: { id: string }) {
  const [data, setData] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <Dialog
      onOpenChange={async (o) => {
        if (!o || data) return;
        setLoading(true);
        const res = await auditDetailAction(id);
        setLoading(false);
        if (res.ok) setData((res.data as AuditDetail | null) ?? { before: null, after: null, metadata: null });
        else toast.error(res.error);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change details</DialogTitle>
          <DialogDescription>Recorded values before and after the change, plus context captured with the event.</DialogDescription>
        </DialogHeader>
        {loading || !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(["before", "after"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 text-xs font-medium text-muted-foreground capitalize">{k}</div>
                <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">{data[k] ? JSON.stringify(data[k], null, 2) : "—"}</pre>
              </div>
            ))}
            {data.metadata ? (
              <div className="md:col-span-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Context</div>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(data.metadata, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AuditTable({ rows, timezone }: { rows: AuditRow[]; timezone: string }) {
  const entityTypes = useMemo(() => [...new Set(rows.map((r) => r.entity_type))].sort(), [rows]);
  const actors = useMemo(() => [...new Set(rows.map((r) => r.actor_name))].sort(), [rows]);
  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        accessorKey: "occurred_at",
        header: "When",
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.occurred_at, timezone)}</span>,
      },
      { accessorKey: "actor_name", header: "User" },
      {
        accessorKey: "summary",
        header: "Change",
        cell: ({ row }) => {
          const r = row.original;
          const href = r.entity_id ? ENTITY_HREF[r.entity_type]?.(r.entity_id) : null;
          return (
            <div className="min-w-[280px]">
              <div>
                {r.summary}
                {r.seeded && (
                  <Badge variant="outline" className="ml-1.5 align-middle text-[10px]" title="Generated by the demo seed, not entered by a person">
                    seeded
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {r.action}
                {r.entity_number && (
                  <>
                    {" · "}
                    {href ? (
                      <Link href={href} className="text-primary hover:underline">
                        {r.entity_number}
                      </Link>
                    ) : (
                      r.entity_number
                    )}
                  </>
                )}
              </div>
            </div>
          );
        },
      },
      { id: "entity", accessorFn: (r) => r.entity_type, header: "Record type", cell: ({ getValue }) => String(getValue()).replace(/_/g, " ") },
      { id: "actor", accessorFn: (r) => r.actor_name, header: "Actor" },
      { id: "origin", accessorFn: (r) => (r.seeded ? "seeded" : "user"), header: "Origin" },
      {
        id: "details",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (row.original.has_diff ? <AuditDiff id={row.original.id} /> : null),
      },
    ],
    [timezone],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      csvName="audit-trail"
      searchPlaceholder="Search changes, records, users…"
      hiddenColumns={["actor", "origin"]}
      filters={[
        { id: "entity", label: "Record type", options: entityTypes.map((e) => ({ value: e, label: e.replace(/_/g, " ") })) },
        { id: "actor", label: "User", options: actors.map((a) => ({ value: a, label: a })) },
        { id: "origin", label: "Origin", options: [{ value: "user", label: "Entered in the app" }, { value: "seeded", label: "Seeded demo history" }] },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Demo data reset
// ---------------------------------------------------------------------------
export function ResetDemoData() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    try {
      const res = await resetDemoDataAction(text);
      // On success the action redirects to the sign-in page.
      if (res && !res.ok) toast.error(res.error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && (setOpen(o), setText(""))}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <RotateCcw /> Reset demo data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset all demo data?</DialogTitle>
          <DialogDescription>
            Every organization, transaction and member in this database is deleted and the 180-day sample history is regenerated up to today. This takes
            about a minute, and everyone is signed out.
          </DialogDescription>
        </DialogHeader>
        <Field label='Type "RESET" to confirm' htmlFor="reset-confirm">
          <Input id="reset-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" disabled={pending} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending || text.trim() !== "RESET"}>
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "Rebuilding…" : "Reset data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
