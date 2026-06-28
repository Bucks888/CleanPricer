import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';

export async function GET(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const docsRes = await pool.query(`
      SELECT parse_status, count(*) as count
      FROM price_documents
      GROUP BY parse_status
    `);

    const itemsRes = await pool.query(`
      SELECT
        COUNT(*) as total_items,
        COUNT(CASE WHEN service_id IS NOT NULL THEN 1 END) as matched_items,
        COUNT(CASE WHEN service_id IS NULL THEN 1 END) as unmatched_items,
        COUNT(CASE WHEN is_verified = false THEN 1 END) as unverified_items
      FROM price_items
      WHERE is_active = true
    `);

    type DocStatusRow = { parse_status: string; count: string };
    const docStats = (docsRes.rows as DocStatusRow[]).reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.parse_status] = parseInt(row.count, 10);
        return acc;
      },
      { pending: 0, processing: 0, done: 0, error: 0, needs_review: 0 }
    );

    const itemsStats = itemsRes.rows[0] as Record<string, string>;
    const totalItems = parseInt(itemsStats.total_items, 10) || 0;
    const matchedItems = parseInt(itemsStats.matched_items, 10) || 0;
    const unmatchedItems = parseInt(itemsStats.unmatched_items, 10) || 0;
    const unverifiedItems = parseInt(itemsStats.unverified_items, 10) || 0;

    const normalizationRate = totalItems > 0 ? Math.round((matchedItems / totalItems) * 100) : 0;

    return NextResponse.json({
      documents: docStats,
      total_items: totalItems,
      matched_items: matchedItems,
      unmatched_items: unmatchedItems,
      unverified_items: unverifiedItems,
      normalization_rate: normalizationRate,
    });
  } catch (error: unknown) {
    console.error('Error fetching dashboard stats:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

