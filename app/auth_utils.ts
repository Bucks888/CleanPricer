import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'medpartners_session';
export const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 8;

type AdminCredentials = {
  username: string;
  password: string;
};

export type AuthSession = {
  username: string;
  expiresAt: number;
};

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.GEMINI_API_KEY || process.env.DATABASE_URL || 'cleanpricer-session-secret';
}

export function getAdminCredentials(): AdminCredentials {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin12345',
  };
}

export function createAuthToken(username: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + AUTH_SESSION_TTL_SECONDS;
  const payload = JSON.stringify({ username, expiresAt });
  const payloadPart = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(payloadPart).digest('base64url');
  return `${payloadPart}.${sig}`;
}

export function parseAuthToken(token: string | null | undefined): AuthSession | null {
  if (!token) return null;

  const [payloadPart, sig] = token.split('.');
  if (!payloadPart || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(payloadPart).digest('base64url');
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as AuthSession;
    if (!parsed.username || typeof parsed.expiresAt !== 'number') {
      return null;
    }

    if (parsed.expiresAt * 1000 < Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function readCookieValue(cookieHeader: string | null, cookieName: string) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((part) => part.trim());
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = cookie.slice(0, separatorIndex);
    if (name === cookieName) {
      return cookie.slice(separatorIndex + 1);
    }
  }

  return null;
}

export function getSessionFromHeaders(cookieHeader: string | null) {
  return parseAuthToken(readCookieValue(cookieHeader, AUTH_COOKIE_NAME));
}

export function requireAuthenticatedSession(cookieHeader: string | null) {
  const session = getSessionFromHeaders(cookieHeader);
  if (!session) {
    return null;
  }

  return session;
}

export function createAuthErrorResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function authCookieOptions(maxAgeSeconds = AUTH_SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
