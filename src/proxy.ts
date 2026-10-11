import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Request gate. It only does the cheap, optimistic part: send visitors without a session
 * to /login and keep Supabase auth cookies fresh. Every page, server action and service
 * still verifies the session and permissions itself — this is not the authorization layer.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function toLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.AUTH_MODE === "supabase") {
    let response = NextResponse.next({ request });
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request });
          for (const c of list) response.cookies.set(c.name, c.value, c.options);
        },
      },
    });
    // getUser() validates the token with Supabase and refreshes it when needed.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user && !isPublic(pathname)) return toLogin(request);
    return response;
  }

  // Demo mode: the signed cookie is verified by the server code that reads it.
  if (!isPublic(pathname) && !request.cookies.has("ff_session")) return toLogin(request);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
