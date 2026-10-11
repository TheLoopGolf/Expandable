"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { addDays } from "@/lib/dates";
import { createCapaAction, updateQualityEventAction } from "../../actions";

export function EventStatusDialog({ id, status, eventType, disposition, rootCause }: { id: string; status: string; eventType: string; disposition: string | null; rootCause: string | null }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(status === "open" ? "investigating" : status === "investigating" ? "pending_disposition" : "closed");
  const [disp, setDisp] = useState(disposition ?? "");
  const [cause, setCause] = useState(rootCause ?? "");
  const [notes, setNotes] = useState("");
  const { pending, run } = useServerAction();
  const closing = next === "closed";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Update status</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update status</DialogTitle>
          <DialogDescription>Closing an NCR requires a disposition and closure notes; linked holds must be released (or the lot dispositioned as scrap/return) and CAPA verified first.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Status">
            <select className={selectClass} value={next} onChange={(e) => setNext(e.target.value)}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="pending_disposition">Pending disposition</option>
              <option value="closed">Closed</option>
              <option value="canceled">Canceled</option>
            </select>
          </Field>
          <Field label={`Disposition${eventType === "ncr" && closing ? " (required)" : ""}`}>
            <select className={selectClass} value={disp} onChange={(e) => setDisp(e.target.value)}>
              <option value="">—</option>
              <option value="use_as_is">Use as is</option>
              <option value="rework">Rework</option>
              <option value="scrap">Scrap</option>
              <option value="return_to_supplier">Return to supplier</option>
            </select>
          </Field>
          <Field label="Root cause">
            <Textarea rows={2} value={cause} onChange={(e) => setCause(e.target.value)} />
          </Field>
          {closing && (
            <Field label="Closure notes (required)">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => updateQualityEventAction({ id, status: next as "open", disposition: (disp || null) as "rework" | null, rootCause: cause || undefined, closureNotes: notes || undefined }),
                () => setOpen(false),
              )
            }
          >
            {pending && <Loader2 className="animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddCapaDialog({ eventId, members, today }: { eventId: string; members: { id: string; full_name: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"corrective" | "preventive">("corrective");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [due, setDue] = useState(addDays(today, 21));
  const { pending, run } = useServerAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> Add CAPA
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add corrective / preventive action</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
            </select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Owner" className="sm:col-span-2">
            <select className={selectClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Action" className="sm:col-span-2">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={pending || description.trim().length < 5} onClick={() => run(() => createCapaAction({ qualityEventId: eventId, actionType: type, description, ownerId: ownerId || null, dueDate: due }), () => setOpen(false))}>
            {pending && <Loader2 className="animate-spin" />}Add action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
