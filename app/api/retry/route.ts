import { NextResponse } from 'next/server';
import path from 'path';
import { pool, update_price_document } from '../../db_utils';
import { enqueueDocument } from '../../queue_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import { isUuidLike } from '../../safe_utils';

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const doc_id = body?.doc_id;

    if (!isUuidLike(doc_id)) {
      return NextResponse.json({ error: 'Параметр doc_id обязателен и должен быть UUID' }, { status: 400 });
    }

    const res = await pool.query(
      'SELECT doc_id, file_name, file_format, parse_status FROM price_documents WHERE doc_id = $1',
      [doc_id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });
    }

    const doc = res.rows[0];
    if (doc.parse_status !== 'error') {
      return NextResponse.json(
        { error: 'Перезапуск возможен только для документов со статусом ошибки (error)' },
        { status: 400 }
      );
    }

    await update_price_document(doc.doc_id, {
      parse_status: 'pending',
      parse_log: '',
    });

    const filePath = path.join(process.cwd(), 'uploads', doc.file_name);

    enqueueDocument({
      doc_id: doc.doc_id,
      filePath,
      fileName: doc.file_name,
      fileFormat: doc.file_format,
    });

    return NextResponse.json({
      success: true,
      message: `Документ ${doc.file_name} успешно поставлен в очередь на повторную обработку.`,
    });
  } catch (error: unknown) {
    console.error('Error in retry endpoint:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Ошибка сервера: ' + message }, { status: 500 });
  }
}
