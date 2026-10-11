import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "../config";

export const SESSION_COOKIE = "ff_session";
export const ORG_COOKIE = "ff_org";
export const SITE_COOKIE = "ff_site";
export const RANGE_COOKIE = "ff_range";

const MAX_AGE = 60 * 60 * 24 * 7;

interface DemoSession {
  pid: string;
  iat: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function encodeSession(session: DemoSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): DemoSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as DemoSession;
    if (!session.pid || Date.now() / 1000 - session.iat > MAX_AGE) return null;
    return session;
  } catch {
    return null;
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};

export async function readDemoSession(): Promise<DemoSession | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function writeDemoSession(profileId: string) {
  (await cookies()).set(SESSION_COOKIE, encodeSession({ pid: profileId, iat: Math.floor(Date.now() / 1000) }), cookieOptions);
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
}

export async function writePreference(name: typeof ORG_COOKIE | typeof SITE_COOKIE | typeof RANGE_COOKIE, value: string) {
  (await cookies()).set(name, value, { ...cookieOptions, httpOnly: name === ORG_COOKIE });
}

export async function readPreference(name: typeof ORG_COOKIE | typeof SITE_COOKIE | typeof RANGE_COOKIE) {
  return (await cookies()).get(name)?.value;
}
