import { writeFile, mkdir } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { get_or_create_partner, save_price_document } from '../../db_utils';
import { enqueueDocument } from '../../queue_utils';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      await mkdir(uploadDir);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const originalName = file.name;
    const isZip = originalName.endsWith('.zip');

    const filesToProcess: { filePath: string; fileName: string; fileFormat: string }[] = [];

    if (isZip) {
      // Process ZIP archive
      const zip = new AdmZip(fileBuffer);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;

        const name = entry.entryName;
        // Skip hidden files, system files, or non-price extensions
        if (path.basename(name).startsWith('.') || path.basename(name).startsWith('~')) {
          continue;
        }

        const ext = path.extname(name).toLowerCase();
        if (['.pdf', '.docx', '.xlsx', '.xls'].includes(ext)) {
          const extractedBuffer = entry.getData();
          const sanitizedBaseName = path.basename(name);
          const destPath = path.join(uploadDir, sanitizedBaseName);
          
          await writeFile(destPath, extractedBuffer);

          filesToProcess.push({
            filePath: destPath,
            fileName: sanitizedBaseName,
            fileFormat: ext.substring(1), // e.g. 'pdf', 'xlsx'
          });
        }
      }
    } else {
      // Process single file
      const ext = path.extname(originalName).toLowerCase();
      if (!['.pdf', '.docx', '.xlsx', '.xls'].includes(ext)) {
        return NextResponse.json({ 
          error: 'Неподдерживаемый формат (поддерживаются только ZIP, PDF, DOCX, XLSX, XLS)' 
        }, { status: 400 });
      }

      const destPath = path.join(uploadDir, originalName);
      await writeFile(destPath, fileBuffer);

      filesToProcess.push({
        filePath: destPath,
        fileName: originalName,
        fileFormat: ext.substring(1),
      });
    }

    if (filesToProcess.length === 0) {
      return NextResponse.json({ 
        error: 'В загруженном файле не найдено поддерживаемых документов прайс-листов' 
      }, { status: 400 });
    }

    // Register price documents as pending and enqueue them
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

      // Enqueue document into the global sequential processor queue
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
        : `Файл успешно загружен и поставлен в очередь.`,
      documents: createdDocs,
    });
  } catch (error: any) {
    console.error('Error in upload route:', error);
    return NextResponse.json({ error: 'Ошибка сервера при загрузке: ' + error.message }, { status: 500 });
  }
}