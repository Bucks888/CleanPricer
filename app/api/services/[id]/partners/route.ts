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
        pi.price_resident_kzt, 
        pi.price_nonresident_kzt, 
        pi.price_original, 
        pi.currency_original, 
        pi.effective_date,
        pi.is_verified,
        pi.verification_note,
        p.partner_id,
        p.name AS partner_name,
        p.city,
        p.address,
        p.bin,
        p.contact_email,
        p.contact_phone
      FROM price_items pi
      JOIN partners p ON pi.partner_id = p.partner_id
      WHERE pi.service_id = $1 AND pi.is_active = true AND p.is_active = true
      ORDER BY pi.price_resident_kzt ASC
    `;

    const res = await pool.query(query, [id]);
    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('Error fetching service partners:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
