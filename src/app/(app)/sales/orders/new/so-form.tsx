"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Info, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, selectClass } from "@/components/field";
import { salesOrderInput } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { formatCurrency, formatDate, formatNumber, toNum } from "@/lib/format";
import { atpAction, createSalesOrderAction } from "../../actions";

type FormValues = z.input<typeof salesOrderInput>;
type Atp = Awaited<ReturnType<typeof atpAction>>;

interface ItemOpt {
  id: string;
  sku: string;
  name: string;
  uom: string;
  list_price: string | null;
  default_warehouse_id: string | null;
}

function AtpHint({ itemId, warehouseId, quantity }: { itemId: string; warehouseId: string; quantity: number }) {
  const [atp, setAtp] = useState<Atp>(null);
  const [loading, startTransition] = useTransition();
  useEffect(() => {
    if (!itemId || !warehouseId) return;
    startTransition(async () => setAtp(await atpAction(itemId, warehouseId)));
  }, [itemId, warehouseId]);
  if (!itemId) return null;
  if (loading && !atp) return <p className="text-xs text-muted-foreground">Checking availability…</p>;
  if (!atp) return null;
  const now = toNum(atp.availableNow);
  const short = quantity > now;
  const covering = atp.incoming.find((s) => toNum(s.cumulative) >= quantity);
  return (
    <div className="flex items-start gap-1.5 text-xs text-muted-foreground" title={atp.limitations}>
      <Info className="mt-px size-3.5 shrink-0" />
      <span>
        <span className={short ? "font-medium text-amber-700 dark:text-amber-300" : "font-medium text-success"}>{formatNumber(now)} available to promise now</span>
        {" "}({formatNumber(atp.usable)} usable, {formatNumber(atp.reserved)} committed).
        {short &&
          (covering
            ? ` Quantity covered by ${covering.ref} due ${formatDate(covering.date, { year: false })}.`
            : atp.incoming.length
              ? ` Incoming supply (${atp.incoming.map((s) => s.ref).join(", ")}) does not cover ${formatNumber(quantity)}.`
              : " No scheduled supply — production or purchasing needed.")}
      </span>
    </div>
  );
}

export function SalesOrderForm({
  customers,
  warehouses,
  items,
  today,
  defaultWarehouseId,
}: {
  customers: { id: string; name: string }[];
  warehouses: { id: string; code: string; name: string }[];
  items: ItemOpt[];
  today: string;
  defaultWarehouseId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(salesOrderInput),
    defaultValues: {
      customerId: "",
      warehouseId: defaultWarehouseId,
      promisedDate: addDays(today, 14),
      requestedDate: addDays(today, 14),
      customerPo: "",
      notes: "",
      confirm: true,
      lines: [{ itemId: "", quantity: "", unitPrice: "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const errors = form.formState.errors;
  const lines = form.watch("lines");
  const warehouseId = form.watch("warehouseId");
  const total = lines.reduce((s, l) => s + toNum(l.quantity as string) * toNum((l.unitPrice as string) || items.find((i) => i.id === l.itemId)?.list_price || 0), 0);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await createSalesOrderAction(values);
      if (res.ok) {
        toast.success(res.message);
        router.push(`/sales/orders/${(res.data as { id: string }).id}`);
      } else toast.error(res.error);
    }),
  );

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Customer" htmlFor="customerId" error={errors.customerId?.message} className="lg:col-span-2">
          <select id="customerId" className={selectClass} {...form.register("customerId")} aria-invalid={!!errors.customerId}>
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ship from" htmlFor="warehouseId">
          <select id="warehouseId" className={selectClass} {...form.register("warehouseId")}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requested date" htmlFor="requestedDate">
          <Input id="requestedDate" type="date" {...form.register("requestedDate")} />
        </Field>
        <Field label="Promised ship date" htmlFor="promisedDate" error={errors.promisedDate?.message}>
          <Input id="promisedDate" type="date" min={today} {...form.register("promisedDate")} />
        </Field>
        <Field label="Customer PO" htmlFor="customerPo">
          <Input id="customerPo" {...form.register("customerPo")} />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2 lg:col-span-4">
          <Textarea id="notes" rows={1} {...form.register("notes")} />
        </Field>
      </div>
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Lines</h2>
          <span className="text-sm">
            Total <span className="font-semibold tabular">{formatCurrency(total, { cents: true })}</span>
          </span>
        </div>
        <div className="space-y-2 p-4">
          {fields.map((f, idx) => {
            const line = lines[idx];
            const item = items.find((i) => i.id === line?.itemId);
            const lineErr = errors.lines?.[idx];
            return (
              <div key={f.id} className="grid gap-2 rounded-lg border p-3">
                <div className="grid items-start gap-2 sm:grid-cols-[1fr_110px_130px_auto]">
                  <Field label={`Product ${idx + 1}`} error={lineErr?.itemId?.message}>
                    <select className={selectClass} {...form.register(`lines.${idx}.itemId`)}>
                      <option value="">Select product…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} — {i.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" error={lineErr?.quantity?.message}>
                    <Input inputMode="decimal" {...form.register(`lines.${idx}.quantity`)} />
                  </Field>
                  <Field label="Unit price" error={lineErr?.unitPrice?.message} hint={item?.list_price ? `List ${formatCurrency(item.list_price, { cents: true })}` : undefined}>
                    <Input inputMode="decimal" placeholder={item?.list_price ?? ""} {...form.register(`lines.${idx}.unitPrice`)} />
                  </Field>
                  <Button type="button" variant="ghost" size="icon" className="mt-5" onClick={() => remove(idx)} disabled={fields.length === 1} aria-label={`Remove line ${idx + 1}`}>
                    <Trash2 />
                  </Button>
                </div>
                <AtpHint itemId={line?.itemId ?? ""} warehouseId={warehouseId} quantity={toNum(line?.quantity as string)} />
              </div>
            );
          })}
          {errors.lines?.message && <p className="text-xs text-destructive">{errors.lines.message}</p>}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ itemId: "", quantity: "", unitPrice: "" })}>
            <Plus /> Add line
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="mr-auto flex items-center gap-2">
          <Checkbox id="confirm" checked={!!form.watch("confirm")} onCheckedChange={(v) => form.setValue("confirm", v === true)} />
          <Label htmlFor="confirm" className="text-sm font-normal">
            Confirm order now (creates demand for planning)
          </Label>
        </div>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Create order
        </Button>
      </div>
    </form>
  );
}
