import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';

export async function GET(req: Request) {
  try {
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
        p.partner_id,
        p.name AS partner_name,
        pd.file_name
      FROM price_items pi
      JOIN partners p ON pi.partner_id = p.partner_id
      JOIN price_documents pd ON pi.doc_id = pd.doc_id
      WHERE pi.service_id IS NULL AND pi.is_active = true
      ORDER BY pi.effective_date DESC, pi.service_name_raw ASC
    `;

    const res = await pool.query(query);
    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('Error in unmatched endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
