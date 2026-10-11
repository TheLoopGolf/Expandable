/** Runtime configuration derived from environment variables (server only). */
const DEV_SECRET = "forgeflow-local-demo-secret-change-me";

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET && process.env.AUTH_MODE !== "supabase") {
  console.warn("[forgeflow] SESSION_SECRET is not set; demo session cookies use a public development secret. Set SESSION_SECRET for any shared deployment.");
}

export const config = {
  /** "demo" = persona picker with signed cookies; "supabase" = Supabase Auth email/password. */
  authMode: (process.env.AUTH_MODE === "supabase" ? "supabase" : "demo") as "demo" | "supabase",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  sessionSecret: process.env.SESSION_SECRET || DEV_SECRET,
  /** Demo reset is always allowed on the embedded database; on Postgres it must be opted in. */
  allowDemoReset: !process.env.DATABASE_URL || process.env.ALLOW_DEMO_RESET === "true",
  isDemoDatabase: !process.env.DATABASE_URL,
};
