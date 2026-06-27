import { NextResponse } from 'next/server';
import { pool } from '../../db_utils';
import * as XLSX from 'xlsx';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let services: any[] = [];

    if (file.name.endsWith('.json')) {
      const text = buffer.toString('utf-8');
      const parsed = JSON.parse(text);
      services = Array.isArray(parsed) ? parsed : [parsed];
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as any[];

      services = rows.map((row) => {
        // Map flexible headers
        const service_id = row.service_id || row['ID'] || row['Идентификатор'] || null;
        const service_name =
          row.service_name ||
          row['Название'] ||
          row['Наименование услуги'] ||
          row['Наименование'] ||
          '';
        const category = row.category || row['Категория'] || row['Раздел'] || '';
        const icd_code = row.icd_code || row['МКБ'] || row['Код МКБ'] || '';

        let synonyms: string[] = [];
        const rawSynonyms = row.synonyms || row['Синонимы'] || row['Альтернативные названия'];
        if (rawSynonyms) {
          if (typeof rawSynonyms === 'string') {
            if (rawSynonyms.trim().startsWith('[') && rawSynonyms.trim().endsWith(']')) {
              try {
                synonyms = JSON.parse(rawSynonyms);
              } catch (e) {
                synonyms = rawSynonyms.split(',').map((s: string) => s.trim()).filter(Boolean);
              }
            } else {
              synonyms = rawSynonyms.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
          } else if (Array.isArray(rawSynonyms)) {
            synonyms = rawSynonyms;
          }
        }

        return {
          service_id,
          service_name,
          category,
          icd_code,
          synonyms,
        };
      });
    } else {
      return NextResponse.json(
        { error: 'Неподдерживаемый формат файла (только .xlsx, .xls или .json)' },
        { status: 400 }
      );
    }

    // Insert into database
    const client = await pool.connect();
    let insertedCount = 0;
    try {
      await client.query('BEGIN');
      for (const s of services) {
        const name = (s.service_name || '').trim();
        if (!name) continue;

        const id = s.service_id && s.service_id.length === 36 ? s.service_id : null;
        const synJson = JSON.stringify(s.synonyms || []);

        if (id) {
          await client.query(
            `INSERT INTO services (service_id, service_name, synonyms, category, icd_code, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (service_id) 
             DO UPDATE SET service_name = EXCLUDED.service_name, synonyms = EXCLUDED.synonyms, category = EXCLUDED.category, icd_code = EXCLUDED.icd_code`,
            [id, name, synJson, s.category || null, s.icd_code || null]
          );
        } else {
          // Generate new UUID if not provided
          await client.query(
            `INSERT INTO services (service_id, service_name, synonyms, category, icd_code, is_active)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
            [name, synJson, s.category || null, s.icd_code || null]
          );
        }
        insertedCount++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      count: insertedCount,
      message: `Загружено ${insertedCount} услуг в справочник.`,
    });
  } catch (error: any) {
    console.error('Error loading catalog:', error);
    return NextResponse.json(
      { error: 'Ошибка при загрузке справочника: ' + error.message },
      { status: 500 }
    );
  }
}
