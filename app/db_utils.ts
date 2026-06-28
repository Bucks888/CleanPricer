import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Получить пороговые значения сопоставления из конфигурации
function getMatchingThresholds() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        autoMatchThreshold: config.autoMatchThreshold ?? 0.85,
        manualReviewThreshold: config.manualReviewThreshold ?? 0.70
      };
    }
  } catch (e) {
    // Игнорировать
  }
  return { autoMatchThreshold: 0.85, manualReviewThreshold: 0.70 };
}

// Запрос курсов обмена валют относительно KZT
async function getExchangeRates(effectiveDate: string | Date): Promise<{ USD: number; RUB: number }> {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (typeof config.usdRate === 'number' && typeof config.rubRate === 'number') {
        console.log(`[EXCHANGE] Использование настроенных курсов: USD = ${config.usdRate} KZT, RUB = ${config.rubRate} KZT`);
        return { USD: config.usdRate, RUB: config.rubRate };
      }
    }
  } catch (e) {
    // Игнорировать
  }

  const fallback = { USD: 450.0, RUB: 5.0 };
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.rates && data.rates.KZT) {
        const usdRate = Number(data.rates.KZT);
        const rubRate = data.rates.RUB ? Number(data.rates.KZT) / Number(data.rates.RUB) : 5.0;
        console.log(`[EXCHANGE] Получены курсы из API: USD = ${usdRate.toFixed(2)} KZT, RUB = ${rubRate.toFixed(2)} KZT`);
        return { USD: usdRate, RUB: rubRate };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[EXCHANGE] Unable to fetch exchange rates. Falling back to defaults. Error: ${message}`);
  }
  return fallback;
}

export interface StructuredLog {
  type: 'error' | 'warning';
  message: string;
  row?: number;
  service_name?: string;
}

/**
 * Метрика сходства Коэффициента Дайса для нечеткого сопоставления строк
 */
export function diceCoefficient(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-zа-я0-9\s]/g, '').trim();
  const s2 = str2.toLowerCase().replace(/[^a-zа-я0-9\s]/g, '').trim();
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);
  let intersection = 0;
  for (const val of bigrams1) {
    if (bigrams2.has(val)) intersection++;
  }
  return (2.0 * intersection) / (bigrams1.size + bigrams2.size);
}

/**
 * Нормализация и поиск лучшего соответствия услуги в справочнике
 */
export function find_best_match(
  service_name_raw: string,
  services: { service_id: string; service_name: string; synonyms?: string[] | string | null }[]
) {
  if (!service_name_raw) {
    return { service_id: null, score: 0, is_verified: false };
  }

  let bestServiceId: string | null = null;
  let bestScore = 0;
  const rawClean = service_name_raw.trim().toLowerCase();

  for (const s of services) {
    // 1. Точное совпадение с официальным названием услуги
    if (s.service_name.trim().toLowerCase() === rawClean) {
      return { service_id: s.service_id, score: 1.0, is_verified: true };
    }

    // Разбор списка синонимов
    let synonymsList: string[] = [];
    if (Array.isArray(s.synonyms)) {
      synonymsList = s.synonyms;
    } else if (typeof s.synonyms === 'string') {
      try {
        const parsed = JSON.parse(s.synonyms);
      } catch (e) {
        // Игнорировать
      }
    }

    // 2. Точное совпадение с синонимами
    for (const syn of synonymsList) {
      if (typeof syn === 'string' && syn.trim().toLowerCase() === rawClean) {
        return { service_id: s.service_id, score: 1.0, is_verified: true };
      }
    }

    // 3. Нечеткое совпадение с официальным названием
    const scoreName = diceCoefficient(service_name_raw, s.service_name);
    if (scoreName > bestScore) {
      bestScore = scoreName;
      bestServiceId = s.service_id;
    }

    // 4. Нечеткое совпадение с синонимами
    for (const syn of synonymsList) {
      if (typeof syn === 'string') {
        const scoreSyn = diceCoefficient(service_name_raw, syn);
        if (scoreSyn > bestScore) {
          bestScore = scoreSyn;
          bestServiceId = s.service_id;
        }
      }
    }
  }

  const thresholds = getMatchingThresholds();

  // Принятие решения на основе порогов
  if (bestScore >= thresholds.autoMatchThreshold) {
    return { service_id: bestServiceId, score: bestScore, is_verified: true };
  } else if (bestScore >= thresholds.manualReviewThreshold) {
    return { service_id: bestServiceId, score: bestScore, is_verified: false };
  } else {
    return { service_id: null, score: bestScore, is_verified: false };
  }
}

/**
 * Найти или создать партнера-клинику по названию (регистронезависимо)
 */
export async function get_or_create_partner(partnerInfo: {
  name: string;
  city?: string;
  address?: string;
  bin?: string;
  email?: string;
  phone?: string;
}) {
  const client = await pool.connect();
  try {
    const trimmedName = partnerInfo.name.trim();
    const checkRes = await client.query(
      'SELECT partner_id FROM partners WHERE LOWER(name) = LOWER($1)',
      [trimmedName]
    );

    if (checkRes.rows.length > 0) {
      return checkRes.rows[0].partner_id;
    }

    const insertRes = await client.query(
      `INSERT INTO partners (
        partner_id, name, city, address, bin, contact_email, contact_phone, is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, NOW(), NOW()
      ) RETURNING partner_id`,
      [
        trimmedName,
        partnerInfo.city || null,
        partnerInfo.address || null,
        partnerInfo.bin || null,
        partnerInfo.email || null,
        partnerInfo.phone || null,
      ]
    );
    return insertRes.rows[0].partner_id;
  } finally {
    client.release();
  }
}

/**
 * Создает/сохраняет запись прайс-документа
 */
export async function save_price_document(docInfo: {
  partner_id: string;
  file_name: string;
  file_format: string;
  effective_date: string | Date;
  parse_status: string;
  parse_log?: string;
  raw_content?: string;
}) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO price_documents (
        doc_id, partner_id, file_name, file_format, effective_date, parsed_at, parse_status, parse_log, raw_content
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, NOW(), $5, $6, $7
      ) RETURNING doc_id`,
      [
        docInfo.partner_id,
        docInfo.file_name,
        docInfo.file_format,
        docInfo.effective_date,
        docInfo.parse_status,
        docInfo.parse_log || '[]',
        docInfo.raw_content || '',
      ]
    );
    return res.rows[0].doc_id;
  } finally {
    client.release();
  }
}

/**
 * Обновляет поля прайс-документа (например, статус, логи)
 */
export async function update_price_document(
  doc_id: string,
  updates: {
    parse_status?: string;
    parse_log?: string;
    raw_content?: string;
    effective_date?: string | Date;
  }
) {
  const client = await pool.connect();
  try {
    const fields: string[] = [];
    const values: (string | number | Date | null)[] = [];
    let idx = 1;

    if (updates.parse_status) {
      fields.push(`parse_status = $${idx++}`);
      values.push(updates.parse_status);
    }
    if (updates.parse_log !== undefined) {
      fields.push(`parse_log = $${idx++}`);
      values.push(updates.parse_log);
    }
    if (updates.raw_content !== undefined) {
      fields.push(`raw_content = $${idx++}`);
      values.push(updates.raw_content);
    }
    if (updates.effective_date !== undefined) {
      fields.push(`effective_date = $${idx++}`);
      values.push(updates.effective_date);
    }

    if (fields.length === 0) return;

    values.push(doc_id);
    await client.query(
      `UPDATE price_documents SET ${fields.join(', ')} WHERE doc_id = $${idx}`,
      values
    );
  } finally {
    client.release();
  }
}

/**
 * Сохраняет пачку позиций прайса с проведением проверок бизнес-правил:
 * 1. Валидация (цена > 0, нерезидент >= резидент, дата не в будущем)
 * 2. Конвертация валют (из USD/RUB в KZT по актуальному курсу)
 * 3. Дедупликация (архивирование старых цен клиники для той же услуги)
 * 4. Контроль аномалий (изменение цены более чем на 50%)
 */
export async function save_price_items_batch(
  doc_id: string,
  partner_id: string,
  effective_date: string | Date,
  rawItems: {
    service_name_raw: string;
    price_original: number;
    price_nonresident_original?: number;
    currency_original?: string;
    service_code_source?: string;
  }[]
) {
  const client = await pool.connect();
  const logs: StructuredLog[] = [];
  let docStatus = 'done';

  const priceDate = new Date(effective_date);
  const now = new Date();

  if (priceDate > now) {
    logs.push({
      type: 'warning',
      message: `Дата прайса (${priceDate.toLocaleDateString()}) находится в будущем.`
    });
  }

  // Загрузка курсов обмена валют
  const rates = await getExchangeRates(effective_date);

  try {
    await client.query('BEGIN');

    // Загрузка активного справочника услуг
    const servicesRes = await client.query(
      'SELECT service_id, service_name, synonyms FROM services WHERE is_active = true'
    );
    const servicesCatalog = servicesRes.rows;

    let rowIndex = 0;
    for (const rawItem of rawItems) {
      rowIndex++;
      const nameRaw = (rawItem.service_name_raw || '').trim();

      if (!nameRaw) {
        logs.push({
          type: 'warning',
          row: rowIndex,
          message: 'Пропущена строка с пустым наименованием услуги.'
        });
        continue;
      }

      const priceResOrig = Number(rawItem.price_original);
      if (isNaN(priceResOrig) || priceResOrig <= 0) {
        logs.push({
          type: 'error',
          row: rowIndex,
          service_name: nameRaw,
          message: `Некорректная цена для услуги: ${rawItem.price_original}`
        });
        docStatus = 'needs_review';
        continue;
      }

      const priceNonresOrig = rawItem.price_nonresident_original !== undefined
        ? Number(rawItem.price_nonresident_original)
        : priceResOrig;

      // Нормализация валюты и расчет цен в KZT
      const rawCurrency = (rawItem.currency_original || 'KZT').trim().toUpperCase();
      let rate = 1.0;
      let targetCurrency = 'KZT';

      if (rawCurrency === 'USD' || rawCurrency === '$') {
        rate = rates.USD;
        targetCurrency = 'USD';
      } else if (rawCurrency === 'RUB' || rawCurrency === 'РУБ') {
        rate = rates.RUB;
        targetCurrency = 'RUB';
      }

      const priceResidentKzt = priceResOrig * rate;
      const priceNonresidentKzt = priceNonresOrig; // Не конвертируем, сохраняем в оригинальной валюте

      let verificationNote = '';
      let isVerified = true;

      // Для сравнения резидента и нерезидента приводим оба к KZT
      const priceNonresKztVal = priceNonresOrig * rate;
      if (!isNaN(priceNonresOrig) && priceNonresKztVal < priceResidentKzt) {
        logs.push({
          type: 'warning',
          row: rowIndex,
          service_name: nameRaw,
          message: `Цена нерезидента (${priceNonresOrig} ${rawCurrency}) меньше цены резидента (${priceResOrig} ${rawCurrency}).`
        });
        isVerified = false;
        verificationNote += `Цена нерезидента меньше цены резидента. `;
      }

      // Поиск соответствия в справочнике услуг
      const matchResult = find_best_match(nameRaw, servicesCatalog);
      const serviceId = matchResult.service_id;
      
      if (serviceId) {
        if (!matchResult.is_verified) {
          isVerified = false;
          verificationNote += `Неуверенное автосопоставление (score: ${matchResult.score.toFixed(2)}). `;
        }
      } else {
        isVerified = false;
        verificationNote += `Не удалось сопоставить со справочником. `;
      }

      // Проверка аномалий изменения цены более чем на 50%
      let prevPriceQuery = '';
      let prevQueryParams: (string | number)[] = [];

      if (serviceId) {
        prevPriceQuery = `
          SELECT price_resident_kzt 
          FROM price_items 
          WHERE partner_id = $1 AND service_id = $2 AND is_active = true 
          ORDER BY effective_date DESC 
          LIMIT 1`;
        prevQueryParams = [partner_id, serviceId];
      } else {
        prevPriceQuery = `
          SELECT price_resident_kzt 
          FROM price_items 
          WHERE partner_id = $1 AND service_name_raw = $2 AND service_id IS NULL AND is_active = true 
          ORDER BY effective_date DESC 
          LIMIT 1`;
        prevQueryParams = [partner_id, nameRaw];
      }

      const prevPriceRes = await client.query(prevPriceQuery, prevQueryParams);
      if (prevPriceRes.rows.length > 0) {
        const prevPriceKzt = Number(prevPriceRes.rows[0].price_resident_kzt);
        if (prevPriceKzt > 0) {
          const diffPct = Math.abs(priceResidentKzt - prevPriceKzt) / prevPriceKzt;
          if (diffPct > 0.50) {
            logs.push({
              type: 'warning',
              row: rowIndex,
              service_name: nameRaw,
              message: `Аномалия цены. Предыдущая: ${prevPriceKzt} KZT, Новая: ${priceResidentKzt} KZT (отклонение ${(diffPct * 100).toFixed(1)}%).`
            });
            isVerified = false;
            verificationNote += `Цена изменилась более чем на 50% (было: ${prevPriceKzt} KZT, стало: ${priceResidentKzt} KZT). `;
          }
        }
      }

      // Вставка позиции
      await client.query(
        `INSERT INTO price_items (
          item_id, doc_id, partner_id, service_name_raw, service_id, 
          price_resident_kzt, price_nonresident_kzt, price_original, currency_original, 
          is_verified, is_active, effective_date, verification_note, service_code_source
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12
        )`,
        [
          doc_id,
          partner_id,
          nameRaw,
          serviceId,
          priceResidentKzt,
          priceNonresidentKzt,
          priceResOrig,
          targetCurrency,
          isVerified,
          effective_date,
          verificationNote.trim() || null,
          rawItem.service_code_source || null
        ]
      );
    }

    // Финальная дедупликация прайсов клиники с архивированием старых версий цен (остается только свежий прайс)
    await client.query(`
      WITH latest_prices AS (
        SELECT DISTINCT ON (COALESCE(service_id::text, service_name_raw)) item_id
        FROM price_items
        WHERE partner_id = $1
        ORDER BY COALESCE(service_id::text, service_name_raw), effective_date DESC, item_id DESC
      )
      UPDATE price_items
      SET is_active = (item_id IN (SELECT item_id FROM latest_prices))
      WHERE partner_id = $1
    `, [partner_id]);

    await client.query('COMMIT');

    // Обновление логов парсинга документа
    await update_price_document(doc_id, {
      parse_status: docStatus,
      parse_log: JSON.stringify(logs),
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Ошибка при сохранении пачки записей:", error);
    
    logs.push({
      type: 'error',
      message: `Критическая ошибка сохранения: ${error instanceof Error ? error.message : String(error)}`
    });
    
    await update_price_document(doc_id, {
      parse_status: 'error',
      parse_log: JSON.stringify(logs),
    });
    throw error;
  } finally {
    client.release();
  }
}

// Заглушка обратной совместимости для одиночного сохранения услуг (исправлена)
export type LegacyPriceInput = {
  service_name_raw: string;
  price_original: number;
  currency_original?: string;
};

