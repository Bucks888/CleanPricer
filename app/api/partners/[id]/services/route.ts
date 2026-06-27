import { NextResponse } from 'next/server';
import { pool } from '../../../../db_utils';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
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
  } catch (error: any) {
    console.error('Error fetching partner services:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
