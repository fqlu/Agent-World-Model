// App sign-in (Google OAuth) — a signed session cookie, checked by src/proxy.ts.
// Sign-in is ON only when an allowlist is configured:
//   AUTH_ALLOWED_EMAILS=a@x.com,b@y.com   and/or   AUTH_ALLOWED_DOMAINS=vivanti.com
// plus SESSION_SECRET (≥ 32 random chars) and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
// Without an allowlist (local use) the app stays open, as before.
// Web Crypto only, so this module runs in the proxy as well as in route handlers.

export const SESSION_COOKIE = "awm_session";
export const STATE_COOKIE = "awm_oauth_state";
const SESSION_DAYS = 7;

export type Session = { email: string; exp: number };

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function authEnabled(): boolean {
  return list(process.env.AUTH_ALLOWED_EMAILS).length > 0 || list(process.env.AUTH_ALLOWED_DOMAINS).length > 0;
}

export function isAllowed(email: string): boolean {
  const e = email.toLowerCase();
  if (list(process.env.AUTH_ALLOWED_EMAILS).includes(e)) return true;
  const domain = e.split("@")[1] ?? "";
  return list(process.env.AUTH_ALLOWED_DOMAINS).includes(domain);
}

// Public base URL (Cloud Run URL in production); falls back to the request origin.
export function baseUrl(requestOrigin: string): string {
  return (process.env.APP_URL ?? requestOrigin).replace(/\/+$/, "");
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (ch) => ch.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters) when sign-in is enabled");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(email: string): Promise<string> {
  const payload: Session = { email, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof s.email !== "string" || typeof s.exp !== "number" || s.exp < Date.now()) return null;
    return isAllowed(s.email) ? s : null; // allowlist changes take effect immediately
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
