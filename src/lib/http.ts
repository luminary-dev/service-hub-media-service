// Canonical shared helpers — every service keeps an identical copy at
// src/lib/http.ts (services are self-contained; no shared package).
import type { Context, Next } from "hono";

export type AuthUser = { userId: string; role: string; name: string };

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "dev-internal-secret";

// Services are never exposed publicly; only the gateway is. Every request must
// carry the internal secret the gateway (or a sibling service) attaches.
// Applied globally except /healthz.
export async function requireInternalSecret(c: Context, next: Next) {
  if (c.req.header("x-internal-secret") !== INTERNAL_SECRET) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
}

// Identity forwarded by the gateway after JWT verification. Absent headers
// mean an unauthenticated request — each route decides its own 401/403.
export function getAuth(c: Context): AuthUser | null {
  const userId = c.req.header("x-user-id");
  if (!userId) return null;
  return {
    userId,
    role: c.req.header("x-user-role") ?? "CUSTOMER",
    name: decodeURIComponent(c.req.header("x-user-name") ?? ""),
  };
}

export function getLocale(c: Context): "en" | "si" {
  return c.req.header("x-locale") === "si" ? "si" : "en";
}

// Public web origin, for links embedded in emails.
export function getOrigin(c: Context): string {
  return c.req.header("x-origin") ?? process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

// Service-to-service call. Callers pass the peer base URL from env
// (e.g. process.env.IDENTITY_SERVICE_URL).
export async function s2s(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  // FormData bodies (file uploads) must keep the multipart content-type +
  // boundary fetch sets for them, and need a longer budget for processing.
  const isForm = init.body instanceof FormData;
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
      "x-internal-secret": INTERNAL_SECRET,
    },
    signal: AbortSignal.timeout(isForm ? 15000 : 5000),
  });
}
