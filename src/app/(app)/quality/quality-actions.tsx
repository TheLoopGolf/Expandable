"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { ReasonActionButton, useServerAction } from "@/components/action-button";
import { releaseHoldAction } from "../inventory/actions";
import { updateCapaAction } from "./actions";

export function ReleaseHoldButton({ holdId, lotNumber, reason }: { holdId: string; lotNumber: string; reason: string }) {
  return (
    <ReasonActionButton
      size="xs"
      title={`Release quality hold on lot ${lotNumber}`}
      description={`Hold reason: ${reason}`}
      label="Release justification (MRB decision, evidence reference)"
      minLength={10}
      confirmLabel="Release hold"
      action={(r) => releaseHoldAction(holdId, r)}
    >
      Release
    </ReasonActionButton>
  );
}

export function CapaStatusButton({ id, number, status }: { id: string; number: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(status === "open" ? "in_progress" : status === "in_progress" ? "verified" : "closed");
  const [notes, setNotes] = useState("");
  const { pending, run } = useServerAction();
  const needsNotes = next === "verified" || next === "closed";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">Update</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {number}</DialogTitle>
          <DialogDescription>Verification and closure require effectiveness evidence notes.</DialogDescription>
        </DialogHeader>
        <Field label="New status">
          <select className={selectClass} value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="verified">Verified</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Field label={needsNotes ? "Verification notes (required)" : "Notes"}>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={pending || (needsNotes && notes.trim().length < 3)} onClick={() => run(() => updateCapaAction(id, next as "open", notes), () => setOpen(false))}>
            {pending && <Loader2 className="animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
