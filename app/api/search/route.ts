import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const cleanQ = q.trim();

    if (!cleanQ) {
      return NextResponse.json({ partners: [], services: [] });
    }

    const likeQuery = `%${cleanQ}%`;

    // 1. Search catalog services
    const servicesRes = await pool.query(
      `SELECT * FROM services 
       WHERE is_active = true 
         AND (service_name ILIKE $1 OR category ILIKE $1 OR synonyms::text ILIKE $1)
       LIMIT 50`,
      [likeQuery]
    );

    // 2. Search partners
    const partnersRes = await pool.query(
      `SELECT * FROM partners 
       WHERE is_active = true 
         AND (name ILIKE $1 OR city ILIKE $1 OR address ILIKE $1)
       LIMIT 50`,
      [likeQuery]
    );

    return NextResponse.json({
      partners: partnersRes.rows,
      services: servicesRes.rows,
    });
  } catch (error: unknown) {
    console.error('Error in search endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
