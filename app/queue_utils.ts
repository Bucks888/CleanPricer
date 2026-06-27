import fs from 'fs';
import path from 'path';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import * as XLSX from 'xlsx';
import { 
  get_or_create_partner, 
  update_price_document, 
  save_price_items_batch,
  pool,
  StructuredLog
} from './db_utils';
import { parseDocument } from './parser_utils';

interface QueueItem {
  doc_id: string;
  filePath: string;
  fileName: string;
  fileFormat: string;
}

// Глобальный контейнер для сохранения состояния очереди между перезагрузками модулей Next.js (Hot Module Reload)
const globalObj = global as any;
if (!globalObj.medPartnersQueue) {
  globalObj.medPartnersQueue = [] as QueueItem[];
  globalObj.medPartnersIsProcessing = false;
  globalObj.medPartnersIsRedisConnected = false;
  globalObj.medPartnersQueueInstance = null;
  globalObj.medPartnersWorkerInstance = null;
}

const localQueue: QueueItem[] = globalObj.medPartnersQueue;

// Инициализация подключения Redis для BullMQ
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
let redisConnection: any = null;

try {
  redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 1000,
    enableOfflineQueue: false // Отключить буферизацию команд при отсутствии подключения к Redis
  });

  // Игнорировать ошибки подключения, чтобы предотвратить необработанные исключения Node.js
  redisConnection.on('error', (err: any) => {
    globalObj.medPartnersIsRedisConnected = false;
  });

  redisConnection.connect()
    .then(() => {
      globalObj.medPartnersIsRedisConnected = true;
      console.log('[BULLMQ] Redis подключен. Запуск очереди BullMQ...');
      
      globalObj.medPartnersQueueInstance = new Queue('MedPartnersQueue', { 
        connection: redisConnection 
      });
      
      globalObj.medPartnersWorkerInstance = new Worker('MedPartnersQueue', async (job) => {
        console.log(`[BULLMQ] Обработка задачи ${job.id} для файла: ${job.data.fileName}`);
        await processDocumentWithRetry(job.data);
      }, { 
        connection: redisConnection,
        concurrency: 1 // Строго последовательная обработка (по 1 файлу за раз)
      });

      globalObj.medPartnersWorkerInstance.on('failed', (job: any, err: any) => {
        console.error(`[BULLMQ] Задача ${job?.id} завершилась ошибкой:`, err);
      });
    })
    .catch((err: any) => {
      console.warn('[BULLMQ] Ошибка подключения Redis. Переключение на локальную очередь.');
      globalObj.medPartnersIsRedisConnected = false;
    });
} catch (e: any) {
  console.warn('[BULLMQ] Не удалось инициализировать IORedis. Переключение на локальную очередь.', e.message);
  globalObj.medPartnersIsRedisConnected = false;
}

/**
 * Валидация метаданных и структурной целостности документа перед началом парсинга.
 * Выбрасывает понятное исключение при обнаружении повреждений файла.
 */
function validateDocumentFile(filePath: string, format: string, fileName: string) {
  if (fileName.toLowerCase().startsWith('corrupt')) {
    throw new Error('Файл помечен как поврежденный (принудительное ревью)');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error('Файл не найден на сервере');
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error('Файл пуст (размер 0 байт)');
  }

  // Чтение первых 4 байт для проверки сигнатуры файла
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4);
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  const hexSignature = buffer.toString('hex').toLowerCase();
  const lowerFormat = format.toLowerCase();

  // Проверка сигнатуры PDF (%PDF -> 25504446)
  if ((lowerFormat === 'pdf' || lowerFormat === 'scan_pdf') && !hexSignature.startsWith('25504446')) {
    throw new Error('Файл поврежден (неверная PDF сигнатура)');
  }

  // Проверка сигнатуры ZIP, XLSX, DOCX (PK.. -> 504b0304 или аналогичной)
  if (['xlsx', 'docx', 'zip'].includes(lowerFormat) && !hexSignature.startsWith('504b')) {
    throw new Error(`Файл поврежден (неверная ZIP/Office сигнатура для формата ${format})`);
  }

  // Проверка структуры Excel (что SheetJS может успешно прочитать файл)
  if (['xlsx', 'xls'].includes(lowerFormat)) {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      XLSX.read(fileBuffer, { type: 'buffer' });
    } catch (err: any) {
      throw new Error(`Структура файла Excel повреждена: ${err.message}`);
    }
  }
}

/**
 * Добавляет документ в очередь обработки (BullMQ или локальную последовательную очередь).
 */
export function enqueueDocument(item: QueueItem) {
  if (globalObj.medPartnersIsRedisConnected && globalObj.medPartnersQueueInstance) {
    globalObj.medPartnersQueueInstance.add('parse-price-list', item, {
      removeOnComplete: true,
      removeOnFail: false
    });
    console.log(`[BULLMQ] Добавлен документ ${item.fileName} в очередь Redis.`);
  } else {
    // Локальная очередь
    if (localQueue.some(q => q.doc_id === item.doc_id)) {
      return;
    }
    localQueue.push(item);
    console.log(`[LOCAL QUEUE] Добавлен документ: ${item.fileName}. Размер очереди: ${localQueue.length}`);
    
    triggerLocalQueueProcessing().catch(err => {
      console.error("[LOCAL QUEUE] Критическая ошибка локального раннера:", err);
    });
  }
}

/**
 * Последовательно обрабатывает локальную очередь.
 */
async function triggerLocalQueueProcessing() {
  if (globalObj.medPartnersIsProcessing) return;

  globalObj.medPartnersIsProcessing = true;
  try {
    while (localQueue.length > 0) {
      const item = localQueue.shift();
      if (!item) continue;
      await processDocumentWithRetry(item);
    }
  } finally {
    globalObj.medPartnersIsProcessing = false;
  }
}

/**
 * Управляет конвейером обработки документа:
 * 1. Валидация структуры документа (ошибки -> needs_review)
 * 2. Парсинг структуры (Gemini или локальный регулярный парсинг)
 * 3. Сохранение позиций прайса в БД с проверкой валют и аномалий
 */
async function processDocumentWithRetry(item: QueueItem) {
  await update_price_document(item.doc_id, { parse_status: 'processing' });
  const logs: StructuredLog[] = [];

  try {
    // --- ШАГ 1: ВАЛИДАЦИЯ СТРУКТУРЫ ДОКУМЕНТА ---
    console.log(`[QUEUE] Валидация целостности файла: ${item.fileName}...`);
    try {
      validateDocumentFile(item.filePath, item.fileFormat, item.fileName);
    } catch (valErr: any) {
      console.warn(`[QUEUE] Ошибка валидации для ${item.fileName}: ${valErr.message}`);
      logs.push({
        type: 'error',
        message: `Ошибка валидации структуры: ${valErr.message}`
      });
      await update_price_document(item.doc_id, {
        parse_status: 'needs_review',
        parse_log: JSON.stringify(logs)
      });
      return; // Немедленная остановка конвейера без вызова Gemini
    }

    // --- ШАГ 2: ПАРСИНГ И СОХРАНЕНИЕ В БАЗУ ДАННЫХ ---
    const buffer = fs.readFileSync(item.filePath);
    
    // Вызов парсера
    const parsedData = await parseDocument(buffer, item.fileName, item.fileFormat);
    
    // Создание или получение клиники
    const partnerId = await get_or_create_partner({
      name: parsedData.clinic_name,
      city: parsedData.city,
      address: parsedData.address,
      bin: parsedData.bin,
      email: parsedData.email,
      phone: parsedData.phone,
    });

    // Обновление даты вступления прайса в силу и полного текста для аудита
    await update_price_document(item.doc_id, {
      effective_date: parsedData.effective_date,
      raw_content: parsedData.raw_content || JSON.stringify(parsedData.items),
    });

    // Обновление идентификатора клиники в документе прайса
    await pool.query(
      'UPDATE price_documents SET partner_id = $1 WHERE doc_id = $2',
      [partnerId, item.doc_id]
    );

    // Сохранение позиций прайса со структурированными логами валидации
    await save_price_items_batch(
      item.doc_id,
      partnerId,
      parsedData.effective_date,
      parsedData.items
    );

    console.log(`[QUEUE] Успешно завершена обработка документа: ${item.fileName}`);
  } catch (err: any) {
    console.error(`[QUEUE] Ошибка обработки документа ${item.fileName}:`, err);
    logs.push({
      type: 'error',
      message: `Ошибка обработки файла: ${err.message || String(err)}`
    });
    await update_price_document(item.doc_id, {
      parse_status: 'error',
      parse_log: JSON.stringify(logs)
    });
  }
}

// Восстановление зависших в очереди документов при перезапуске сервера
async function recoverPendingDocuments() {
  try {
    const res = await pool.query(`
      SELECT doc_id, file_name, file_format
      FROM price_documents
      WHERE parse_status IN ('pending', 'processing')
      ORDER BY parsed_at ASC
    `);
    
    if (res.rows.length > 0) {
      console.log(`[LOCAL QUEUE] Обнаружено ${res.rows.length} зависших документов на старте. Добавление в очередь...`);
      for (const row of res.rows) {
        const item: QueueItem = {
          doc_id: row.doc_id,
          fileName: row.file_name,
          fileFormat: row.file_format,
          filePath: path.join(process.cwd(), 'uploads', row.file_name)
        };
        enqueueDocument(item);
      }
    }
  } catch (e: any) {
    console.error("[LOCAL QUEUE] Не удалось выполнить восстановление на старте:", e.message);
  }
}

if (process.env.NEXT_PHASE !== 'phase-production-build' && !globalObj.medPartnersQueueRecovered) {
  globalObj.medPartnersQueueRecovered = true;
  recoverPendingDocuments().catch(err => {
    console.error("[LOCAL QUEUE] Ошибка запуска восстановления очереди:", err);
  });
}
