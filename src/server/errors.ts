/** Errors raised by the service layer; server actions turn them into user-facing messages. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "forbidden" | "not_found" | "conflict" | "unauthenticated",
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, "validation", 400, fieldErrors);
    this.name = "ValidationError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "forbidden", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} was not found in this organization.`, "not_found", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict", 409);
    this.name = "ConflictError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("Please sign in to continue.", "unauthenticated", 401);
    this.name = "UnauthenticatedError";
  }
}

/** Translate Postgres constraint errors into readable messages. */
export function describeDbError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; message?: string; constraint?: string };
  switch (e.code) {
    case "23514": {
      const msg = e.message ?? "";
      if (msg.includes("qty_on_hand")) return "Insufficient stock: inventory cannot go negative.";
      if (msg.includes("quantity_received")) return "Cannot receive more than the ordered quantity.";
      if (msg.includes("quantity_shipped")) return "Cannot ship more than the ordered quantity.";
      if (msg.toLowerCase().includes("circular")) return msg;
      return `A business rule was violated (${msg}).`;
    }
    case "23505":
      return "A record with the same unique key already exists.";
    case "23503":
      return "A referenced record does not exist.";
    case "55000":
      return e.message ?? "This record cannot be changed.";
    default:
      return null;
  }
}
