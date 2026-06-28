import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const query = `
      SELECT 
        pi.item_id,
        pi.service_name_raw,
        pi.price_resident_kzt,
        pi.price_nonresident_kzt,
        pi.price_original,
        pi.currency_original,
        pi.effective_date,
        pi.verification_note,
        pi.doc_id,
        pi.service_id,
        s.service_name AS service_name_normalized,
        p.name AS partner_name,
        pd.file_name
      FROM price_items pi
      JOIN partners p ON pi.partner_id = p.partner_id
      JOIN price_documents pd ON pi.doc_id = pd.doc_id
      LEFT JOIN services s ON pi.service_id = s.service_id
      WHERE pi.is_verified = false AND pi.is_active = true
      ORDER BY pi.effective_date DESC, pi.service_name_raw ASC
    `;

    const res = await pool.query(query);
    return NextResponse.json(res.rows);
  } catch (error: unknown) {
    console.error('Error in unverified endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
