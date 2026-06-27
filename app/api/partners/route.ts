import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get('city');
    const status = searchParams.get('status');

    let query = 'SELECT * FROM partners WHERE 1=1';
    const params: any[] = [];
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
  } catch (error: any) {
    console.error('Error fetching partners:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
