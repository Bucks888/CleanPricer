import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const result = await pool.query(`
      SELECT pd.*, p.name as partner_name
      FROM price_documents pd
      LEFT JOIN partners p ON pd.partner_id = p.partner_id
      ORDER BY 
        CASE 
          WHEN pd.parse_status = 'pending' THEN 1
          WHEN pd.parse_status = 'processing' THEN 1
          WHEN pd.parse_status = 'done' THEN 2
          WHEN pd.parse_status = 'needs_review' THEN 3
          WHEN pd.parse_status = 'error' THEN 4
          ELSE 5
        END ASC,
        pd.parsed_at DESC
      LIMIT 20
    `);
    return NextResponse.json(result.rows);
  } catch (error: unknown) {
    console.error('Error in get-items API:', error);
    const message = error instanceof Error ? error.message : 'Ошибка БД';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

