import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function POST(req: Request) {
  try {
    const { item_id, service_id, verification_note } = await req.json();
    if (!item_id || !service_id) {
      return NextResponse.json(
        { error: 'Параметры item_id и service_id обязательны' },
        { status: 400 }
      );
    }

    const note = verification_note || 'Сопоставлено вручную';

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

    // Optional: Add raw service name to synonyms of the service to improve future matches
    const item = res.rows[0];
    const serviceRes = await pool.query(
      'SELECT synonyms, service_name FROM services WHERE service_id = $1',
      [service_id]
    );

    if (serviceRes.rows.length > 0) {
      const service = serviceRes.rows[0];
      let synonymsList: string[] = [];
      if (Array.isArray(service.synonyms)) {
        synonymsList = service.synonyms;
      } else if (typeof service.synonyms === 'string') {
        try {
          synonymsList = JSON.parse(service.synonyms);
        } catch (e) {
          // Ignore
        }
      }

      const rawNameClean = item.service_name_raw.trim();
      const nameClean = service.service_name.trim();

      if (
        rawNameClean.toLowerCase() !== nameClean.toLowerCase() &&
        !synonymsList.some((s) => s.toLowerCase() === rawNameClean.toLowerCase())
      ) {
        synonymsList.push(rawNameClean);
        await pool.query(
          'UPDATE services SET synonyms = $1 WHERE service_id = $2',
          [JSON.stringify(synonymsList), service_id]
        );
      }
    }

    return NextResponse.json({ success: true, item: res.rows[0] });
  } catch (error: any) {
    console.error('Error in match endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
