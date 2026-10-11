"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, selectClass } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { formatNumber } from "@/lib/format";
import { countAdjustAction, issueStockAction, receiveStockAction, transferStockAction } from "./actions";

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  tracking: string;
  uom: string;
}
export interface StockWarehouse {
  id: string;
  code: string;
  name: string;
}
export interface StockBin {
  id: string;
  code: string;
  warehouse_id: string;
}
export interface StockBalance {
  item_id: string;
  warehouse_id: string;
  bin_id: string | null;
  lot_id: string | null;
  lot_number: string | null;
  lot_status: string | null;
  qty: number;
}

type Mode = "receive" | "issue" | "transfer" | "count";

export function StockTransactionDialog({
  items,
  warehouses,
  bins,
  balances,
  defaultItemId,
  trigger,
}: {
  items: StockItem[];
  warehouses: StockWarehouse[];
  bins: StockBin[];
  balances: StockBalance[];
  defaultItemId?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("receive");
  const [itemId, setItemId] = useState(defaultItemId ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [binId, setBinId] = useState("");
  const [lotId, setLotId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [toBinId, setToBinId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useServerAction();
  const item = items.find((i) => i.id === itemId);
  const lots = useMemo(
    () => balances.filter((b) => b.item_id === itemId && b.warehouse_id === warehouseId && b.lot_id && b.qty > 0),
    [balances, itemId, warehouseId],
  );
  const systemQty = balances
    .filter((b) => b.item_id === itemId && b.warehouse_id === warehouseId && (b.bin_id ?? "") === binId && (b.lot_id ?? "") === lotId)
    .reduce((s, b) => s + b.qty, 0);

  const reset = () => {
    setKey(crypto.randomUUID());
    setQuantity("");
    setReason("");
    setLotNumber("");
    setLotId("");
    setBinId("");
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!itemId || !warehouseId) return setError("Choose an item and warehouse.");
    const common = { itemId, warehouseId, idempotencyKey: key };
    if (mode === "receive") {
      if (item?.tracking !== "none" && !lotNumber.trim()) return setError("Lot number is required for this item.");
      return run(() => receiveStockAction({ ...common, binId: binId || null, quantity, lotNumber: lotNumber || undefined, expiresOn: expiresOn || null, reason }), () => setOpen(false));
    }
    if (mode === "issue") return run(() => issueStockAction({ ...common, binId: binId || null, lotId: lotId || null, quantity, reason }), () => setOpen(false));
    if (mode === "transfer") {
      if (!toWarehouseId) return setError("Choose a destination warehouse.");
      return run(
        () => transferStockAction({ itemId, fromWarehouseId: warehouseId, fromBinId: binId || null, lotId: lotId || null, toWarehouseId, toBinId: toBinId || null, quantity, reason, idempotencyKey: key }),
        () => setOpen(false),
      );
    }
    return run(() => countAdjustAction({ ...common, binId: binId || null, lotId: lotId || null, countedQuantity: quantity, reason }), () => setOpen(false));
  };

  const binsFor = (wh: string) => bins.filter((b) => b.warehouse_id === wh);

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && reset())}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <ArrowLeftRight /> Stock transaction
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Stock transaction</DialogTitle>
          <DialogDescription>Posts an immutable ledger movement and audit event. Inventory can never go negative; held lots cannot be issued.</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => (setMode(v as Mode), setError(null))}>
          <TabsList className="w-full">
            <TabsTrigger value="receive">Receive</TabsTrigger>
            <TabsTrigger value="issue">Issue</TabsTrigger>
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
            <TabsTrigger value="count">Cycle count</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item" className="sm:col-span-2">
            <select className={selectClass} value={itemId} onChange={(e) => (setItemId(e.target.value), setLotId(""))}>
              <option value="">Select item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={mode === "transfer" ? "From warehouse" : "Warehouse"}>
            <select className={selectClass} value={warehouseId} onChange={(e) => (setWarehouseId(e.target.value), setBinId(""), setLotId(""))}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={mode === "transfer" ? "From bin" : "Bin"}>
            <select className={selectClass} value={binId} onChange={(e) => setBinId(e.target.value)}>
              <option value="">{mode === "receive" ? "Unassigned" : "Any / unassigned"}</option>
              {binsFor(warehouseId).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </Field>
          {mode === "receive" && item?.tracking !== "none" && item && (
            <>
              <Field label="Lot number">
                <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="Required" />
              </Field>
              <Field label="Expiry (optional)">
                <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </Field>
            </>
          )}
          {mode !== "receive" && item?.tracking !== "none" && item && (
            <Field label="Lot" className="sm:col-span-2" hint={mode === "count" ? "Counts are per lot" : "Leave on automatic for first-expiring usable stock"}>
              <select className={selectClass} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">{mode === "count" ? "Select lot…" : "Automatic (FEFO)"}</option>
                {lots.map((l) => (
                  <option key={`${l.lot_id}-${l.bin_id}`} value={l.lot_id!}>
                    {l.lot_number} · {formatNumber(l.qty)}
                    {l.lot_status !== "available" ? ` · ${l.lot_status?.toUpperCase()}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {mode === "transfer" && (
            <>
              <Field label="To warehouse">
                <select className={selectClass} value={toWarehouseId} onChange={(e) => (setToWarehouseId(e.target.value), setToBinId(""))}>
                  <option value="">Select…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To bin">
                <select className={selectClass} value={toBinId} onChange={(e) => setToBinId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {binsFor(toWarehouseId).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label={mode === "count" ? `Counted quantity (system ${formatNumber(systemQty)})` : `Quantity${item ? ` (${item.uom})` : ""}`}>
            <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "count" ? "e.g. ABC cycle count" : "Required"} />
          </Field>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}Post {mode === "count" ? "count" : mode}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
