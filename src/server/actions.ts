import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getDb, type Database } from "./db";
import { AppError, describeDbError } from "./errors";
import { getCurrentUser, type CurrentUser } from "./auth/current";

export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wrap a server action: resolves the session (never trusting the client), runs the
 * service call, maps domain/database/validation errors to messages, and revalidates
 * every route so dashboards and lists reflect the new state immediately.
 */
export async function runAction<T>(
  fn: (user: CurrentUser, db: Database) => Promise<T>,
  opts: { success?: string | ((result: T) => string) } = {},
): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  try {
    const db = await getDb();
    const result = await fn(user, db);
    revalidatePath("/", "layout");
    const message = typeof opts.success === "function" ? opts.success(result) : opts.success;
    return { ok: true, message, data: result };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
      const first = err.issues[0];
      return { ok: false, error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input", fieldErrors };
    }
    const dbMessage = describeDbError(err);
    if (dbMessage) return { ok: false, error: dbMessage };
    console.error("[forgeflow] action failed", err);
    return { ok: false, error: "Something went wrong. The change was not saved." };
  }
}
