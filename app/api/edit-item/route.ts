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
    const {
      item_id,
      service_id,
      service_name_raw,
      price_resident_kzt,
      price_nonresident_kzt,
      currency_original,
      is_verified,
      verification_note
    } = body;

    if (!isUuidLike(item_id)) {
      return NextResponse.json({ error: 'Параметр item_id обязателен и должен быть UUID' }, { status: 400 });
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (fieldName: string, value: any) => {
      if (value !== undefined) {
        updates.push(`${fieldName} = $${paramIndex++}`);
        values.push(value);
      }
    };

    // service_id can be UUID or null
    if (service_id !== undefined) {
      if (service_id === null || isUuidLike(service_id)) {
        updates.push(`service_id = $${paramIndex++}`);
        values.push(service_id);
      } else {
        return NextResponse.json({ error: 'Некорректный формат service_id' }, { status: 400 });
      }
    }

    addField('service_name_raw', service_name_raw);
    addField('price_resident_kzt', price_resident_kzt !== null && price_resident_kzt !== undefined ? Number(price_resident_kzt) : null);
    addField('price_nonresident_kzt', price_nonresident_kzt !== null && price_nonresident_kzt !== undefined ? Number(price_nonresident_kzt) : null);
    addField('currency_original', currency_original);
    addField('is_verified', is_verified);
    addField('verification_note', verification_note);

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 });
    }

    values.push(item_id);
    const query = `
      UPDATE price_items
      SET ${updates.join(', ')}
      WHERE item_id = $${paramIndex}
      RETURNING *
    `;

    const res = await pool.query(query, values);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Позиция не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error in edit-item endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
