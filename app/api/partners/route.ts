import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { searchParams } = new URL(req.url);
    const city = searchParams.get('city');
    const status = searchParams.get('status');

    let query = 'SELECT * FROM partners WHERE 1=1';
    const params: (string | boolean)[] = [];
    let idx = 1;

    if (city) {
      query += ` AND LOWER(city) = LOWER($${idx++})`;
      params.push(city);
    }

    if (status) {
      query += ` AND is_active = $${idx++}`;
      params.push(status === 'active');
    }

    query += ' ORDER BY name ASC';
    const res = await pool.query(query, params);
    return NextResponse.json(res.rows);
  } catch (error: unknown) {
    console.error('Error fetching partners:', error);
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
    const { name, city, address, bin, contact_email, contact_phone } = body;

    if (!name || !city) {
      return NextResponse.json({ error: 'Название и город обязательны' }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO partners (partner_id, name, city, address, bin, contact_email, contact_phone, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       RETURNING *`,
      [name, city, address || '', bin || '', contact_email || '', contact_phone || '']
    );

    return NextResponse.json({ success: true, partner: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error creating partner:', error);
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
    const { partner_id, name, city, address, bin, contact_email, contact_phone, is_active } = body;

    if (!partner_id) {
      return NextResponse.json({ error: 'Параметр partner_id обязателен' }, { status: 400 });
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

    addField('name', name);
    addField('city', city);
    addField('address', address);
    addField('bin', bin);
    addField('contact_email', contact_email);
    addField('contact_phone', contact_phone);
    addField('is_active', is_active);

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);

    values.push(partner_id);
    const query = `
      UPDATE partners
      SET ${updates.join(', ')}
      WHERE partner_id = $${paramIndex}
      RETURNING *
    `;

    const res = await pool.query(query, values);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Партнер не найден' }, { status: 404 });
    }

    return NextResponse.json({ success: true, partner: res.rows[0] });
  } catch (error: unknown) {
    console.error('Error updating partner:', error);
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
    const partner_id = searchParams.get('partner_id');

    if (!partner_id) {
      return NextResponse.json({ error: 'Параметр partner_id обязателен' }, { status: 400 });
    }

    const checkRes = await pool.query('SELECT COUNT(*) as count FROM price_items WHERE partner_id = $1', [partner_id]);
    const count = parseInt(checkRes.rows[0].count, 10);

    if (count > 0) {
      await pool.query('UPDATE partners SET is_active = false, updated_at = NOW() WHERE partner_id = $1', [partner_id]);
      return NextResponse.json({ success: true, deactivated: true, message: 'Партнер деактивирован (содержит позиции прайсов)' });
    } else {
      const res = await pool.query('DELETE FROM partners WHERE partner_id = $1 RETURNING *', [partner_id]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Партнер не найден' }, { status: 404 });
      }
      return NextResponse.json({ success: true, deleted: true, message: 'Партнер успешно удален' });
    }
  } catch (error: unknown) {
    console.error('Error deleting partner:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
