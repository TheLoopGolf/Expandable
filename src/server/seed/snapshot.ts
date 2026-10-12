/**
 * Bulk seeding for remote PostgreSQL (Supabase).
 *
 * The demo history is produced by replaying ~180 days of transactions through the services,
 * which issues hundreds of thousands of small queries. That is fine against the embedded
 * database but would take hours across a network. Instead the history is generated in an
 * in-memory PGlite (same schema, same services) and copied to the target as ~100 bulk
 * `insert … select from json_populate_recordset(…)` statements in one transaction.
 */
import type { Database } from "../db";
import { createPgliteDatabase } from "../db/pglite";
import { listMigrations, migrate } from "../db/migrate";
import { seedDemo, type SeedOptions } from "./index";

const MAX_BATCH_BYTES = 180_000;

/**
 * Turn the contents of `source` into self-contained insert statements in foreign-key order.
 * Each statement can run in its own transaction: journal lines are batched by entry so every
 * batch satisfies the deferred balanced-journal check. Identity sequences are advanced at the end.
 */
export async function snapshotStatements(source: Database, opts: { markMigrations?: boolean } = {}): Promise<{ statements: string[]; rows: number }> {
  const tables = (await source.query<{ name: string }>(`select tablename as name from pg_tables where schemaname = 'public'`)).map((t) => t.name);
  const deps = await source.query<{ child: string; parent: string }>(
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
     from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`,
  );
  const statements: string[] = [];
  let total = 0;

  for (const table of topoSort(tables, deps)) {
    const cols = await source.query<{ name: string; identity: string; generated: string }>(
      `select a.attname as name, a.attidentity as identity, a.attgenerated as generated
       from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
      [`public.${table}`],
    );
    const insertable = cols.filter((c) => c.generated === "").map((c) => `"${c.name}"`).join(", ");
    const overriding = cols.some((c) => c.identity === "a") ? " overriding system value" : "";
    const has = (name: string) => cols.some((c) => c.name === name);
    const orderBy = table === "journal_lines" ? "journal_entry_id, id" : has("seq") ? "seq" : has("id") ? "id" : "1";
    const rows = await source.query<{ j: string; grp: string | null }>(
      `select row_to_json(t)::text as j, ${table === "journal_lines" ? "t.journal_entry_id::text" : "null"} as grp
       from public.${table} t order by ${orderBy}`,
    );
    total += rows.length;

    let batch: string[] = [];
    let size = 0;
    const flush = () => {
      if (!batch.length) return;
      const json = `[${batch.join(",")}]`;
      if (json.includes("$ffjson$")) throw new Error(`Unsafe content in ${table}`);
      statements.push(
        `insert into public.${table} (${insertable})${overriding}\nselect ${insertable} from json_populate_recordset(null::public.${table}, $ffjson$${json}$ffjson$::json)`,
      );
      batch = [];
      size = 0;
    };
    for (let i = 0; i < rows.length; i++) {
      batch.push(rows[i].j);
      size += rows[i].j.length + 1;
      const groupContinues = !!rows[i + 1] && rows[i].grp !== null && rows[i + 1].grp === rows[i].grp;
      if (size >= MAX_BATCH_BYTES && !groupContinues) flush();
    }
    flush();
  }

  const identities = await source.query<{ tbl: string; col: string }>(
    `select c.relname as tbl, a.attname as col from pg_attribute a join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and a.attidentity <> ''`,
  );
  for (const i of identities) {
    statements.push(
      `select setval(pg_get_serial_sequence('public.${i.tbl}', '${i.col}'), coalesce((select max("${i.col}") from public.${i.tbl}), 0) + 1, false)`,
    );
  }
  if (opts.markMigrations) {
    statements.push(`create schema if not exists app`);
    statements.push(`create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    for (const m of listMigrations()) statements.push(`insert into app.schema_migrations (name) values ('${m.name.replace(/'/g, "''")}') on conflict do nothing`);
  }
  return { statements, rows: total };
}

/**
 * Generate the demo history in memory and copy it into `target` (migrated). With `replace`,
 * existing business data is truncated in the same transaction, so a failed copy leaves the
 * previous data untouched.
 */
export async function seedFromSnapshot(target: Database, opts: SeedOptions & { replace?: boolean } = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const source = await createPgliteDatabase("memory://");
  try {
    await migrate(source);
    await seedDemo(source, opts);
    const { statements, rows } = await snapshotStatements(source);
    log(`copying ${rows} rows to PostgreSQL in ${statements.length} statements`);
    const started = Date.now();
    const truncate = opts.replace ? await truncateStatement(target) : null;
    await target.transaction(async (tx) => {
      if (truncate) await tx.query(truncate);
      for (const s of statements) await tx.query(s);
    });
    log(`copy complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await source.close();
  }
}

/** One TRUNCATE over every table the seed writes (roles included; the seed recreates them). */
export async function truncateStatement(db: Database): Promise<string> {
  const tables = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
  return `truncate ${tables.map((t) => `public."${t.tablename}"`).join(", ")} restart identity cascade`;
}

function topoSort(tables: string[], deps: { child: string; parent: string }[]): string[] {
  const strip = (t: string) => t.replace(/^public\./, "").replace(/"/g, "");
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const d of deps) parents.get(strip(d.child))?.add(strip(d.parent));
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p) || !parents.has(p))).sort();
    if (!ready.length) throw new Error(`Foreign-key cycle among: ${tables.filter((t) => !done.has(t)).join(", ")}`);
    for (const t of ready) {
      done.add(t);
      out.push(t);
    }
  }
  return out;
}
