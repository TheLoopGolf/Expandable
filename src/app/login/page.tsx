import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { config } from "@/server/config";
import { ROLES, isRoleKey } from "@/lib/permissions";
import { BRAND } from "@/lib/brand";
import { LogoMark } from "@/components/shell/logo";
import { PersonaPicker, type Persona } from "./persona-picker";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let personas: Persona[] = [];
  if (config.authMode === "demo") {
    const db = await getDb();
    const rows = await db.query<{ id: string; full_name: string; title: string | null; email: string; role_key: string; org_name: string }>(
      `select distinct on (p.id) p.id, p.full_name, p.title, p.email, m.role_key, o.name as org_name
       from profiles p join memberships m on m.profile_id = p.id and m.is_active join organizations o on o.id = m.organization_id
       order by p.id, o.created_at`,
    );
    const order = ["admin", "manager", "planner", "warehouse", "sales", "quality", "finance", "viewer"];
    personas = rows
      .map((r) => {
        const role = isRoleKey(r.role_key) ? r.role_key : "viewer";
        return { id: r.id, name: r.full_name, title: r.title, email: r.email, roleName: ROLES[role].name, roleDescription: ROLES[role].description, orgName: r.org_name, _o: order.indexOf(role) + (r.org_name.startsWith("Cobalt") ? 10 : 0) };
      })
      .sort((a, b) => a._o - b._o)
      .map(({ _o, ...p }) => (void _o, p));
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#0f1b33] p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9" />
          <div>
            <div className="text-lg font-semibold">{BRAND.product}</div>
            <div className="text-sm text-white/60">{BRAND.tagline}</div>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            Demand, materials, production, quality and fulfillment in one operations cockpit.
          </h1>
          <ul className="mt-6 space-y-2 text-sm text-white/75">
            <li>• Multi-level BOMs, MRP suggestions and work orders with material readiness</li>
            <li>• Lot traceability, quality holds and NCR/CAPA</li>
            <li>• Sales order reservations, partial shipments and invoicing</li>
            <li>• Every number on the dashboard comes from posted transactions</li>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-white/50">
          Demonstration software with fictional data. Not validated for regulated manufacturing and not an accounting system of record.
        </p>
        <svg className="absolute -right-24 -bottom-24 size-[520px] opacity-[0.12]" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="98" fill="none" stroke="white" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="white" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="42" fill="none" stroke="white" strokeWidth="0.6" />
          <path d="M2 100h196M100 2v196" stroke="white" strokeWidth="0.6" />
        </svg>
      </section>
      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <LogoMark />
            <span className="font-semibold">{BRAND.product}</span>
          </div>
          {config.authMode === "demo" ? (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">Choose a demo persona</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Each persona has a different role and permissions. Permissions are enforced on the server for every action, not just
                hidden in the UI.
              </p>
              <div className="mt-6">
                <PersonaPicker personas={personas} />
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                Demo mode uses an embedded PostgreSQL (PGlite) database seeded with the fictional company Northstar Precision
                Manufacturing. Configure Supabase to use real accounts.
              </p>
            </>
          ) : (
            <div className="mx-auto max-w-sm">
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1.5 mb-6 text-sm text-muted-foreground">Use your organization account.</p>
              <PasswordForm />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
