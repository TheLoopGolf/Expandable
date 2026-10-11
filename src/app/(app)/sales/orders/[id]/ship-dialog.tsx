"use client";

import { useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/components/action-button";
import { formatNumber } from "@/lib/format";
import { shipSalesOrderAction } from "../../actions";

export interface ShippableLine {
  id: string;
  line_no: number;
  sku: string;
  open: number;
  availableForLine: number;
  reserved: number;
}

export function ShipDialog({ soId, soNumber, lines, canInvoice }: { soId: string; soNumber: string; lines: ShippableLine[]; canInvoice: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [invoice, setInvoice] = useState(canInvoice);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useServerAction();

  const reset = () => {
    setKey(crypto.randomUUID());
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(Math.max(0, Math.min(l.open, Math.floor(l.availableForLine))))])));
    setCarrier("");
    setTracking("");
    setError(null);
  };

  const submit = () => {
    const payload = lines
      .filter((l) => Number(qty[l.id] || 0) > 0)
      .map((l) => ({ lineId: l.id, quantity: qty[l.id] }));
    for (const l of lines) {
      const q = Number(qty[l.id] || 0);
      if (Number.isNaN(q) || q < 0) return setError(`Line ${l.line_no}: enter a valid quantity`);
      if (q > l.open) return setError(`Line ${l.line_no}: only ${formatNumber(l.open)} open`);
    }
    if (payload.length === 0) return setError("Enter a quantity to ship on at least one line.");
    setError(null);
    run(() => shipSalesOrderAction({ salesOrderId: soId, idempotencyKey: key, carrier, trackingNumber: tracking, createInvoice: invoice && canInvoice, lines: payload }), () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && reset())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Truck /> Ship
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm shipment for {soNumber}</DialogTitle>
          <DialogDescription>
            Stock is consumed first-expiring-first and never from lots on hold. Partial quantities leave the remainder open on the order.
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-medium">Line</th>
              <th className="py-2 text-right font-medium">Open</th>
              <th className="py-2 text-right font-medium">Available</th>
              <th className="w-32 py-2 pl-3 font-medium">Ship now</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-2">
                  {l.line_no}. <span className="font-medium">{l.sku}</span>
                  {l.reserved > 0 && <span className="ml-2 text-xs text-muted-foreground">{formatNumber(l.reserved)} reserved</span>}
                </td>
                <td className="py-2 text-right tabular">{formatNumber(l.open)}</td>
                <td className={`py-2 text-right tabular ${l.availableForLine < l.open ? "text-amber-700 dark:text-amber-300" : ""}`}>{formatNumber(l.availableForLine)}</td>
                <td className="py-2 pl-3">
                  <Input inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} className="h-8" aria-label={`Ship quantity for line ${l.line_no}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="carrier" className="text-xs">Carrier</Label>
            <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tracking" className="text-xs">Tracking number</Label>
            <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </div>
        </div>
        {canInvoice && (
          <div className="flex items-center gap-2">
            <Checkbox id="invoice" checked={invoice} onCheckedChange={(v) => setInvoice(v === true)} />
            <Label htmlFor="invoice" className="font-normal">Create a draft invoice for the shipped quantity</Label>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Confirm shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
