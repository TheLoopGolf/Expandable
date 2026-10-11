"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { workOrderInput } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { createWorkOrderAction } from "../../actions";

type FormValues = z.input<typeof workOrderInput>;

export function WorkOrderForm({
  items,
  warehouses,
  today,
  canRelease,
  defaultItemId,
  defaultQty,
}: {
  items: { id: string; sku: string; name: string; lead_time_days: number; default_warehouse_id: string | null; hasBom: boolean }[];
  warehouses: { id: string; code: string; name: string; kind: string }[];
  today: string;
  canRelease: boolean;
  defaultItemId?: string;
  defaultQty?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const first = items.find((i) => i.id === defaultItemId);
  const form = useForm<FormValues>({
    resolver: zodResolver(workOrderInput),
    defaultValues: {
      itemId: first?.id ?? "",
      quantity: defaultQty ?? "",
      plannedStart: today,
      dueDate: addDays(today, first?.lead_time_days ?? 5),
      warehouseId: first?.default_warehouse_id ?? "",
      materialWarehouseId: "",
      priority: "normal",
      notes: "",
      release: false,
    },
  });
  const e = form.formState.errors;
  const itemId = form.watch("itemId");
  const item = items.find((i) => i.id === itemId);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await createWorkOrderAction({ ...values, warehouseId: values.warehouseId || null, materialWarehouseId: values.materialWarehouseId || null });
      if (res.ok) {
        toast.success(res.message);
        router.push(`/production/work-orders/${(res.data as { id: string }).id}`);
      } else toast.error(res.error);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Manufactured item" error={e.itemId?.message} hint={item && !item.hasBom ? "No released BOM — release one in Engineering first." : "The released BOM revision is frozen onto the work order."} className="lg:col-span-2">
          <select
            className={selectClass}
            {...form.register("itemId", {
              onChange: (ev) => {
                const it = items.find((i) => i.id === ev.target.value);
                if (it) {
                  form.setValue("dueDate", addDays(form.getValues("plannedStart"), it.lead_time_days));
                  if (it.default_warehouse_id) form.setValue("warehouseId", it.default_warehouse_id);
                }
              },
            })}
          >
            <option value="">Select item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
                {i.hasBom ? "" : " (no released BOM)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" error={e.quantity?.message}>
          <Input inputMode="decimal" {...form.register("quantity")} />
        </Field>
        <Field label="Planned start" error={e.plannedStart?.message}>
          <Input type="date" {...form.register("plannedStart")} />
        </Field>
        <Field label="Due date" error={e.dueDate?.message}>
          <Input type="date" {...form.register("dueDate")} />
        </Field>
        <Field label="Priority">
          <select className={selectClass} {...form.register("priority")}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Output warehouse" hint="Defaults to the item's warehouse">
          <select className={selectClass} {...form.register("warehouseId")}>
            <option value="">Item default</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Material warehouse" hint="Defaults to the site's stores">
          <select className={selectClass} {...form.register("materialWarehouseId")}>
            <option value="">Site stores</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <Textarea rows={1} {...form.register("notes")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {canRelease && (
          <div className="mr-auto flex items-center gap-2">
            <Checkbox id="release" checked={!!form.watch("release")} onCheckedChange={(v) => form.setValue("release", v === true)} />
            <Label htmlFor="release" className="font-normal">Release immediately and allocate available material</Label>
          </div>
        )}
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}Create work order
        </Button>
      </div>
    </form>
  );
}
