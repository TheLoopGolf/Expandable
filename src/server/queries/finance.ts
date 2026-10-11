import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { num } from "@/lib/decimal";
import { addMonths, diffDays, startOfMonth } from "@/lib/dates";

export async function getFinanceOverview(db: Sql, ctx: ServiceContext, range: { from: string; to: string }, today: string) {
  authorize(ctx, "finance.view");
  const monthly = await db.query<{ m: string; revenue: string; cogs: string }>(
    `select date_trunc('month', sh.ship_date::timestamp)::date::text as m, sum(sl.quantity * sl.unit_price) as revenue, sum(sl.quantity * sl.unit_cost) as cogs
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     where sh.organization_id = $1 and sh.ship_date >= $2 group by 1 order by 1`,
    [ctx.orgId, addMonths(startOfMonth(today), -5)],
  );
  const [period] = await db.query<{ revenue: string; cogs: string; invoiced: string; collected: string }>(
    `select
       coalesce((select sum(sl.quantity * sl.unit_price) from shipment_lines sl join shipments sh on sh.id = sl.shipment_id where sh.organization_id = $1 and sh.ship_date between $2 and $3), 0) as revenue,
       coalesce((select sum(sl.quantity * sl.unit_cost) from shipment_lines sl join shipments sh on sh.id = sl.shipment_id where sh.organization_id = $1 and sh.ship_date between $2 and $3), 0) as cogs,
       coalesce((select sum(total) from invoices where organization_id = $1 and status in ('issued','paid') and invoice_date between $2 and $3), 0) as invoiced,
       coalesce((select sum(amount) from payments where organization_id = $1 and direction = 'received' and payment_date between $2 and $3), 0) as collected`,
    [ctx.orgId, range.from, range.to],
  );
  const ar = await db.query<{ due_date: string; open: string }>(
    `select due_date::text, total - amount_paid as open from invoices where organization_id = $1 and status = 'issued'`,
    [ctx.orgId],
  );
  const ap = await db.query<{ due_date: string; open: string }>(
    `select due_date::text, total - amount_paid as open from supplier_bills where organization_id = $1 and status = 'open'`,
    [ctx.orgId],
  );
  const aging = (rows: { due_date: string; open: string }[]) => {
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
    for (const r of rows) {
      const late = diffDays(today, r.due_date);
      const v = num(r.open);
      if (late <= 0) buckets.current += v;
      else if (late <= 30) buckets.d1_30 += v;
      else if (late <= 60) buckets.d31_60 += v;
      else if (late <= 90) buckets.d61_90 += v;
      else buckets.d90 += v;
    }
    return buckets;
  };
  const balances = await getAccountBalances(db, ctx);
  const cash = balances.find((b) => b.code === "1000")?.balance ?? 0;
  const byFamily = await db.query<{ family: string | null; revenue: string; cogs: string }>(
    `select i.product_family as family, sum(sl.quantity * sl.unit_price) as revenue, sum(sl.quantity * sl.unit_cost) as cogs
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id join items i on i.id = sl.item_id
     where sh.organization_id = $1 and sh.ship_date between $2 and $3 group by 1 order by 2 desc`,
    [ctx.orgId, range.from, range.to],
  );
  return {
    monthly: monthly.map((m) => ({ month: m.m, revenue: num(m.revenue), cogs: num(m.cogs), margin: num(m.revenue) - num(m.cogs) })),
    period: { revenue: num(period.revenue), cogs: num(period.cogs), invoiced: num(period.invoiced), collected: num(period.collected) },
    arAging: aging(ar),
    apAging: aging(ap),
    arTotal: ar.reduce((s, r) => s + num(r.open), 0),
    apTotal: ap.reduce((s, r) => s + num(r.open), 0),
    cash,
    byFamily: byFamily.map((f) => ({ family: f.family ?? "Other", revenue: num(f.revenue), cogs: num(f.cogs) })),
  };
}

export async function getAccountBalances(db: Sql, ctx: ServiceContext) {
  authorize(ctx, "finance.view");
  const rows = await db.query<{ id: string; code: string; name: string; account_type: string; debit: string; credit: string }>(
    `select a.id, a.code, a.name, a.account_type, coalesce(sum(jl.debit), 0) as debit, coalesce(sum(jl.credit), 0) as credit
     from accounts a left join journal_lines jl on jl.account_id = a.id where a.organization_id = $1 group by a.id order by a.code`,
    [ctx.orgId],
  );
  return rows.map((r) => ({ ...r, debit: num(r.debit), credit: num(r.credit), balance: num(r.debit) - num(r.credit) }));
}

export async function listInvoices(db: Sql, ctx: ServiceContext, today: string) {
  authorize(ctx, "finance.view");
  const rows = await db.query<{ id: string; invoice_number: string; status: string; customer: string; so_id: string | null; so_number: string | null; invoice_date: string; due_date: string; total: string; amount_paid: string }>(
    `select i.id, i.invoice_number, i.status, c.name as customer, so.id as so_id, so.so_number, i.invoice_date::text, i.due_date::text, i.total, i.amount_paid
     from invoices i join customers c on c.id = i.customer_id left join sales_orders so on so.id = i.sales_order_id
     where i.organization_id = $1 order by i.invoice_date desc, i.invoice_number desc`,
    [ctx.orgId],
  );
  return rows.map((r) => {
    const open = num(r.total) - num(r.amount_paid);
    const late = r.status === "issued" ? diffDays(today, r.due_date) : 0;
    return { ...r, total: num(r.total), paid: num(r.amount_paid), open, daysOverdue: late > 0 ? late : 0, overdue: r.status === "issued" && late > 0 };
  });
}

export async function listBills(db: Sql, ctx: ServiceContext, today: string) {
  authorize(ctx, "finance.view");
  const rows = await db.query<{ id: string; bill_number: string; status: string; supplier: string; po_id: string | null; po_number: string | null; bill_date: string; due_date: string; total: string; amount_paid: string }>(
    `select b.id, b.bill_number, b.status, s.name as supplier, po.id as po_id, po.po_number, b.bill_date::text, b.due_date::text, b.total, b.amount_paid
     from supplier_bills b join suppliers s on s.id = b.supplier_id left join purchase_orders po on po.id = b.purchase_order_id
     where b.organization_id = $1 order by b.bill_date desc`,
    [ctx.orgId],
  );
  return rows.map((r) => ({ ...r, total: num(r.total), open: num(r.total) - num(r.amount_paid), overdue: r.status === "open" && r.due_date < today }));
}

export async function listJournal(db: Sql, ctx: ServiceContext, from: string, to: string) {
  authorize(ctx, "finance.view");
  const rows = await db.query<{ id: string; entry_number: string; entry_date: string; description: string; source_type: string; source_id: string | null; lines: { code: string; name: string; debit: string; credit: string; memo: string | null }[] }>(
    `select je.id, je.entry_number, je.entry_date::text, je.description, je.source_type, je.source_id,
            json_agg(json_build_object('code', a.code, 'name', a.name, 'debit', jl.debit::text, 'credit', jl.credit::text, 'memo', jl.memo) order by jl.debit desc) as lines
     from journal_entries je join journal_lines jl on jl.journal_entry_id = je.id join accounts a on a.id = jl.account_id
     where je.organization_id = $1 and je.entry_date between $2 and $3
     group by je.id order by je.posted_at desc limit 300`,
    [ctx.orgId, from, to],
  );
  return rows.map((r) => ({ ...r, amount: r.lines.reduce((s, l) => s + num(l.debit), 0) }));
}
