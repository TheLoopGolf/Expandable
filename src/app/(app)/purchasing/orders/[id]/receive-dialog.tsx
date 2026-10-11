"use client";

import { useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/components/action-button";
import { formatNumber } from "@/lib/format";
import { receivePurchaseOrderAction } from "../../actions";

export interface ReceivableLine {
  id: string;
  line_no: number;
  sku: string;
  name: string;
  uom: string;
  tracking: string;
  shelf_life_days: number | null;
  outstanding: number;
}

interface LineState {
  quantity: string;
  lotNumber: string;
  expiresOn: string;
  binId: string;
  quarantine: boolean;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export function ReceiveDialog({ poId, poNumber, lines, bins, defaultQuarantine }: { poId: string; poNumber: string; lines: ReceivableLine[]; bins: { id: string; code: string }[]; defaultQuarantine?: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState<Record<string, LineState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useServerAction();

  const reset = () => {
    setState(Object.fromEntries(lines.map((l) => [l.id, { quantity: String(l.outstanding), lotNumber: "", expiresOn: "", binId: "", quarantine: !!defaultQuarantine }])));
    setErrors({});
    setKey(newKey());
  };

  const update = (id: string, patch: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const submit = () => {
    const errs: Record<string, string> = {};
    const payload: { lineId: string; quantity: string; lotNumber?: string; expiresOn?: string; binId?: string; quarantine: boolean }[] = [];
    for (const l of lines) {
      const st = state[l.id];
      if (!st) continue;
      const q = Number(st.quantity || 0);
      if (!st.quantity || q === 0) continue;
      if (Number.isNaN(q) || q < 0) errs[l.id] = "Enter a valid quantity";
      else if (q > l.outstanding) errs[l.id] = `Max ${formatNumber(l.outstanding)} outstanding`;
      else if (l.tracking !== "none" && !st.lotNumber.trim()) errs[l.id] = "Lot number required";
      payload.push({ lineId: l.id, quantity: st.quantity, lotNumber: st.lotNumber || undefined, expiresOn: st.expiresOn || undefined, binId: st.binId || undefined, quarantine: st.quarantine });
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (payload.length === 0) {
      setErrors({ _: "Enter a quantity on at least one line." });
      return;
    }
    run(() => receivePurchaseOrderAction({ purchaseOrderId: poId, idempotencyKey: key, lines: payload }), () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && reset())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PackageCheck /> Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Receive against {poNumber}</DialogTitle>
          <DialogDescription>
            Quantities post to inventory at standard cost in one transaction. You cannot receive more than the outstanding quantity; submitting twice will not
            double-receive.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[55vh] overflow-auto px-1">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Line</th>
                <th className="px-2 py-2 text-right font-medium">Outstanding</th>
                <th className="w-28 px-2 py-2 font-medium">Receive qty</th>
                <th className="px-2 py-2 font-medium">Lot number</th>
                <th className="px-2 py-2 font-medium">Expires</th>
                <th className="px-2 py-2 font-medium">Bin</th>
                <th className="px-2 py-2 font-medium">Quarantine</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const st = state[l.id];
                if (!st) return null;
                return (
                  <tr key={l.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-2">
                      <div className="font-medium">
                        {l.line_no}. {l.sku}
                      </div>
                      <div className="max-w-[200px] truncate text-xs text-muted-foreground">{l.name}</div>
                      {errors[l.id] && <div className="mt-1 text-xs text-destructive">{errors[l.id]}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular">
                      {formatNumber(l.outstanding)} {l.uom}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        value={st.quantity}
                        onChange={(e) => update(l.id, { quantity: e.target.value })}
                        aria-label={`Receive quantity for ${l.sku}`}
                        aria-invalid={!!errors[l.id]}
                        className="h-8"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {l.tracking === "none" ? (
                        <span className="text-xs text-muted-foreground">Not tracked</span>
                      ) : (
                        <Input value={st.lotNumber} onChange={(e) => update(l.id, { lotNumber: e.target.value })} placeholder="Required" aria-label={`Lot number for ${l.sku}`} className="h-8" />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {l.tracking === "none" ? null : (
                        <Input
                          type="date"
                          value={st.expiresOn}
                          onChange={(e) => update(l.id, { expiresOn: e.target.value })}
                          aria-label={`Expiry for ${l.sku}`}
                          className="h-8"
                          title={l.shelf_life_days ? `Defaults to receipt date + ${l.shelf_life_days} days` : undefined}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select value={st.binId} onChange={(e) => update(l.id, { binId: e.target.value })} className="h-8 rounded-md border bg-card px-2" aria-label={`Bin for ${l.sku}`}>
                        <option value="">Unassigned</option>
                        {bins.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {l.tracking !== "none" && (
                        <Checkbox checked={st.quarantine} onCheckedChange={(v) => update(l.id, { quarantine: v === true })} aria-label={`Quarantine ${l.sku} pending inspection`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {errors._ && <p className="text-sm text-destructive">{errors._}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Post receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
