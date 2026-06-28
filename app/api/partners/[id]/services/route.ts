import { NextResponse } from 'next/server';
import { pool } from '../../../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../../../auth_utils';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { id } = await context.params;

    const query = `
      SELECT 
        pi.item_id,
        pi.service_name_raw,
        pi.price_resident_kzt,
        pi.price_nonresident_kzt,
        pi.price_original,
        pi.currency_original,
        pi.effective_date,
        pi.is_verified,
        pi.verification_note,
        pi.service_id,
        s.service_name AS normalized_name,
        s.category
      FROM price_items pi
      LEFT JOIN services s ON pi.service_id = s.service_id
      WHERE pi.partner_id = $1 AND pi.is_active = true
      ORDER BY s.category ASC, s.service_name ASC, pi.service_name_raw ASC
    `;

    const res = await pool.query(query, [id]);
    return NextResponse.json(res.rows);
  } catch (error: unknown) {
    console.error('Error fetching partner services:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
