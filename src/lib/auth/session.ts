import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'session';
/** signed out after this long without activity (user decision 11-Oct-2026: 15 minutes) */
export const IDLE_SECONDS = 15 * 60;
/** and never longer than this after signing in, however active */
const MAX_SESSION_SECONDS = 60 * 60 * 12;
/** a session is renewed by activity at most this often */
const RENEW_AFTER_SECONDS = 60;

export interface SessionPayload {
  uid: number;
  role: 'ADMIN' | 'FINANCE' | 'PM' | 'FM';
  coordinator: string | null;
  name: string;
  /** users.session_version at sign-in; a mismatch means the session was revoked (sign-out, password or role change) */
  sv?: number;
  /** when the user signed in (seconds since 1970) */
  at?: number;
}

type Verified = SessionPayload & { iat?: number; exp?: number };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
  return new TextEncoder().encode(s);
}

const now = () => Math.floor(Date.now() / 1000);

/** A session token that expires after IDLE_SECONDS unless activity renews it (see renewSession). */
export async function signSession(payload: SessionPayload) {
  const { uid, role, coordinator, name, sv } = payload;
  return new SignJWT({ uid, role, coordinator, name, sv, at: payload.at ?? now() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${IDLE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<Verified | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const p = payload as unknown as Verified;
    if (p.at && now() - p.at > MAX_SESSION_SECONDS) return null;
    return p;
  } catch {
    return null;
  }
}

/** A fresh token for an active session (null: no renewal due yet). Keeps the sign-in time. */
export async function renewSession(p: Verified): Promise<string | null> {
  if (p.iat && now() - p.iat < RENEW_AFTER_SECONDS) return null;
  return signSession(p);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  path: '/',
  // the cookie may outlive the token: the token's own expiry (idle) decides
  maxAge: MAX_SESSION_SECONDS,
};
