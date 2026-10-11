import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { requireUser } from "@/server/auth/current";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const user = await requireUser();
  const { need } = await searchParams;
  const description = need && need in PERMISSIONS ? PERMISSIONS[need as Permission] : null;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-sm text-muted-foreground">
        Your role ({user.user.roleName}) does not include {description ? <strong>{description.toLowerCase()}</strong> : "the required permission"}. Ask an
        administrator if you need it.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
