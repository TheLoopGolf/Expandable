import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./errors";

/** Render the not-found page for records outside the caller's organization or missing ids. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    const code = (err as { code?: string })?.code;
    if (code === "22P02") notFound(); // malformed uuid in the URL
    throw err;
  }
}
