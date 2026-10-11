import type { Sql } from "../db";
import type { ServiceContext } from "../context";
import { today } from "../context";
import { round, toStr, type Dec } from "@/lib/decimal";
import { nextNumber } from "./numbering";

/** Chart of accounts created for every organization. */
export const CHART_OF_ACCOUNTS = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1200", name: "Accounts Receivable", type: "asset" },
  { code: "1300", name: "Inventory", type: "asset" },
  { code: "1350", name: "Work in Process", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Goods Received Not Invoiced", type: "liability" },
  { code: "3000", name: "Owner Equity", type: "equity" },
  { code: "4000", name: "Product Revenue", type: "revenue" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5100", name: "Purchase Price Variance", type: "expense" },
  { code: "5200", name: "Production Scrap", type: "expense" },
  { code: "5300", name: "Inventory Adjustments", type: "expense" },
  { code: "5400", name: "Applied Labor & Overhead", type: "expense" },
  { code: "5450", name: "Production Variances", type: "expense" },
] as const;

export type AccountCode = (typeof CHART_OF_ACCOUNTS)[number]["code"];

export interface JournalLineInput {
  account: AccountCode;
  /** Positive = debit, negative = credit. */
  amount: Dec;
  memo?: string;
}

/** Account ids never change once created, so they are cached per organization. */
const accountCache = new Map<string, Map<string, string>>();

export async function ensureChartOfAccounts(tx: Sql, orgId: string): Promise<void> {
  accountCache.delete(orgId);
  for (const a of CHART_OF_ACCOUNTS) {
    await tx.query(
      `insert into accounts (organization_id, code, name, account_type) values ($1, $2, $3, $4)
       on conflict (organization_id, code) do nothing`,
      [orgId, a.code, a.name, a.type],
    );
  }
}

/**
 * Post a balanced operational journal entry. Amounts are rounded to cents; any rounding
 * difference is absorbed by the last line so the entry always balances (the database
 * also rejects unbalanced entries at commit).
 */
export async function postJournal(
  tx: Sql,
  ctx: ServiceContext,
  entry: { description: string; sourceType: string; sourceId?: string | null; lines: JournalLineInput[] },
): Promise<void> {
  const lines = entry.lines.map((l) => ({ ...l, amount: round(l.amount, 2) })).filter((l) => l.amount !== 0n);
  if (lines.length === 0) return;
  const total = lines.reduce((a, l) => a + l.amount, 0n);
  if (total !== 0n) lines[lines.length - 1].amount -= total;
  const nonZero = lines.filter((l) => l.amount !== 0n);
  if (nonZero.length < 2) return;

  let byCode = accountCache.get(ctx.orgId);
  if (!byCode || byCode.size < CHART_OF_ACCOUNTS.length) {
    const accounts = await tx.query<{ id: string; code: string }>(`select id, code from accounts where organization_id = $1`, [ctx.orgId]);
    byCode = new Map(accounts.map((a) => [a.code, a.id]));
    accountCache.set(ctx.orgId, byCode);
  }
  const number = await nextNumber(tx, ctx.orgId, "JE");
  const [je] = await tx.query<{ id: string }>(
    `insert into journal_entries
       (organization_id, entry_number, entry_date, description, source_type, source_id, created_by, posted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ctx.orgId, number, today(ctx), entry.description, entry.sourceType, entry.sourceId ?? null, ctx.userId, ctx.now()],
  );
  for (const l of nonZero) {
    const accountId = byCode.get(l.account);
    if (!accountId) {
      accountCache.delete(ctx.orgId);
      throw new Error(`Account ${l.account} missing for organization`);
    }
    await tx.query(
      `insert into journal_lines (organization_id, journal_entry_id, account_id, debit, credit, memo)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        ctx.orgId,
        je.id,
        accountId,
        l.amount > 0n ? toStr(l.amount, 2) : "0",
        l.amount < 0n ? toStr(-l.amount, 2) : "0",
        l.memo ?? null,
      ],
    );
  }
}
