/**
 * Consistent status vocabulary across modules. Each raw status maps to a display label and
 * one of a small set of tones so Draft / Released / In Progress / On Hold / Completed /
 * Late / Rejected / Canceled look the same everywhere.
 */
export type Tone = "neutral" | "info" | "progress" | "warning" | "success" | "danger" | "muted";

const LABELS: Record<string, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  released: ["Released", "info"],
  approved: ["Approved", "info"],
  confirmed: ["Confirmed", "info"],
  open: ["Open", "info"],
  in_progress: ["In Progress", "progress"],
  investigating: ["Investigating", "progress"],
  in_review: ["In Review", "progress"],
  partially_received: ["Partially Received", "progress"],
  partially_shipped: ["Partially Shipped", "progress"],
  pending_disposition: ["Pending Disposition", "warning"],
  pending: ["Pending", "neutral"],
  on_hold: ["On Hold", "warning"],
  hold: ["On Hold", "warning"],
  quarantine: ["Quarantine", "warning"],
  active: ["Active", "success"],
  available: ["Available", "success"],
  completed: ["Completed", "success"],
  received: ["Received", "success"],
  shipped: ["Shipped", "success"],
  implemented: ["Implemented", "success"],
  verified: ["Verified", "success"],
  paid: ["Paid", "success"],
  issued: ["Issued", "info"],
  pass: ["Pass", "success"],
  done: ["Done", "success"],
  closed: ["Closed", "muted"],
  late: ["Late", "danger"],
  overdue: ["Overdue", "danger"],
  expired: ["Expired", "danger"],
  fail: ["Fail", "danger"],
  rejected: ["Rejected", "danger"],
  blocked: ["Blocked", "danger"],
  canceled: ["Canceled", "muted"],
  void: ["Void", "muted"],
  dismissed: ["Dismissed", "muted"],
  superseded: ["Superseded", "muted"],
  obsolete: ["Obsolete", "muted"],
  low: ["Low", "neutral"],
  normal: ["Normal", "neutral"],
  medium: ["Medium", "warning"],
  high: ["High", "danger"],
  urgent: ["Urgent", "danger"],
  critical: ["Critical", "danger"],
};

export function statusLabel(status: string): string {
  return LABELS[status]?.[0] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(status: string): Tone {
  return LABELS[status]?.[1] ?? "neutral";
}

export const OPEN_WO_STATUSES = ["released", "in_progress", "on_hold"] as const;
export const OPEN_SO_STATUSES = ["confirmed", "partially_shipped", "on_hold"] as const;
export const OPEN_PO_STATUSES = ["approved", "partially_received"] as const;
export const OPEN_QE_STATUSES = ["open", "investigating", "pending_disposition"] as const;

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
