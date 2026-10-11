"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { ActionButton, useServerAction } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { advanceEcoAction, createEcoAction } from "./actions";

export interface EcoRow {
  id: string;
  change_number: string;
  title: string;
  reason: string | null;
  status: string;
  priority: string;
  sku: string;
  item_id: string;
  from_revision: string | null;
  to_revision: string;
  bom_id: string | null;
  requested_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export function NewEcoDialog({ items }: { items: { id: string; sku: string; name: string; revision: string }[] }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [toRevision, setToRevision] = useState("");
  const [priority, setPriority] = useState("normal");
  const { pending, run } = useServerAction();
  const item = items.find((i) => i.id === itemId);
  const nextRev = (r: string) => (/^[A-Y]$/.test(r) ? String.fromCharCode(r.charCodeAt(0) + 1) : `${r}.1`);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New engineering change
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New engineering change</DialogTitle>
          <DialogDescription>For manufactured items a draft BOM revision is copied from the released one; edit it, then submit, approve and implement the change to release it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Item">
            <select
              className={selectClass}
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                const it = items.find((i) => i.id === e.target.value);
                if (it) setToRevision(nextRev(it.revision));
              }}
            >
              <option value="">Select item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name} (rev {i.revision})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`New revision${item ? ` (from ${item.revision})` : ""}`}>
              <Input value={toRevision} onChange={(e) => setToRevision(e.target.value)} />
            </Field>
            <Field label="Priority">
              <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !itemId || title.trim().length < 5 || !toRevision}
            onClick={() => run(() => createEcoAction({ itemId, title, reason, toRevision, priority: priority as "normal" }), () => setOpen(false))}
          >
            {pending && <Loader2 className="animate-spin" />}Open change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EcoTable({ rows, canManage, canRelease }: { rows: EcoRow[]; canManage: boolean; canRelease: boolean }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No engineering changes yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Change</th>
            <th className="px-2 py-2 font-medium">Item</th>
            <th className="px-2 py-2 font-medium">Revision</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Requested</th>
            <th className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2">
                <div className="font-medium">
                  {e.change_number} {e.priority !== "normal" && <StatusBadge status={e.priority} />}
                </div>
                <div className="max-w-[340px] text-xs text-muted-foreground">{e.title}</div>
              </td>
              <td className="px-2 py-2">
                <Link href={`/inventory/items/${e.item_id}`} className="hover:underline">{e.sku}</Link>
              </td>
              <td className="px-2 py-2 whitespace-nowrap">
                {e.from_revision ?? "—"} → {e.bom_id ? <Link href={`/engineering/boms/${e.bom_id}`} className="font-medium text-primary hover:underline">{e.to_revision}</Link> : e.to_revision}
              </td>
              <td className="px-2 py-2"><StatusBadge status={e.status} /></td>
              <td className="px-2 py-2 text-xs text-muted-foreground">{e.requested_by} · {formatDate(e.created_at.slice(0, 10), { year: false })}</td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-1.5">
                  {e.status === "draft" && canManage && <ActionButton size="xs" variant="outline" action={() => advanceEcoAction(e.id, "submit")}>Submit for review</ActionButton>}
                  {e.status === "in_review" && canRelease && <ActionButton size="xs" action={() => advanceEcoAction(e.id, "approve")}>Approve</ActionButton>}
                  {["in_review", "approved"].includes(e.status) && canRelease && <ActionButton size="xs" variant="ghost" action={() => advanceEcoAction(e.id, "reject")}>Reject</ActionButton>}
                  {e.status === "approved" && canRelease && (
                    <ActionButton size="xs" action={() => advanceEcoAction(e.id, "implement")} confirm={{ title: `Implement ${e.change_number}?`, description: `Releases revision ${e.to_revision} of ${e.sku} and obsoletes the current revision. Existing work orders keep their BOM snapshot.`, confirmLabel: "Implement" }}>
                      Implement
                    </ActionButton>
                  )}
                  {["draft", "in_review"].includes(e.status) && canManage && <ActionButton size="xs" variant="ghost" action={() => advanceEcoAction(e.id, "cancel")}>Cancel</ActionButton>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
