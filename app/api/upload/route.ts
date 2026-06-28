import { writeFile, mkdir } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { get_or_create_partner, save_price_document } from '../../db_utils';
import { enqueueDocument } from '../../queue_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import {
  buildStoredFileName,
  isSupportedPriceFile,
  sanitizeFileName,
} from '../../safe_utils';

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой' }, { status: 413 });
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalName = sanitizeFileName(file.name);
    const isZip = path.extname(originalName).toLowerCase() === '.zip';
    const filesToProcess: { filePath: string; fileName: string; fileFormat: string }[] = [];

    if (isZip) {
      const zip = new AdmZip(fileBuffer);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;

        const entryName = sanitizeFileName(entry.entryName);
        if (path.basename(entryName).startsWith('.') || path.basename(entryName).startsWith('~')) {
          continue;
        }

        const ext = path.extname(entryName).toLowerCase();
        if (!['.pdf', '.docx', '.xlsx', '.xls'].includes(ext)) {
          continue;
        }

        const storedName = buildStoredFileName(path.basename(entryName), crypto.randomUUID());
        const destPath = path.join(uploadDir, storedName);
        await writeFile(destPath, entry.getData());

        filesToProcess.push({
          filePath: destPath,
          fileName: storedName,
          fileFormat: ext.substring(1),
        });
      }
    } else {
      if (!isSupportedPriceFile(originalName)) {
        return NextResponse.json(
          {
            error: 'Неподдерживаемый формат (поддерживаются только ZIP, PDF, DOCX, XLSX, XLS)',
          },
          { status: 400 }
        );
      }

      const ext = path.extname(originalName).toLowerCase();
      const storedName = buildStoredFileName(originalName, crypto.randomUUID());
      const destPath = path.join(uploadDir, storedName);
      await writeFile(destPath, fileBuffer);

      filesToProcess.push({
        filePath: destPath,
        fileName: storedName,
        fileFormat: ext.substring(1),
      });
    }

    if (filesToProcess.length === 0) {
      return NextResponse.json(
        { error: 'В загруженном файле не найдено поддерживаемых документов прайс-листов' },
        { status: 400 }
      );
    }

    const createdDocs: { doc_id: string; file_name: string }[] = [];
    const defaultPartnerId = await get_or_create_partner({ name: 'Нераспознанная клиника' });

    for (const item of filesToProcess) {
      const docId = await save_price_document({
        partner_id: defaultPartnerId,
        file_name: item.fileName,
        file_format: item.fileFormat,
        effective_date: new Date(),
        parse_status: 'pending',
      });

      createdDocs.push({
        doc_id: docId,
        file_name: item.fileName,
      });

      enqueueDocument({
        doc_id: docId,
        filePath: item.filePath,
        fileName: item.fileName,
        fileFormat: item.fileFormat,
      });
    }

    return NextResponse.json({
      success: true,
      message: isZip
        ? `Архив успешно распакован. Найдено и поставлено в очередь ${filesToProcess.length} файлов.`
        : 'Файл успешно загружен и поставлен в очередь.',
      documents: createdDocs,
    });
  } catch (error: unknown) {
    console.error('Error in upload route:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Ошибка сервера при загрузке: ' + message }, { status: 500 });
  }
}
