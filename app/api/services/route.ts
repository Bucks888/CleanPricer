import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const include_inactive = searchParams.get('include_inactive') === 'true';

    let query = 'SELECT * FROM services WHERE 1=1';
    const params: string[] = [];
    let idx = 1;

    if (!include_inactive) {
      query += ' AND is_active = true';
    }

    if (category) {
      query += ` AND LOWER(category) = LOWER($${idx++})`;
      params.push(category);
    }

    query += ' ORDER BY service_name ASC';
    const res = await pool.query(query, params);
    return NextResponse.json(res.rows);
  } catch (error: unknown) {
    console.error('Error fetching services:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const { service_name, category, synonyms, icd_code } = body;

    if (!service_name || !category) {
      return NextResponse.json({ error: 'Название и категория обязательны' }, { status: 400 });
    }

    let synonymsJson = '[]';
    if (Array.isArray(synonyms)) {
      synonymsJson = JSON.stringify(synonyms);
    } else if (typeof synonyms === 'string') {
      const list = synonyms.split(',').map(s => s.trim()).filter(Boolean);
      synonymsJson = JSON.stringify(list);
    }

    const res = await pool.query(
      `INSERT INTO services (service_id, service_name, category, synonyms, icd_code, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       RETURNING *`,
      [service_name, category, synonymsJson, icd_code || '']
    );

    return NextResponse.json({ success: true, service: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error creating service:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const { service_id, service_name, category, synonyms, icd_code, is_active } = body;

    if (!service_id) {
      return NextResponse.json({ error: 'Параметр service_id обязателен' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (fieldName: string, value: any) => {
      if (value !== undefined) {
        updates.push(`${fieldName} = $${paramIndex++}`);
        values.push(value);
      }
    };

    addField('service_name', service_name);
    addField('category', category);
    addField('icd_code', icd_code);
    addField('is_active', is_active);

    if (synonyms !== undefined) {
      let synonymsJson = '[]';
      if (Array.isArray(synonyms)) {
        synonymsJson = JSON.stringify(synonyms);
      } else if (typeof synonyms === 'string') {
        const list = synonyms.split(',').map(s => s.trim()).filter(Boolean);
        synonymsJson = JSON.stringify(list);
      }
      updates.push(`synonyms = $${paramIndex++}`);
      values.push(synonymsJson);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 });
    }

    values.push(service_id);
    const query = `
      UPDATE services
      SET ${updates.join(', ')}
      WHERE service_id = $${paramIndex}
      RETURNING *
    `;

    const res = await pool.query(query, values);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Услуга не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, service: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error updating service:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { searchParams } = new URL(req.url);
    const service_id = searchParams.get('service_id');

    if (!service_id) {
      return NextResponse.json({ error: 'Параметр service_id обязателен' }, { status: 400 });
    }

    const checkRes = await pool.query('SELECT COUNT(*) as count FROM price_items WHERE service_id = $1', [service_id]);
    const count = parseInt(checkRes.rows[0].count, 10);

    if (count > 0) {
      await pool.query('UPDATE services SET is_active = false WHERE service_id = $1', [service_id]);
      return NextResponse.json({ success: true, deactivated: true, message: 'Услуга деактивирована (используется в прайсах)' });
    } else {
      const res = await pool.query('DELETE FROM services WHERE service_id = $1 RETURNING *', [service_id]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Услуга не найдена' }, { status: 404 });
      }
      return NextResponse.json({ success: true, deleted: true, message: 'Услуга успешно удалена' });
    }
  } catch (error: unknown) {
    console.error('Error deleting service:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
