import { NextResponse } from 'next/server';
import { pool, update_price_document } from '../../db_utils';
import { enqueueDocument } from '../../queue_utils';
import path from 'path';

export async function POST(req: Request) {
  try {
    const { doc_id } = await req.json();
    if (!doc_id) {
      return NextResponse.json({ error: 'Параметр doc_id обязателен' }, { status: 400 });
    }

    // Lookup document details
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

    // Reset status to pending and clear the logs
    await update_price_document(doc.doc_id, {
      parse_status: 'pending',
      parse_log: '',
    });

    // Enqueue back into sequential processor queue
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
  } catch (error: any) {
    console.error('Error in retry endpoint:', error);
    return NextResponse.json({ error: 'Ошибка сервера: ' + error.message }, { status: 500 });
  }
}
