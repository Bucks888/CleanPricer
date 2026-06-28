import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import * as XLSX from 'xlsx';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import { isUuidLike, sanitizeFileName } from '../../safe_utils';

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

type ServiceImportRow = {
  service_id?: string | null;
  service_name: string;
  category?: string | null;
  icd_code?: string | null;
  synonyms: string[];
};

function toSynonyms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];

    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
        }
      } catch {
        return text.split(',').map((item) => item.trim()).filter(Boolean);
      }
    }

    return text.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function normalizeServiceRows(rawRows: unknown[]): ServiceImportRow[] {
  return rawRows.flatMap((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return [];
    }

    const source = row as Record<string, unknown>;
    const service_name = String(
      source.service_name ||
        source['Название'] ||
        source['Наименование услуги'] ||
        source['Наименование'] ||
        ''
    ).trim();
    if (!service_name) {
      return [];
    }

    const service_id = String(source.service_id || source['ID'] || source['Идентификатор'] || '').trim();
    const category = String(source.category || source['Категория'] || source['Раздел'] || '').trim();
    const icd_code = String(source.icd_code || source['МКБ'] || source['Код МКБ'] || '').trim();
    const synonyms = toSynonyms(source.synonyms || source['Синонимы'] || source['Альтернативные названия']);

    return [{
      service_id: service_id ? service_id : null,
      service_name,
      category: category || null,
      icd_code: icd_code || null,
      synonyms,
    }];
  });
}

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
      return NextResponse.json({ error: 'Файл справочника слишком большой' }, { status: 413 });
    }

    const safeName = sanitizeFileName(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    let services: ServiceImportRow[] = [];

    if (safeName.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
      services = Array.isArray(parsed) ? normalizeServiceRows(parsed) : normalizeServiceRows([parsed]);
    } else if (safeName.toLowerCase().endsWith('.xlsx') || safeName.toLowerCase().endsWith('.xls')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet) as unknown[];
      services = normalizeServiceRows(rows);
    } else {
      return NextResponse.json(
        { error: 'Неподдерживаемый формат файла (только .xlsx, .xls или .json)' },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    let insertedCount = 0;

    try {
      await client.query('BEGIN');

      for (const service of services) {
        const id = service.service_id && isUuidLike(service.service_id) ? service.service_id : null;
        const synJson = JSON.stringify(service.synonyms || []);

        if (id) {
          await client.query(
            `INSERT INTO services (service_id, service_name, synonyms, category, icd_code, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (service_id)
             DO UPDATE SET
               service_name = EXCLUDED.service_name,
               synonyms = EXCLUDED.synonyms,
               category = EXCLUDED.category,
               icd_code = EXCLUDED.icd_code`,
            [id, service.service_name, synJson, service.category, service.icd_code]
          );
        } else {
          await client.query(
            `INSERT INTO services (service_id, service_name, synonyms, category, icd_code, is_active)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
            [service.service_name, synJson, service.category, service.icd_code]
          );
        }

        insertedCount++;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      count: insertedCount,
      message: `Загружено ${insertedCount} услуг в справочник.`,
    });
  } catch (error: unknown) {
    console.error('Error loading catalog:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Ошибка при загрузке справочника: ' + message },
      { status: 500 }
    );
  }
}
