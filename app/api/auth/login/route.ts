import { NextResponse } from 'next/server';
import { authCookieOptions, createAuthToken, getAdminCredentials } from '../../../auth_utils';
import crypto from 'crypto';

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    const credentials = getAdminCredentials();
    if (!username || !password || !safeEqual(username, credentials.username) || !safeEqual(password, credentials.password)) {
      return NextResponse.json({ error: 'Неверные учетные данные' }, { status: 401 });
    }

    const response = NextResponse.json({
      success: true,
      user: { username },
    });
    response.cookies.set('medpartners_session', createAuthToken(username), authCookieOptions());
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
