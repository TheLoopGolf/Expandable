"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { itemInput } from "@/lib/validation";
import { createItemAction, updateItemAction } from "../actions";

type Values = z.input<typeof itemInput>;

export function ItemForm({
  itemId,
  defaults,
  suppliers,
  warehouses,
  categories,
  families,
}: {
  itemId?: string;
  defaults?: Partial<Values>;
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; code: string; name: string }[];
  categories: string[];
  families: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(itemInput),
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      itemType: "purchased",
      category: categories[0] ?? "",
      productFamily: "",
      uom: "ea",
      standardCost: "0",
      listPrice: "",
      preferredSupplierId: "",
      leadTimeDays: 14,
      reorderPoint: "0",
      safetyStock: "0",
      minOrderQty: "1",
      tracking: "none",
      shelfLifeDays: undefined,
      defaultWarehouseId: warehouses[0]?.id ?? "",
      lifecycleStatus: "active",
      ...defaults,
    },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit((v) =>
    startTransition(async () => {
      const payload = { ...v, listPrice: v.listPrice || null, preferredSupplierId: v.preferredSupplierId || null, defaultWarehouseId: v.defaultWarehouseId || null, shelfLifeDays: v.shelfLifeDays || null };
      const res = itemId ? await updateItemAction(itemId, payload) : await createItemAction(payload);
      if (res.ok) {
        toast.success(res.message);
        router.push(`/inventory/items/${itemId ?? (res.data as { id: string }).id}`);
      } else {
        toast.error(res.error);
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof Values, { message: msg });
      }
    }),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="SKU" error={e.sku?.message}>
          <Input {...form.register("sku")} className="font-mono uppercase" />
        </Field>
        <Field label="Name" error={e.name?.message} className="lg:col-span-3">
          <Input {...form.register("name")} />
        </Field>
        <Field label="Description" className="sm:col-span-2 lg:col-span-4">
          <Textarea rows={2} {...form.register("description")} />
        </Field>
        <Field label="Type">
          <select className={selectClass} {...form.register("itemType")}>
            <option value="purchased">Purchased</option>
            <option value="manufactured">Manufactured</option>
          </select>
        </Field>
        <Field label="Category" error={e.category?.message}>
          <Input list="categories" {...form.register("category")} />
          <datalist id="categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Product family">
          <Input list="families" {...form.register("productFamily")} />
          <datalist id="families">
            {families.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Lifecycle">
          <select className={selectClass} {...form.register("lifecycleStatus")}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="hold">Hold</option>
            <option value="obsolete">Obsolete</option>
          </select>
        </Field>
        <Field label="Unit of measure" error={e.uom?.message}>
          <Input {...form.register("uom")} />
        </Field>
        <Field label="Tracking" error={e.tracking?.message} hint="Cannot change while stock is on hand">
          <select className={selectClass} {...form.register("tracking")}>
            <option value="none">None</option>
            <option value="lot">Lot</option>
            <option value="serial">Serial (lot-level in v1)</option>
          </select>
        </Field>
        <Field label="Shelf life (days)" error={e.shelfLifeDays?.message}>
          <Input type="number" {...form.register("shelfLifeDays")} />
        </Field>
        <Field label="Default warehouse">
          <select className={selectClass} {...form.register("defaultWarehouseId")}>
            <option value="">None</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Standard cost" error={e.standardCost?.message}>
          <Input inputMode="decimal" {...form.register("standardCost")} />
        </Field>
        <Field label="List price" error={e.listPrice?.message}>
          <Input inputMode="decimal" {...form.register("listPrice")} />
        </Field>
        <Field label="Preferred supplier">
          <select className={selectClass} {...form.register("preferredSupplierId")}>
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lead time (days)" error={e.leadTimeDays?.message}>
          <Input type="number" {...form.register("leadTimeDays")} />
        </Field>
        <Field label="Reorder point" error={e.reorderPoint?.message}>
          <Input inputMode="decimal" {...form.register("reorderPoint")} />
        </Field>
        <Field label="Safety stock" error={e.safetyStock?.message}>
          <Input inputMode="decimal" {...form.register("safetyStock")} />
        </Field>
        <Field label="Minimum order qty" error={e.minOrderQty?.message}>
          <Input inputMode="decimal" {...form.register("minOrderQty")} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {itemId ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  );
}
