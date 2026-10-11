import type { Sql } from "../db";

const STARTS: Record<string, number> = {
  PO: 4001,
  SO: 7001,
  WO: 2001,
  SH: 5001,
  GR: 3001,
  INV: 9001,
  NCR: 101,
  CMP: 21,
  DEV: 11,
  AUD: 11,
  CAPA: 51,
  ECO: 31,
  MRP: 1,
  JE: 10001,
  PAY: 6001,
  BILL: 8001,
  INS: 1001,
  ADJ: 1001,
  TRF: 1001,
};

/** Concurrency-safe document numbers (row-locked counter per org and prefix). */
export async function nextNumber(tx: Sql, orgId: string, prefix: string): Promise<string> {
  const start = STARTS[prefix] ?? 1;
  const rows = await tx.query<{ value: number }>(
    `insert into number_sequences (organization_id, prefix, next_value)
     values ($1, $2, $3)
     on conflict (organization_id, prefix)
     do update set next_value = number_sequences.next_value + 1
     returning next_value as value`,
    [orgId, prefix, start],
  );
  return `${prefix}-${rows[0].value}`;
}
