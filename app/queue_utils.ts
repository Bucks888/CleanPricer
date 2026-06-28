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
  StructuredLog,
} from './db_utils';
import { parseDocument } from './parser_utils';

interface QueueItem {
  doc_id: string;
  filePath: string;
  fileName: string;
  fileFormat: string;
}

type QueueGlobalState = typeof globalThis & {
  medPartnersQueue?: QueueItem[];
  medPartnersIsProcessing?: boolean;
  medPartnersIsRedisConnected?: boolean;
  medPartnersQueueInstance?: Queue | null;
  medPartnersWorkerInstance?: Worker | null;
  medPartnersQueueRecovered?: boolean;
};

const globalObj = globalThis as QueueGlobalState;

if (!globalObj.medPartnersQueue) {
  globalObj.medPartnersQueue = [];
  globalObj.medPartnersIsProcessing = false;
  globalObj.medPartnersIsRedisConnected = false;
  globalObj.medPartnersQueueInstance = null;
  globalObj.medPartnersWorkerInstance = null;
  globalObj.medPartnersQueueRecovered = false;
}

const localQueue = globalObj.medPartnersQueue;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
let redisConnection: IORedis | null = null;
let initPromise: Promise<void> | null = null;

async function ensureQueueManager() {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  if (globalObj.medPartnersQueueInstance) {
    return;
  }

  initPromise = (async () => {
    try {
      redisConnection = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 1000,
        enableOfflineQueue: false,
      });

      redisConnection.on('error', () => {
        globalObj.medPartnersIsRedisConnected = false;
      });

      await redisConnection.connect();
      globalObj.medPartnersIsRedisConnected = true;
      console.log('[BULLMQ] Redis connected. Starting worker.');

      globalObj.medPartnersQueueInstance = new Queue('MedPartnersQueue', {
        connection: redisConnection as never,
      });

      globalObj.medPartnersWorkerInstance = new Worker(
        'MedPartnersQueue',
        async (job) => {
          console.log(`[BULLMQ] Processing job ${job.id} for file: ${job.data.fileName}`);
          await processDocumentWithRetry(job.data);
        },
        {
          connection: redisConnection as never,
          concurrency: 1,
        }
      );

      globalObj.medPartnersWorkerInstance.on('failed', (job, err) => {
        console.error(`[BULLMQ] Job ${job?.id} failed:`, err);
      });
    } catch (err) {
      globalObj.medPartnersIsRedisConnected = false;
      console.warn('[BULLMQ] Redis unavailable. Falling back to local queue.', err);
    }

    if (!globalObj.medPartnersQueueRecovered) {
      globalObj.medPartnersQueueRecovered = true;
      await recoverPendingDocuments();
    }
  })();

  return initPromise;
}

function validateDocumentFile(filePath: string, format: string, fileName: string) {
  if (fileName.toLowerCase().startsWith('corrupt')) {
    throw new Error('File is marked as corrupted (forced review)');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('File was not found on disk');
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error('File is empty (0 bytes)');
  }

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4);
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  const hexSignature = buffer.toString('hex').toLowerCase();
  const lowerFormat = format.toLowerCase();

  if ((lowerFormat === 'pdf' || lowerFormat === 'scan_pdf') && !hexSignature.startsWith('25504446')) {
    throw new Error('File has an invalid PDF signature');
  }

  if (['xlsx', 'docx', 'zip'].includes(lowerFormat) && !hexSignature.startsWith('504b')) {
    throw new Error(`Invalid ZIP/Office signature for format ${format}`);
  }

  if (['xlsx', 'xls'].includes(lowerFormat)) {
    const fileBuffer = fs.readFileSync(filePath);
    XLSX.read(fileBuffer, { type: 'buffer' });
  }
}

export function enqueueDocument(item: QueueItem) {
  if (globalObj.medPartnersIsRedisConnected && globalObj.medPartnersQueueInstance) {
    void globalObj.medPartnersQueueInstance.add('parse-price-list', item, {
      removeOnComplete: true,
      removeOnFail: false,
    });
    console.log(`[BULLMQ] Added document ${item.fileName} to Redis queue.`);
    return;
  }

  if (localQueue.some((q) => q.doc_id === item.doc_id)) {
    return;
  }

  localQueue.push(item);
  console.log(`[LOCAL QUEUE] Added document: ${item.fileName}. Queue size: ${localQueue.length}`);

  void triggerLocalQueueProcessing().catch((err) => {
    console.error('[LOCAL QUEUE] Critical local runner error:', err);
  });
}

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

async function processDocumentWithRetry(item: QueueItem) {
  await update_price_document(item.doc_id, { parse_status: 'processing' });
  const logs: StructuredLog[] = [];

  try {
    console.log(`[QUEUE] Validating file: ${item.fileName}...`);
    try {
      validateDocumentFile(item.filePath, item.fileFormat, item.fileName);
    } catch (valErr) {
      const message = valErr instanceof Error ? valErr.message : String(valErr);
      console.warn(`[QUEUE] Validation error for ${item.fileName}: ${message}`);
      logs.push({ type: 'error', message: `Validation error: ${message}` });
      await update_price_document(item.doc_id, {
        parse_status: 'needs_review',
        parse_log: JSON.stringify(logs),
      });
      return;
    }

    const buffer = fs.readFileSync(item.filePath);
    const parsedData = await parseDocument(buffer, item.fileName, item.fileFormat);

    const partnerId = await get_or_create_partner({
      name: parsedData.clinic_name,
      city: parsedData.city,
      address: parsedData.address,
      bin: parsedData.bin,
      email: parsedData.email,
      phone: parsedData.phone,
    });

    await update_price_document(item.doc_id, {
      effective_date: parsedData.effective_date,
      raw_content: parsedData.raw_content || JSON.stringify(parsedData.items),
    });

    await pool.query('UPDATE price_documents SET partner_id = $1 WHERE doc_id = $2', [partnerId, item.doc_id]);

    await save_price_items_batch(item.doc_id, partnerId, parsedData.effective_date, parsedData.items);

    console.log(`[QUEUE] Document completed: ${item.fileName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[QUEUE] Error processing ${item.fileName}:`, err);
    logs.push({ type: 'error', message: `File processing error: ${message}` });
    await update_price_document(item.doc_id, {
      parse_status: 'error',
      parse_log: JSON.stringify(logs),
    });
  }
}

async function recoverPendingDocuments() {
  try {
    const res = await pool.query(`
      SELECT doc_id, file_name, file_format
      FROM price_documents
      WHERE parse_status IN ('pending', 'processing')
      ORDER BY parsed_at ASC
    `);

    if (res.rows.length === 0) {
      return;
    }

    console.log(`[LOCAL QUEUE] Recovering ${res.rows.length} pending documents...`);
    for (const row of res.rows) {
      enqueueDocument({
        doc_id: row.doc_id,
        fileName: row.file_name,
        fileFormat: row.file_format,
        filePath: path.join(process.cwd(), 'uploads', row.file_name),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[LOCAL QUEUE] Failed to recover pending documents:', message);
  }
}

if (process.env.NEXT_PHASE !== 'phase-production-build') {
  void ensureQueueManager();
}
