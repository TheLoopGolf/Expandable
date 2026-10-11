"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ActionResultLike = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function useServerAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResultLike>, onSuccess?: () => void) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        try {
          const res = await fn();
          if (res.ok) {
            if (res.message) toast.success(res.message);
            onSuccess?.();
            router.refresh();
            resolve(true);
          } else {
            toast.error(res.error);
            resolve(false);
          }
        } catch {
          toast.error("The request failed. Check your connection and try again.");
          resolve(false);
        }
      });
    });
  return { pending, run };
}

/** Button that runs a server action, optionally after a confirmation dialog. */
export function ActionButton({
  action,
  children,
  confirm,
  variant,
  size = "sm",
  disabled,
}: {
  action: () => Promise<ActionResultLike>;
  children: React.ReactNode;
  confirm?: { title: string; description: React.ReactNode; confirmLabel?: string };
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
}) {
  const { pending, run } = useServerAction();
  const [open, setOpen] = useState(false);
  if (!confirm) {
    return (
      <Button variant={variant} size={size} disabled={disabled || pending} onClick={() => run(action)}>
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || pending}>
          {pending && <Loader2 className="animate-spin" />}
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{confirm.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              run(action, () => setOpen(false));
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            {confirm.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Action that requires a documented reason (holds, cancellations, short closes). */
export function ReasonActionButton({
  action,
  children,
  title,
  description,
  label = "Reason",
  minLength = 3,
  confirmLabel = "Confirm",
  variant = "outline",
  size = "sm",
  destructive,
}: {
  action: (reason: string) => Promise<ActionResultLike>;
  children: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  label?: string;
  minLength?: number;
  confirmLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  destructive?: boolean;
}) {
  const { pending, run } = useServerAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= minLength;
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setReason(""))}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {children}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(() => action(reason.trim()), () => (setOpen(false), setReason("")));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="reason">{label}</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required minLength={minLength} />
            <span className="text-xs text-muted-foreground">Recorded in the audit trail with your name and the before/after state.</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending} variant={destructive ? "destructive" : "default"}>
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
