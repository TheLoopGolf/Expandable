"use client";

import { useState } from "react";
import { ClipboardCheck, Loader2, PackageMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/components/action-button";
import { formatDate, formatNumber } from "@/lib/format";
import { issueMaterialsAction, recordProductionAction } from "../../actions";

export interface IssueLine {
  materialId: string;
  lineNo: number;
  itemId: string;
  sku: string;
  uom: string;
  tracking: string;
  remaining: number;
  availableForOrder: number;
  heldOnHand: number;
}

export interface LotOption {
  id: string;
  item_id: string;
  lot_number: string;
  status: string;
  expires_on: string | null;
  qty: number;
}

export function IssueDialog({ woId, woNumber, lines, lots, today }: { woId: string; woNumber: string; lines: IssueLine[]; lots: LotOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [lot, setLot] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useServerAction();

  const reset = () => {
    setKey(crypto.randomUUID());
    setQty(Object.fromEntries(lines.map((l) => [l.materialId, String(Math.max(0, Math.min(l.remaining, l.availableForOrder)))])));
    setLot({});
    setError(null);
  };

  const submit = () => {
    const payload = lines.filter((l) => Number(qty[l.materialId] || 0) > 0).map((l) => ({ materialId: l.materialId, quantity: qty[l.materialId], lotId: lot[l.materialId] || null }));
    for (const l of lines) {
      const q = Number(qty[l.materialId] || 0);
      if (Number.isNaN(q) || q < 0) return setError(`${l.sku}: invalid quantity`);
      if (q > l.remaining + 1e-9) return setError(`${l.sku}: only ${formatNumber(l.remaining)} remains to issue`);
    }
    if (!payload.length) return setError("Enter a quantity to issue.");
    setError(null);
    run(() => issueMaterialsAction({ workOrderId: woId, idempotencyKey: key, lines: payload }), () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && reset())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PackageMinus /> Issue materials
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Issue materials to {woNumber}</DialogTitle>
          <DialogDescription>
            All lines post in one transaction. Lots on quality hold, quarantined or expired are blocked; leave the lot on “Automatic” to consume first-expiring usable lots.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Component</th>
                <th className="py-2 text-right font-medium">Remaining</th>
                <th className="py-2 text-right font-medium">Available</th>
                <th className="py-2 pl-3 font-medium">Lot</th>
                <th className="w-28 py-2 pl-3 font-medium">Issue qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const itemLots = lots.filter((x) => x.item_id === l.itemId);
                return (
                  <tr key={l.materialId} className="border-b border-border/60">
                    <td className="py-2">
                      <span className="font-medium">{l.sku}</span>
                      {l.heldOnHand > 0 && <div className="text-xs text-amber-700 dark:text-amber-300">{formatNumber(l.heldOnHand)} on hold / blocked</div>}
                    </td>
                    <td className="py-2 text-right tabular">{formatNumber(l.remaining)}</td>
                    <td className={`py-2 text-right tabular ${l.availableForOrder < l.remaining ? "text-amber-700 dark:text-amber-300" : ""}`}>{formatNumber(l.availableForOrder)}</td>
                    <td className="py-2 pl-3">
                      {l.tracking === "none" ? (
                        <span className="text-xs text-muted-foreground">Not tracked</span>
                      ) : (
                        <select value={lot[l.materialId] ?? ""} onChange={(e) => setLot((s) => ({ ...s, [l.materialId]: e.target.value }))} className="h-8 max-w-[220px] rounded-md border bg-card px-2 text-xs" aria-label={`Lot for ${l.sku}`}>
                          <option value="">Automatic (FEFO)</option>
                          {itemLots.map((x) => {
                            const expired = !!x.expires_on && x.expires_on < today;
                            return (
                              <option key={x.id} value={x.id}>
                                {x.lot_number} · {formatNumber(x.qty)}
                                {x.status !== "available" ? ` · ${x.status.toUpperCase()}` : expired ? " · EXPIRED" : x.expires_on ? ` · exp ${formatDate(x.expires_on, { year: false })}` : ""}
                              </option>
                            );
                          })}
                        </select>
                      )}
                    </td>
                    <td className="py-2 pl-3">
                      <Input inputMode="decimal" value={qty[l.materialId] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [l.materialId]: e.target.value }))} className="h-8" aria-label={`Issue quantity for ${l.sku}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Post issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecordProductionDialog({ woId, woNumber, remaining, tracking, bins, maxByMaterial }: { woId: string; woNumber: string; remaining: number; tracking: string; bins: { id: string; code: string }[]; maxByMaterial: number }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("0");
  const [lotNumber, setLotNumber] = useState("");
  const [binId, setBinId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useServerAction();

  const reset = () => {
    setKey(crypto.randomUUID());
    setGood(String(Math.max(0, Math.min(remaining, Math.floor(maxByMaterial)))));
    setScrap("0");
    setLotNumber("");
    setBinId("");
    setNotes("");
    setError(null);
  };

  const submit = () => {
    const g = Number(good || 0);
    const s = Number(scrap || 0);
    if (Number.isNaN(g) || Number.isNaN(s) || g < 0 || s < 0) return setError("Enter valid quantities.");
    if (g + s <= 0) return setError("Enter a good or scrap quantity.");
    if (g + s > remaining + 1e-9) return setError(`Only ${formatNumber(remaining)} remain on this order.`);
    setError(null);
    run(() => recordProductionAction({ workOrderId: woId, quantityGood: good || "0", quantityScrap: scrap || "0", lotNumber: lotNumber || undefined, binId: binId || null, notes, idempotencyKey: key }), () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && reset())}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ClipboardCheck /> Record output
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record output on {woNumber}</DialogTitle>
          <DialogDescription>
            {formatNumber(remaining)} units remain. Issued material currently supports up to {formatNumber(Math.floor(maxByMaterial))} more units. Good units post to finished goods; scrap is expensed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="good" className="text-xs">Good quantity</Label>
            <Input id="good" inputMode="decimal" value={good} onChange={(e) => setGood(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scrap" className="text-xs">Scrap quantity</Label>
            <Input id="scrap" inputMode="decimal" value={scrap} onChange={(e) => setScrap(e.target.value)} />
          </div>
          {tracking !== "none" && (
            <div className="grid gap-1.5">
              <Label htmlFor="lot" className="text-xs">Output lot (optional)</Label>
              <Input id="lot" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="Auto: FG<WO>-NN" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="bin" className="text-xs">Bin</Label>
            <select id="bin" value={binId} onChange={(e) => setBinId(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-sm">
              <option value="">Unassigned</option>
              {bins.map((b) => (
                <option key={b.id} value={b.id}>{b.code}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="notes" className="text-xs">Notes (scrap reason)</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Record output
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
