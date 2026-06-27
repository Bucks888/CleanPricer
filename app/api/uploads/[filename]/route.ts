import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  req: Request,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    const decodedFilename = decodeURIComponent(filename);

    // Prevent directory traversal attacks
    const sanitizedFilename = path.basename(decodedFilename);
    const filePath = path.join(process.cwd(), 'uploads', sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(sanitizedFilename).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.docx') {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === '.xlsx') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (ext === '.xls') {
      contentType = 'application/vnd.ms-excel';
    }

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(sanitizedFilename)}"`,
      },
    });
  } catch (error: any) {
    console.error('Error in download file API:', error);
    return NextResponse.json({ error: 'Ошибка сервера: ' + error.message }, { status: 500 });
  }
}
