import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function POST(req: Request) {
  try {
    const { item_id, is_verified, verification_note } = await req.json();
    if (!item_id) {
      return NextResponse.json({ error: 'Параметр item_id обязателен' }, { status: 400 });
    }

    const verified = is_verified !== false; // default to true
    const note = verification_note || 'Подтверждено вручную';

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
  } catch (error: any) {
    console.error('Error in verify endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
