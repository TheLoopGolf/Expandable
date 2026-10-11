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
import { qualityEventInput } from "@/lib/validation";
import { addDays } from "@/lib/dates";
import { openQualityEventAction } from "../actions";

type Values = z.input<typeof qualityEventInput>;

export function NcrForm({
  items,
  lots,
  members,
  suppliers,
  customers,
  workOrders,
  today,
  canHold,
  defaultLotId,
}: {
  items: { id: string; sku: string; name: string }[];
  lots: { id: string; lot_number: string; item_id: string; sku: string; status: string; qty: string }[];
  members: { id: string; full_name: string; role_key: string }[];
  suppliers: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  workOrders: { id: string; wo_number: string; sku: string }[];
  today: string;
  canHold: boolean;
  defaultLotId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const defaultLot = lots.find((l) => l.id === defaultLotId);
  const form = useForm<Values>({
    resolver: zodResolver(qualityEventInput),
    defaultValues: {
      eventType: "ncr",
      title: "",
      description: "",
      severity: "medium",
      source: "incoming",
      itemId: defaultLot?.item_id ?? "",
      lotId: defaultLot?.id ?? "",
      dueDate: addDays(today, 14),
      ownerId: members.find((m) => m.role_key === "quality")?.id ?? "",
      placeHold: !!defaultLot && canHold,
      holdReason: "",
    },
  });
  const e = form.formState.errors;
  const itemId = form.watch("itemId");
  const lotId = form.watch("lotId");
  const placeHold = form.watch("placeHold");
  const itemLots = lots.filter((l) => !itemId || l.item_id === itemId);

  const onSubmit = form.handleSubmit((v) =>
    startTransition(async () => {
      const blank = (x: unknown) => (x ? x : null);
      const res = await openQualityEventAction({
        ...v,
        itemId: blank(v.itemId) as string | null,
        lotId: blank(v.lotId) as string | null,
        ownerId: blank(v.ownerId) as string | null,
        supplierId: blank(v.supplierId) as string | null,
        customerId: blank(v.customerId) as string | null,
        workOrderId: blank(v.workOrderId) as string | null,
        quantityAffected: blank(v.quantityAffected) as string | null,
      });
      if (res.ok) {
        toast.success(res.message);
        router.push(`/quality/events/${(res.data as { id: string }).id}`);
      } else toast.error(res.error);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Type">
          <select className={selectClass} {...form.register("eventType")}>
            <option value="ncr">Nonconformance (NCR)</option>
            <option value="complaint">Customer complaint</option>
            <option value="deviation">Deviation</option>
            <option value="audit_finding">Audit finding</option>
          </select>
        </Field>
        <Field label="Severity">
          <select className={selectClass} {...form.register("severity")}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
        <Field label="Source">
          <select className={selectClass} {...form.register("source")}>
            <option value="incoming">Incoming inspection</option>
            <option value="in_process">In-process</option>
            <option value="final">Final inspection</option>
            <option value="customer">Customer</option>
            <option value="internal">Internal</option>
          </select>
        </Field>
        <Field label="Due date" error={e.dueDate?.message}>
          <Input type="date" {...form.register("dueDate")} />
        </Field>
        <Field label="Title" error={e.title?.message} className="sm:col-span-2 lg:col-span-4">
          <Input {...form.register("title")} placeholder="What is nonconforming?" />
        </Field>
        <Field label="Description / evidence" className="sm:col-span-2 lg:col-span-4">
          <Textarea rows={3} {...form.register("description")} />
        </Field>
        <Field label="Item">
          <select className={selectClass} {...form.register("itemId", { onChange: () => form.setValue("lotId", "") })}>
            <option value="">None</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lot">
          <select className={selectClass} {...form.register("lotId")}>
            <option value="">None</option>
            {itemLots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_number} · {l.sku} · {Number(l.qty)} on hand{l.status !== "available" ? ` · ${l.status}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity affected" error={e.quantityAffected?.message}>
          <Input inputMode="decimal" {...form.register("quantityAffected")} />
        </Field>
        <Field label="Owner">
          <select className={selectClass} {...form.register("ownerId")}>
            <option value="">Me</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work order">
          <select className={selectClass} {...form.register("workOrderId")}>
            <option value="">None</option>
            {workOrders.map((w) => (
              <option key={w.id} value={w.id}>
                {w.wo_number} · {w.sku}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier">
          <select className={selectClass} {...form.register("supplierId")}>
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer">
          <select className={selectClass} {...form.register("customerId")}>
            <option value="">None</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {canHold && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <Checkbox id="placeHold" checked={!!placeHold} onCheckedChange={(v) => form.setValue("placeHold", v === true)} disabled={!lotId} />
            <Label htmlFor="placeHold" className="font-normal">
              Place the selected lot on quality hold (blocks issue to production and shipment)
            </Label>
          </div>
          {placeHold && (
            <Field label="Hold reason" className="mt-3">
              <Input {...form.register("holdReason")} placeholder="Defaults to the NCR title" />
            </Field>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}Open event
        </Button>
      </div>
    </form>
  );
}
