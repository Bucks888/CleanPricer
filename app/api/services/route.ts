import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    let query = 'SELECT * FROM services WHERE is_active = true';
    const params: any[] = [];

    if (category) {
      query += ' AND LOWER(category) = LOWER($1)';
      params.push(category);
    }

    query += ' ORDER BY service_name ASC';
    const res = await pool.query(query, params);
    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('Error fetching services:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
