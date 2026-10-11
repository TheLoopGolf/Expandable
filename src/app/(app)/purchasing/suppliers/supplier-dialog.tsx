"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { supplierInput } from "@/lib/validation";
import { createSupplierAction } from "../actions";

export function SupplierDialog() {
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const form = useForm<z.input<typeof supplierInput>>({ resolver: zodResolver(supplierInput), defaultValues: { code: "", name: "", paymentTermsDays: 30, defaultLeadTimeDays: 14 } });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && form.reset())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => run(() => createSupplierAction(v), () => setOpen(false)))}>
          <Field label="Code" error={e.code?.message}>
            <Input {...form.register("code")} />
          </Field>
          <Field label="Name" error={e.name?.message}>
            <Input {...form.register("name")} />
          </Field>
          <Field label="Contact">
            <Input {...form.register("contactName")} />
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input type="email" {...form.register("email")} />
          </Field>
          <Field label="Payment terms (days)" error={e.paymentTermsDays?.message}>
            <Input type="number" {...form.register("paymentTermsDays")} />
          </Field>
          <Field label="Default lead time (days)" error={e.defaultLeadTimeDays?.message}>
            <Input type="number" {...form.register("defaultLeadTimeDays")} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}Save supplier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
