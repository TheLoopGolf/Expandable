"use client";

import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { purchaseOrderInput } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { formatCurrency, toNum } from "@/lib/format";
import { createPurchaseOrderAction } from "../../actions";

type FormValues = z.input<typeof purchaseOrderInput>;

interface ItemOpt {
  id: string;
  sku: string;
  name: string;
  uom: string;
  standard_cost: string;
  preferred_supplier_id: string | null;
  lead_time_days: number;
}

export function PurchaseOrderForm({
  suppliers,
  warehouses,
  items,
  today,
  canApprove,
  defaults,
}: {
  suppliers: { id: string; name: string; default_lead_time_days: number }[];
  warehouses: { id: string; code: string; name: string }[];
  items: ItemOpt[];
  today: string;
  canApprove: boolean;
  defaults?: { supplierId?: string; itemId?: string; quantity?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const firstItem = items.find((i) => i.id === defaults?.itemId);
  const form = useForm<FormValues>({
    resolver: zodResolver(purchaseOrderInput),
    defaultValues: {
      supplierId: defaults?.supplierId ?? firstItem?.preferred_supplier_id ?? "",
      warehouseId: warehouses[0]?.id ?? "",
      expectedDate: addDays(today, firstItem?.lead_time_days ?? 14),
      notes: "",
      source: "manual",
      lines: [{ itemId: firstItem?.id ?? "", quantity: defaults?.quantity ?? "", unitCost: firstItem?.standard_cost ?? "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const errors = form.formState.errors;
  const lines = form.watch("lines");
  const supplierId = form.watch("supplierId");
  const total = lines.reduce((s, l) => s + toNum(l.quantity as string) * toNum(l.unitCost as string), 0);
  const suggested = items.filter((i) => i.preferred_supplier_id === supplierId);

  const submit = (approve: boolean) =>
    form.handleSubmit((values) =>
      startTransition(async () => {
        const res = await createPurchaseOrderAction(values, approve);
        if (res.ok) {
          toast.success(res.message);
          router.push(`/purchasing/orders/${(res.data as { id: string }).id}`);
        } else {
          toast.error(res.error);
        }
      }),
    )();

  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), submit(false))}>
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier" htmlFor="supplierId" error={errors.supplierId?.message}>
          <select id="supplierId" className={selectClass} {...form.register("supplierId")} aria-invalid={!!errors.supplierId}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ship to warehouse" htmlFor="warehouseId" error={errors.warehouseId?.message}>
          <select id="warehouseId" className={selectClass} {...form.register("warehouseId")}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected delivery" htmlFor="expectedDate" error={errors.expectedDate?.message}>
          <Input id="expectedDate" type="date" min={today} {...form.register("expectedDate")} />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2 lg:col-span-1">
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
            const item = items.find((i) => i.id === lines[idx]?.itemId);
            const lineErr = errors.lines?.[idx];
            return (
              <div key={f.id} className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_120px_140px_auto]">
                <Field label={`Item ${idx + 1}`} error={lineErr?.itemId?.message}>
                  <select
                    className={selectClass}
                    {...form.register(`lines.${idx}.itemId`, {
                      onChange: (e) => {
                        const it = items.find((i) => i.id === e.target.value);
                        if (it) form.setValue(`lines.${idx}.unitCost`, it.standard_cost);
                      },
                    })}
                  >
                    <option value="">Select item…</option>
                    {suggested.length > 0 && (
                      <optgroup label="Preferred for this supplier">
                        {suggested.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.sku} — {i.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="All purchased items">
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} — {i.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </Field>
                <Field label={`Quantity${item ? ` (${item.uom})` : ""}`} error={lineErr?.quantity?.message}>
                  <Input inputMode="decimal" {...form.register(`lines.${idx}.quantity`)} aria-invalid={!!lineErr?.quantity} />
                </Field>
                <Field label="Unit cost" error={lineErr?.unitCost?.message} hint={item ? `Std ${formatCurrency(item.standard_cost, { cents: true })}` : undefined}>
                  <Input inputMode="decimal" {...form.register(`lines.${idx}.unitCost`)} />
                </Field>
                <Button type="button" variant="ghost" size="icon" className="mt-5" onClick={() => remove(idx)} disabled={fields.length === 1} aria-label={`Remove line ${idx + 1}`}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          {errors.lines?.message && <p className="text-xs text-destructive">{errors.lines.message}</p>}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ itemId: "", quantity: "", unitCost: "" })}>
            <Plus /> Add line
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant={canApprove ? "outline" : "default"} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save draft
        </Button>
        {canApprove && (
          <Button type="button" onClick={() => submit(true)} disabled={pending}>
            Save &amp; approve
          </Button>
        )}
      </div>
    </form>
  );
}
