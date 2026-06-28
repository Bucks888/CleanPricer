import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import { isUuidLike } from '../../safe_utils';

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const item_id = body?.item_id;
    const is_verified = body?.is_verified;
    const verification_note = body?.verification_note;

    if (!isUuidLike(item_id)) {
      return NextResponse.json({ error: 'Параметр item_id обязателен и должен быть UUID' }, { status: 400 });
    }

    const verified = is_verified !== false;
    const note = typeof verification_note === 'string' && verification_note.trim()
      ? verification_note.trim()
      : 'Подтверждено вручную';

    const res = await pool.query(
      `UPDATE price_items
       SET is_verified = $1, verification_note = $2
       WHERE item_id = $3
       RETURNING *`,
      [verified, note, item_id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Позиция прайса не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error in verify endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
