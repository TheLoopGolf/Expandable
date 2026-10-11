import { dateInTz, parseIsoDate, type IsoDate } from "@/lib/dates";
import type { ServiceContext } from "../context";
import type { RoleKey } from "@/lib/permissions";

/** Deterministic PRNG (mulberry32) so the demo data is reproducible. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (min: number, max: number) => min + (max - min) * next(),
    int: (min: number, max: number) => Math.floor(min + (max - min + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    weighted: <T>(list: readonly { value: T; weight: number }[]): T => {
      const total = list.reduce((s, x) => s + x.weight, 0);
      let r = next() * total;
      for (const x of list) {
        r -= x.weight;
        if (r <= 0) return x.value;
      }
      return list[list.length - 1].value;
    },
  };
}
export type Rng = ReturnType<typeof createRng>;

/** First instant of a business date in a timezone. */
export function startOfDayInstant(d: IsoDate, timeZone: string): Date {
  const base = parseIsoDate(d).getTime();
  for (let h = -14; h <= 14; h++) {
    const t = new Date(base + h * 3_600_000);
    if (dateInTz(t, timeZone) === d) {
      // step back in 15-minute increments to the boundary
      let x = t.getTime();
      while (dateInTz(new Date(x - 900_000), timeZone) === d) x -= 900_000;
      return new Date(x);
    }
  }
  return new Date(base);
}

/** A movable clock shared by all seed contexts; advances a little per action. */
export class SeedClock {
  private current = new Date();
  private ceiling: number | null = null;
  set(instant: Date, ceiling?: Date) {
    this.current = new Date(instant);
    this.ceiling = ceiling ? ceiling.getTime() : null;
  }
  /** Advance a few seconds per call so events keep their order; never pass the ceiling. */
  now = () => {
    const next = this.current.getTime() + 4_000;
    this.current = new Date(this.ceiling !== null ? Math.min(next, this.ceiling) : next);
    return new Date(this.current);
  };
}

export function seedContext(
  clock: SeedClock,
  org: { id: string; name: string; timezone: string },
  person: { id: string; name: string },
  role: RoleKey = "admin",
): ServiceContext {
  return {
    orgId: org.id,
    orgName: org.name,
    userId: person.id,
    userName: person.name,
    role,
    timezone: org.timezone,
    now: clock.now,
    seed: true,
  };
}

export function isWeekday(d: IsoDate): boolean {
  const dow = parseIsoDate(d).getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function dow(d: IsoDate): number {
  return parseIsoDate(d).getUTCDay();
}

export function yymmdd(d: IsoDate): string {
  return d.slice(2).replace(/-/g, "");
}

let keyCounter = 0;
export function idemKey(prefix: string): string {
  keyCounter++;
  return `seed-${prefix}-${keyCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
