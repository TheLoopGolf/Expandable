"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, selectClass } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { copyBomRevisionAction, createBomAction, updateBomLinesAction } from "../actions";

interface Line {
  componentItemId: string;
  quantityPer: string;
  scrapPct: string;
  reference: string;
}

function LinesGrid({ lines, setLines, components }: { lines: Line[]; setLines: (l: Line[]) => void; components: { id: string; sku: string; name: string }[] }) {
  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_110px_90px_140px_36px] gap-2 px-1 text-xs text-muted-foreground sm:grid">
        <span>Component</span>
        <span>Qty per</span>
        <span>Scrap %</span>
        <span>Reference</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_110px_90px_140px_36px]">
          <select className={selectClass} value={l.componentItemId} onChange={(e) => update(i, { componentItemId: e.target.value })} aria-label={`Component ${i + 1}`}>
            <option value="">Select component…</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sku} — {c.name}
              </option>
            ))}
          </select>
          <Input inputMode="decimal" value={l.quantityPer} onChange={(e) => update(i, { quantityPer: e.target.value })} aria-label={`Quantity per for line ${i + 1}`} />
          <Input inputMode="decimal" value={l.scrapPct} onChange={(e) => update(i, { scrapPct: e.target.value })} aria-label={`Scrap percent for line ${i + 1}`} />
          <Input value={l.reference} onChange={(e) => update(i, { reference: e.target.value })} aria-label={`Reference for line ${i + 1}`} />
          <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} aria-label={`Remove line ${i + 1}`}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setLines([...lines, { componentItemId: "", quantityPer: "1", scrapPct: "0", reference: "" }])}>
        <Plus /> Add component
      </Button>
    </div>
  );
}

const toPayload = (lines: Line[]) => lines.filter((l) => l.componentItemId).map((l) => ({ componentItemId: l.componentItemId, quantityPer: l.quantityPer, scrapPct: l.scrapPct || "0", reference: l.reference || undefined }));

export function EditBomLines({ bomId, initial, components }: { bomId: string; initial: Line[]; components: { id: string; sku: string; name: string }[] }) {
  const [lines, setLines] = useState<Line[]>(initial);
  const { pending, run } = useServerAction();
  return (
    <div className="space-y-3 p-4">
      <LinesGrid lines={lines} setLines={setLines} components={components} />
      <div className="flex justify-end">
        <Button onClick={() => run(() => updateBomLinesAction(bomId, toPayload(lines)))} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}Save draft
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Circular references (an assembly that would contain itself at any level) are rejected on save.</p>
    </div>
  );
}

export function NewBomDialog({ items, components }: { items: { id: string; sku: string; name: string }[]; components: { id: string; sku: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [revision, setRevision] = useState("A");
  const [lines, setLines] = useState<Line[]>([
    { componentItemId: "", quantityPer: "1", scrapPct: "0", reference: "" },
    { componentItemId: "", quantityPer: "1", scrapPct: "0", reference: "" },
  ]);
  const { pending, run } = useServerAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New BOM
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New bill of materials</DialogTitle>
          <DialogDescription>Creates a draft revision. Release it to make it the effective BOM for new work orders.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <Field label="Manufactured item">
            <select className={selectClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Select item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Revision">
            <Input value={revision} onChange={(e) => setRevision(e.target.value)} />
          </Field>
        </div>
        <LinesGrid lines={lines} setLines={setLines} components={components.filter((c) => c.id !== itemId)} />
        <DialogFooter>
          <Button
            disabled={pending || !itemId}
            onClick={async () => {
              const ok = await run(async () => {
                const res = await createBomAction({ itemId, revision, lines: toPayload(lines) });
                if (res.ok) router.push(`/engineering/boms/${(res.data as { id: string }).id}`);
                return res;
              });
              if (ok) setOpen(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" />}Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewRevisionButton({ bomId, suggested }: { bomId: string; suggested: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState(suggested);
  const { pending, run } = useServerAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">New revision</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy to a new draft revision</DialogTitle>
          <DialogDescription>For controlled changes prefer an engineering change (ECO), which records approval before release.</DialogDescription>
        </DialogHeader>
        <Field label="Revision">
          <Input value={rev} onChange={(e) => setRev(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button
            disabled={pending || !rev}
            onClick={() =>
              run(async () => {
                const res = await copyBomRevisionAction(bomId, rev);
                if (res.ok) {
                  setOpen(false);
                  router.push(`/engineering/boms/${(res.data as { id: string }).id}`);
                } else toast.error(res.error);
                return res.ok ? { ok: true as const } : res;
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
