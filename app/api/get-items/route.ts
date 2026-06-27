import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT pd.*, p.name as partner_name 
      FROM price_documents pd
      LEFT JOIN partners p ON pd.partner_id = p.partner_id
      ORDER BY pd.parsed_at DESC 
      LIMIT 20
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Error in get-items API:", error);
    return NextResponse.json({ error: 'Ошибка БД' }, { status: 500 });
  }
}