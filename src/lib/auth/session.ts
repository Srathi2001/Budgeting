import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  uid: number;
  role: 'ADMIN' | 'FINANCE' | 'PM' | 'FM';
  coordinator: string | null;
  name: string;
  /** users.session_version at sign-in; a mismatch means the session was revoked */
  sv?: number;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};
