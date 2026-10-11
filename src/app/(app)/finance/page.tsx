import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section, SimpleTable, StatCard } from "@/components/detail";
import { ColumnChart } from "@/components/charts/simple-charts";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getAccountBalances, getFinanceOverview, listBills, listInvoices, listJournal } from "@/server/queries/finance";
import { formatCurrency, formatDate, formatPercent, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BillTable, InvoiceTable } from "./finance-tables";

export const metadata: Metadata = { title: "Finance" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "invoices", label: "Invoices & AR" },
  { key: "payables", label: "Payables" },
  { key: "journal", label: "Journal" },
  { key: "accounts", label: "Trial balance" },
] as const;

const SOURCE_HREF: Record<string, (id: string) => string> = {
  work_order: (id) => `/production/work-orders/${id}`,
  goods_receipt: (id) => `/purchasing/orders/${id}`,
};

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("finance.view");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const db = await getDb();
  const can = (p: string) => user.permissions.includes(p as never);
  return (
    <>
      <PageHeader
        title="Finance"
        description="Operational finance views generated from shipments, receipts, production and payments."
        breadcrumbs={[{ label: "Finance" }]}
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        Journal entries are posted automatically by operational transactions (standard costing) and every entry balances. This is an operational sub-ledger for analysis — not a closed general ledger, and the figures are not GAAP financial statements. Period close, multi-currency and consolidation are planned (see NEXT_STEPS.md).
      </div>
      <nav className="mb-4 flex flex-wrap gap-1 border-b" aria-label="Finance sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/finance?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground", tab === t.key ? "border-primary text-foreground" : "border-transparent")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview user={user} />}
      {tab === "invoices" && <InvoiceTable rows={await listInvoices(db, user.ctx, user.today)} canManage={can("finance.manage")} />}
      {tab === "payables" && <BillTable rows={await listBills(db, user.ctx, user.today)} canManage={can("finance.manage")} />}
      {tab === "journal" && <Journal user={user} />}
      {tab === "accounts" && <TrialBalance user={user} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requirePermission>>;

async function Overview({ user }: { user: U }) {
  const db = await getDb();
  const o = await getFinanceOverview(db, user.ctx, user.range, user.today);
  const margin = o.period.revenue - o.period.cogs;
  const aging = (a: typeof o.arAging) => [
    ["Current", a.current],
    ["1–30 days", a.d1_30],
    ["31–60 days", a.d31_60],
    ["61–90 days", a.d61_90],
    ["90+ days", a.d90],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={`Shipped revenue · ${user.range.label}`} value={formatCurrency(o.period.revenue)} sub={`${formatCurrency(o.period.invoiced)} invoiced`} />
        <StatCard label="Gross margin at standard" value={formatCurrency(margin)} sub={formatPercent(o.period.revenue ? (margin / o.period.revenue) * 100 : 0)} />
        <StatCard label="Collected" value={formatCurrency(o.period.collected)} sub={user.range.label} />
        <StatCard label="Accounts receivable" value={formatCurrency(o.arTotal)} sub={`${formatCurrency(o.arTotal - o.arAging.current)} past due`} tone={o.arTotal - o.arAging.current > 0 ? "danger" : undefined} />
        <StatCard label="Accounts payable" value={formatCurrency(o.apTotal)} sub={`Cash ${formatCurrency(o.cash)}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ColumnChart
          title="Revenue and cost of goods sold by month"
          subtitle="Shipped value vs standard cost of shipped units (last 6 months)"
          data={o.monthly.map((m) => ({ label: formatDate(m.month, { year: false }).replace(/ 1$/, ""), revenue: m.revenue, cogs: m.cogs }))}
          xKey="label"
          format="currency"
          series={[
            { key: "revenue", label: "Revenue", color: "var(--series-1)" },
            { key: "cogs", label: "COGS", color: "var(--series-2)" },
          ]}
        />
        <Section title={`Margin by product family · ${user.range.label}`}>
          <SimpleTable
            head={["Family", "Revenue", "COGS", "Margin", "Margin %"]}
            align={["left", "right", "right", "right", "right"]}
            rows={o.byFamily.map((f) => [f.family, formatCurrency(f.revenue), formatCurrency(f.cogs), formatCurrency(f.revenue - f.cogs), formatPercent(f.revenue ? ((f.revenue - f.cogs) / f.revenue) * 100 : 0)])}
          />
        </Section>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Receivables aging" actions={<Link href="/finance?tab=invoices" className="text-xs text-primary hover:underline">Invoices</Link>}>
          <SimpleTable head={["Bucket", "Open amount"]} align={["left", "right"]} rows={aging(o.arAging).map(([k, v]) => [k, formatCurrency(v, { cents: true })])} />
        </Section>
        <Section title="Payables aging" actions={<Link href="/finance?tab=payables" className="text-xs text-primary hover:underline">Bills</Link>}>
          <SimpleTable head={["Bucket", "Open amount"]} align={["left", "right"]} rows={aging(o.apAging).map(([k, v]) => [k, formatCurrency(v, { cents: true })])} />
        </Section>
      </div>
    </div>
  );
}

async function Journal({ user }: { user: U }) {
  const db = await getDb();
  const entries = await listJournal(db, user.ctx, user.range.from, user.range.to);
  return (
    <Section title={`Journal entries · ${user.range.label}`} description="Latest 300 entries. Each entry links to its source document where available.">
      <div className="divide-y">
        {entries.map((e) => {
          const href = e.source_id ? SOURCE_HREF[e.source_type]?.(e.source_id) : null;
          return (
            <details key={e.id} className="group px-4 py-2">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="w-24 font-mono text-xs">{e.entry_number}</span>
                <span className="w-24 text-muted-foreground">{formatDate(e.entry_date, { year: false })}</span>
                <span className="min-w-0 flex-1">{href ? <Link href={href} className="hover:underline">{e.description}</Link> : e.description}</span>
                <span className="text-xs text-muted-foreground">{e.source_type.replace(/_/g, " ")}</span>
                <span className="w-28 text-right tabular font-medium">{formatCurrency(e.amount, { cents: true })}</span>
              </summary>
              <table className="mt-2 ml-28 w-full max-w-xl text-xs tabular">
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-0.5 pr-3">{l.code} {l.name}</td>
                      <td className="py-0.5 pr-3 text-right">{toNum(l.debit) ? formatCurrency(l.debit, { cents: true }) : ""}</td>
                      <td className="py-0.5 text-right">{toNum(l.credit) ? formatCurrency(l.credit, { cents: true }) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>
    </Section>
  );
}

async function TrialBalance({ user }: { user: U }) {
  const db = await getDb();
  const accounts = await getAccountBalances(db, user.ctx);
  const totalD = accounts.reduce((s, a) => s + a.debit, 0);
  const totalC = accounts.reduce((s, a) => s + a.credit, 0);
  return (
    <Section title="Trial balance (all periods)" description={`Debits ${formatCurrency(totalD, { cents: true })} · credits ${formatCurrency(totalC, { cents: true })} · ${Math.abs(totalD - totalC) < 0.005 ? "balanced" : "OUT OF BALANCE"}`}>
      <SimpleTable
        head={["Account", "Type", "Debits", "Credits", "Balance"]}
        align={["left", "left", "right", "right", "right"]}
        rows={accounts.map((a) => [`${a.code} ${a.name}`, <span key="t" className="capitalize text-muted-foreground">{a.account_type}</span>, formatCurrency(a.debit, { cents: true }), formatCurrency(a.credit, { cents: true }), <span key="b" className="font-medium">{formatCurrency(a.balance, { cents: true })}</span>])}
      />
    </Section>
  );
}
