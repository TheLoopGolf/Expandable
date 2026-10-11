import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every ERP page is per-user and per-tenant, so routes render dynamically.
  // (Cache Components is intentionally left off; see IMPLEMENTATION_PLAN.md.)
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/**/*.sql"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
