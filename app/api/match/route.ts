import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import { isUuidLike } from '../../safe_utils';

function parseSynonyms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const item_id = body?.item_id;
    const service_id = body?.service_id;
    const verification_note = body?.verification_note;

    if (!isUuidLike(item_id) || !isUuidLike(service_id)) {
      return NextResponse.json(
        { error: 'Параметры item_id и service_id обязательны и должны быть UUID' },
        { status: 400 }
      );
    }

    const note =
      typeof verification_note === 'string' && verification_note.trim()
        ? verification_note.trim()
        : 'Сопоставлено вручную';

    const res = await pool.query(
      `UPDATE price_items
       SET service_id = $1, is_verified = true, verification_note = $2
       WHERE item_id = $3
       RETURNING *`,
      [service_id, note, item_id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Позиция прайса не найдена' }, { status: 404 });
    }

    const item = res.rows[0];
    const serviceRes = await pool.query('SELECT synonyms, service_name FROM services WHERE service_id = $1', [
      service_id,
    ]);

    if (serviceRes.rows.length > 0) {
      const service = serviceRes.rows[0];
      const synonymsList = parseSynonyms(service.synonyms);
      const rawNameClean = String(item.service_name_raw || '').trim();
      const nameClean = String(service.service_name || '').trim();

      if (
        rawNameClean &&
        rawNameClean.toLowerCase() !== nameClean.toLowerCase() &&
        !synonymsList.some((syn) => syn.toLowerCase() === rawNameClean.toLowerCase())
      ) {
        synonymsList.push(rawNameClean);
        await pool.query('UPDATE services SET synonyms = $1 WHERE service_id = $2', [
          JSON.stringify(synonymsList),
          service_id,
        ]);
      }
    }

    return NextResponse.json({ success: true, item: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error in match endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
