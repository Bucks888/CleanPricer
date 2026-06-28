import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { searchParams } = new URL(req.url);
    const service_id = searchParams.get('service_id');
    const partner_id = searchParams.get('partner_id');

    if (!service_id || !partner_id) {
      return NextResponse.json(
        { error: 'Параметры service_id и partner_id обязательны' },
        { status: 400 }
      );
    }

    const query = `
      SELECT 
        pi.item_id,
        pi.price_resident_kzt,
        pi.price_nonresident_kzt,
        pi.price_original,
        pi.currency_original,
        pi.effective_date,
        pi.is_verified,
        pi.is_active,
        pd.file_name
      FROM price_items pi
      JOIN price_documents pd ON pi.doc_id = pd.doc_id
      WHERE pi.service_id = $1 AND pi.partner_id = $2
      ORDER BY pi.effective_date DESC, pi.item_id DESC
    `;

    const res = await pool.query(query, [service_id, partner_id]);
    return NextResponse.json(res.rows);
  } catch (error: unknown) {
    console.error('Error fetching price history:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
