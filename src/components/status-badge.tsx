import { statusLabel, statusTone, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
  info: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/20",
  progress: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  danger: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20",
  muted: "bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-white/[0.03] dark:text-zinc-400 dark:ring-white/10",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-zinc-400",
  info: "bg-blue-500",
  progress: "bg-violet-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
  muted: "bg-zinc-300 dark:bg-zinc-600",
};

export function ToneBadge({ tone, children, className, dot = true }: { tone: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOTS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Status pill. `late` overlays the shared Late state for open records past due. */
export function StatusBadge({ status, late, className }: { status: string; late?: boolean; className?: string }) {
  if (late) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <ToneBadge tone="danger">Late</ToneBadge>
        <ToneBadge tone={statusTone(status)} dot={false}>
          {statusLabel(status)}
        </ToneBadge>
      </span>
    );
  }
  return (
    <ToneBadge tone={statusTone(status)} className={className}>
      {statusLabel(status)}
    </ToneBadge>
  );
}

const SEVERITY_TONE: Record<string, Tone> = { critical: "danger", high: "danger", medium: "warning", low: "neutral" };

export function SeverityBadge({ severity }: { severity: string }) {
  return <ToneBadge tone={SEVERITY_TONE[severity] ?? "neutral"}>{statusLabel(severity)}</ToneBadge>;
}
