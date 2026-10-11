/** Runtime configuration derived from environment variables (server only). */
export const config = {
  /** "demo" = persona picker with signed cookies; "supabase" = Supabase Auth email/password. */
  authMode: (process.env.AUTH_MODE === "supabase" ? "supabase" : "demo") as "demo" | "supabase",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "forgeflow-local-demo-secret-change-me",
  /** Demo reset is always allowed on the embedded database; on Postgres it must be opted in. */
  allowDemoReset: !process.env.DATABASE_URL || process.env.ALLOW_DEMO_RESET === "true",
  isDemoDatabase: !process.env.DATABASE_URL,
};
