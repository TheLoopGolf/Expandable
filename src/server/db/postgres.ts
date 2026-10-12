import postgres from "postgres";
import type { Database, Sql, TxSql } from "./types";

export function createPostgresDatabase(url: string): Database {
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: process.env.DATABASE_PREPARE === "true",
    connection: { TimeZone: "UTC" },
    onnotice: () => {},
    types: {
      dateonly: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
      int8: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
      // Services bind JSON as already-serialized text (`$1::jsonb`), as PGlite expects. The
      // driver's default would JSON.stringify that text again and store a string scalar.
      json: {
        to: 114,
        from: [114, 3802],
        serialize: (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value)),
        parse: (value: string) => JSON.parse(value),
      },
    },
  });

  const wrap = (q: postgres.Sql | postgres.TransactionSql): Sql => ({
    async query<T>(text: string, params?: readonly unknown[]) {
      const rows = await q.unsafe(text, (params ?? []) as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
  });

  return {
    kind: "postgres",
    ...wrap(client),
    async exec(text: string) {
      // Simple-query protocol so a script can contain several statements.
      await client.unsafe(text).simple();
    },
    async transaction<T>(fn: (tx: TxSql) => Promise<T>) {
      return (await client.begin((tx) =>
        fn({
          ...wrap(tx),
          async exec(text: string) {
            await tx.unsafe(text).simple();
          },
        }),
      )) as T;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
