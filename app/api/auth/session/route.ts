import { NextResponse } from 'next/server';
import { getSessionFromHeaders } from '../../../auth_utils';

export async function GET(req: Request) {
  const session = getSessionFromHeaders(req.headers.get('cookie'));
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: { username: session.username },
  });
}
