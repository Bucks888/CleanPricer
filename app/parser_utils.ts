import { GoogleGenerativeAI } from '@google/generative-ai';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import pRetry from 'p-retry';

type GeminiLikeModel = {
  generateContent(content: unknown): Promise<{ response?: { text(): string } }>;
};

export type ParsedPriceItem = {
  service_name_raw: string;
  price_original: number;
  price_nonresident_original?: number;
  service_code_source?: string;
};

export interface ParsedPriceList {
  clinic_name: string;
  city?: string;
  address?: string;
  bin?: string;
  email?: string;
  phone?: string;
  effective_date: string;
  currency: string;
  raw_content?: string;
  items: ParsedPriceItem[];
}

type SheetRows = unknown[][];

type NodePolyfills = typeof globalThis & {
  DOMMatrix?: typeof globalThis.DOMMatrix;
  ImageData?: typeof globalThis.ImageData;
  Path2D?: typeof globalThis.Path2D;
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const nodePolyfills = globalThis as NodePolyfills;

if (typeof globalThis !== 'undefined') {
  if (!nodePolyfills.DOMMatrix) {
    nodePolyfills.DOMMatrix = class DOMMatrix {} as unknown as typeof globalThis.DOMMatrix;
  }
  if (!nodePolyfills.ImageData) {
    nodePolyfills.ImageData = class ImageData {} as unknown as typeof globalThis.ImageData;
  }
  if (!nodePolyfills.Path2D) {
    nodePolyfills.Path2D = class Path2D {} as unknown as typeof globalThis.Path2D;
  }
}

function stripCodeFence(text: string) {
  let cleanText = text.trim();
  if (cleanText.includes('```json')) {
    cleanText = cleanText.split('```json')[1].split('```')[0].trim();
  } else if (cleanText.includes('```')) {
    cleanText = cleanText.split('```')[1].split('```')[0].trim();
  }
  return cleanText;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMaybeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.,-]/g, '').replace(',', '.');
    if (!cleaned) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toIsoDateFromText(value: string): string | undefined {
  const ddmmyyyy = value.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return iso ? iso[1] : undefined;
}

function looksLikeDate(value: string): boolean {
  return /\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(value);
}

function rowToText(row: unknown[]): string {
  return row
    .map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
    .map((cell) => cell.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\t');
}

function parseMaybeJson(text: string): unknown {
  const cleanText = stripCodeFence(text);
  try {
    return JSON.parse(cleanText);
  } catch {
    return null;
  }
}

function normalizeItemPayload(item: unknown): ParsedPriceItem | null {
  if (!isRecord(item)) {
    return null;
  }

  const service_name_raw = normalizeWhitespace(String(item.service_name_raw ?? item.service_name ?? ''));
  const price_original = parseMaybeNumber(item.price_original);
  if (!service_name_raw || price_original === undefined || price_original <= 0) {
    return null;
  }

  const price_nonresident_original = parseMaybeNumber(item.price_nonresident_original);
  const service_code_source = typeof item.service_code_source === 'string'
    ? item.service_code_source.trim()
    : undefined;

  return {
    service_name_raw,
    price_original,
    price_nonresident_original: price_nonresident_original && price_nonresident_original > 0
      ? price_nonresident_original
      : undefined,
    service_code_source: service_code_source || undefined,
  };
}

function normalizeParsedPayload(
  payload: unknown,
  fallbackClinicName: string,
  fallbackText: string
): ParsedPriceList {
  const source = isRecord(payload) ? payload : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.map(normalizeItemPayload).filter((item): item is ParsedPriceItem => item !== null);

  const clinicName = typeof source.clinic_name === 'string' && source.clinic_name.trim()
    ? source.clinic_name.trim()
    : fallbackClinicName;

  const effectiveDate = typeof source.effective_date === 'string' && source.effective_date.trim()
    ? source.effective_date.trim()
    : new Date().toISOString().split('T')[0];

  return {
    clinic_name: clinicName,
    city: typeof source.city === 'string' ? source.city.trim() || undefined : undefined,
    address: typeof source.address === 'string' ? source.address.trim() || undefined : undefined,
    bin: typeof source.bin === 'string' ? source.bin.trim() || undefined : undefined,
    email: typeof source.email === 'string' ? source.email.trim() || undefined : undefined,
    phone: typeof source.phone === 'string' ? source.phone.trim() || undefined : undefined,
    effective_date: effectiveDate,
    currency: typeof source.currency === 'string' && source.currency.trim()
      ? source.currency.trim().toUpperCase()
      : 'KZT',
    raw_content: typeof source.raw_content === 'string' && source.raw_content.trim()
      ? source.raw_content
      : fallbackText,
    items,
  };
}

async function callGeminiWithRetry(model: GeminiLikeModel, content: unknown): Promise<{ response?: { text(): string } }> {
  return pRetry(
    async () => {
      const res = await model.generateContent(content);
      if (!res || !res.response) {
        throw new Error('Пустой ответ от GoogleGenerativeAI');
      }
      return res;
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      onFailedAttempt: (error: unknown) => {
        const actualError = isRecord(error) && error.error ? error.error : error;
        const message = actualError instanceof Error ? actualError.message : String(actualError);
        console.warn(
          `[GEMINI] Попытка ${isRecord(error) && typeof error.attemptNumber === 'number' ? error.attemptNumber : '?'} не удалась. ` +
            `Ошибка: ${message}`
        );
      },
    }
  );
}

function extractTextFromDocx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const docXml = zip.readAsText('word/document.xml');
  const sanitized = docXml
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, '')
    .replace(/<w:moveTo\b[^>]*>[\s\S]*?<\/w:moveTo>/g, '');

  const lines: string[] = [];
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let paragraphMatch: RegExpExecArray | null;
  while ((paragraphMatch = paragraphRegex.exec(sanitized)) !== null) {
    const paragraph = paragraphMatch[1];
    const texts: string[] = [];
    const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(paragraph)) !== null) {
      texts.push(decodeXmlEntities(textMatch[1]));
    }

    const line = normalizeWhitespace(texts.join(' '));
    if (line) {
      lines.push(line);
    }
  }

  if (lines.length === 0) {
    const fallback = sanitized
      .replace(/<w:tc\b[^>]*>/g, '\t')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<[^>]+>/g, ' ');
    return normalizeWhitespace(decodeXmlEntities(fallback));
  }

  return lines.join('\n');
}

export async function parseDocument(fileBuffer: Buffer, fileName: string, fileFormat: string): Promise<ParsedPriceList> {
  const format = fileFormat.toLowerCase();

  if (format === 'xlsx' || format === 'xls') {
    return parseExcel(fileBuffer, fileName);
  }

  if (format === 'docx') {
    return parseDocx(fileBuffer, fileName);
  }

  if (format === 'pdf' || format === 'scan_pdf') {
    return parsePdf(fileBuffer, fileName);
  }

  throw new Error(`Неподдерживаемый формат файла: ${fileFormat}`);
}

function parseTextLocally(text: string, fileName: string): ParsedPriceList | null {
  const lines = text.split('\n');
  const items: ParsedPriceItem[] = [];
  let clinicName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  let effectiveDate = new Date().toISOString().split('T')[0];

  for (const line of lines) {
    const cleanLine = normalizeWhitespace(line);
    if (!cleanLine) continue;

    if (!clinicName || clinicName === fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim()) {
      if (/clinic|клиник|медцент|hospital|центр/i.test(cleanLine) && cleanLine.length < 120) {
        clinicName = cleanLine;
      }
    }

    const dateCandidate = toIsoDateFromText(cleanLine);
    if (dateCandidate && looksLikeDate(cleanLine)) {
      effectiveDate = dateCandidate;
    }

    const match = cleanLine.match(/^(.*?)(?:[-:=→]|\s{2,})\s*(\d{1,3}(?:[ \u00a0]?\d{3}){0,2})\s*(?:тг|kzt|kzt\.|руб|rub|\$)?$/i);
    if (!match) continue;

    const name = normalizeWhitespace(match[1]);
    const price = parseMaybeNumber(match[2]);
    if (name.length > 3 && price !== undefined && price > 0) {
      items.push({
        service_name_raw: name,
        price_original: price,
        price_nonresident_original: price,
      });
    }
  }

  if (items.length >= 5) {
    return {
      clinic_name: clinicName || fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim(),
      effective_date: effectiveDate,
      currency: 'KZT',
      raw_content: text,
      items,
    };
  }

  return null;
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  let extractedText = '';

  try {
    const pdfParseModule = (await import('pdf-parse')) as any;
    if (typeof pdfParseModule.PDFParse === 'function') {
      const parser = new pdfParseModule.PDFParse(new Uint8Array(buffer));
      const result = await parser.getText();
      extractedText = result?.text || '';
    } else {
      const pdfParseFn = (typeof pdfParseModule.default === 'function'
        ? pdfParseModule.default
        : (typeof pdfParseModule === 'function' ? pdfParseModule : null));
      if (pdfParseFn) {
        const result = await pdfParseFn(buffer);
        extractedText = result?.text || '';
      } else {
        throw new Error('Не удалось найти функцию парсинга в модуле pdf-parse');
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[PARSER] Локальный pdf-parse не удался, переходим к Gemini OCR: ${message}`);
  }

  const cleanText = extractedText.trim();
  if (cleanText.length > 50) {
    const localResult = parseTextLocally(cleanText, fileName);
    if (localResult) {
      localResult.raw_content = cleanText;
      return localResult;
    }
    return parseTextWithGeminiInChunks(cleanText, fileName);
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const response = await callGeminiWithRetry(model, [
    {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: 'application/pdf',
      },
    },
    {
      text: `You are an expert system processing medical price lists.
Extract all clinical information and prices in the specified JSON schema:
{
  "clinic_name": "Clinic Name",
  "city": "City (if present)",
  "address": "Address (if present)",
  "bin": "BIN (12 digit business identification number, if present)",
  "email": "Email (if present)",
  "phone": "Phone (if present)",
  "effective_date": "YYYY-MM-DD",
  "currency": "KZT or USD or RUB (default to KZT)",
  "items": [
    {
      "service_name_raw": "Raw service name as written in document",
      "price_original": 12000,
      "price_nonresident_original": 15000,
      "service_code_source": "service code/id if present"
    }
  ]
}
`,
    },
  ]);

  const parsed = parseGeminiResponse(response.response?.text() || '', fileName, '[Мультимодальное OCR распознавание скана PDF]');
  parsed.raw_content = '[Мультимодальное OCR распознавание скана PDF]';
  return parsed;
}

async function parseDocx(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  const textContent = extractTextFromDocx(buffer);
  const localResult = parseTextLocally(textContent, fileName);
  if (localResult) {
    localResult.raw_content = textContent;
    return localResult;
  }
  return parseTextWithGeminiInChunks(textContent, fileName);
}

type ExcelHeaderResult = {
  headerRowIdx: number;
  nameColIdx: number;
  priceColIdx: number;
  priceNonresColIdx: number;
  codeColIdx: number;
  currencyColIdx: number;
};

function findExcelHeaders(rows: SheetRows): ExcelHeaderResult {
  let headerRowIdx = -1;
  let nameColIdx = -1;
  let priceColIdx = -1;
  let priceNonresColIdx = -1;
  let codeColIdx = -1;
  let currencyColIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let hasName = false;
    let hasPrice = false;

    for (let c = 0; c < row.length; c++) {
      const val = normalizeWhitespace(String(row[c] ?? '').toLowerCase());
      if (!val) continue;

      if (val.includes('наименование') || val.includes('название') || val.includes('услуга') || val.includes('процедура') || val === 'name' || val === 'service') {
        nameColIdx = c;
        hasName = true;
      }
      if (val.includes('цена') || val.includes('стоимость') || val === 'price' || val === 'rate') {
        if (val.includes('нерезидент') || val.includes('non-resident') || val.includes('nonresident')) {
          priceNonresColIdx = c;
        } else {
          priceColIdx = c;
          hasPrice = true;
        }
      }
      if (val.includes('код') || val.includes('артикул') || val === 'code' || val === 'id') {
        codeColIdx = c;
      }
      if (val.includes('валюта') || val === 'currency') {
        currencyColIdx = c;
      }
    }

    if (hasName && hasPrice) {
      headerRowIdx = r;
      break;
    }
  }

  return { headerRowIdx, nameColIdx, priceColIdx, priceNonresColIdx, codeColIdx, currencyColIdx };
}

function parseExcelSheet(rows: SheetRows, fileName: string): ParsedPriceList | null {
  const { headerRowIdx, nameColIdx, priceColIdx, priceNonresColIdx, codeColIdx, currencyColIdx } = findExcelHeaders(rows);
  if (headerRowIdx === -1 || nameColIdx === -1 || priceColIdx === -1) {
    return null;
  }

  const items: ParsedPriceItem[] = [];
  let detectedCurrency = 'KZT';
  let clinicName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  let effectiveDate = new Date().toISOString().split('T')[0];

  for (let r = 0; r < Math.min(headerRowIdx, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const rowText = rowToText(row);
    const dateCandidate = toIsoDateFromText(rowText);
    if (dateCandidate && looksLikeDate(rowText)) {
      effectiveDate = dateCandidate;
    }
    if (/клиник|clinic|медцентр|центр/i.test(rowText) && rowText.length < 120) {
      clinicName = rowText;
    }
  }

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const name = normalizeWhitespace(String(row[nameColIdx] ?? ''));
    if (!name) continue;

    const priceRes = parseMaybeNumber(row[priceColIdx]);
    if (priceRes === undefined || priceRes <= 0) continue;

    const priceNonres = priceNonresColIdx !== -1 ? parseMaybeNumber(row[priceNonresColIdx]) : undefined;
    const code = codeColIdx !== -1 ? normalizeWhitespace(String(row[codeColIdx] ?? '')) : '';
    if (currencyColIdx !== -1 && row[currencyColIdx] !== undefined && row[currencyColIdx] !== null) {
      detectedCurrency = normalizeWhitespace(String(row[currencyColIdx])).toUpperCase() || detectedCurrency;
    }

    items.push({
      service_name_raw: name,
      price_original: priceRes,
      price_nonresident_original: priceNonres && priceNonres > 0 ? priceNonres : priceRes,
      service_code_source: code || undefined,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return {
    clinic_name: clinicName,
    effective_date: effectiveDate,
    currency: detectedCurrency,
    raw_content: rows.slice(0, 300).map(rowToText).join('\n'),
    items,
  };
}

async function parseExcel(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetResults: ParsedPriceList[] = [];
  const allRowsForFallback: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as SheetRows;
    allRowsForFallback.push(`## ${sheetName}\n${rows.slice(0, 300).map(rowToText).join('\n')}`);

    const parsedSheet = parseExcelSheet(rows, fileName);
    if (parsedSheet) {
      sheetResults.push(parsedSheet);
    }
  }

  if (sheetResults.length > 0) {
    const [first, ...rest] = sheetResults;
    const combinedItems = [...first.items];
    for (const result of rest) {
      combinedItems.push(...result.items);
    }

    return {
      clinic_name: first.clinic_name,
      city: first.city,
      address: first.address,
      bin: first.bin,
      email: first.email,
      phone: first.phone,
      effective_date: first.effective_date,
      currency: first.currency,
      raw_content: allRowsForFallback.join('\n\n'),
      items: combinedItems,
    };
  }

  return parseExcelWithGemini(allRowsForFallback.join('\n\n'), fileName);
}

async function parseExcelWithGemini(textContent: string, fileName: string): Promise<ParsedPriceList> {
  return parseTextWithGeminiInChunks(textContent, fileName);
}

async function parseTextWithGeminiInChunks(text: string, fileName: string): Promise<ParsedPriceList> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const metadataText = text.slice(0, 2000);
  const metaResponse = await callGeminiWithRetry(model, [
    {
      text: `Here is the start of a clinic price list document:
---
${metadataText}
---

Extract the clinic metadata. Return ONLY a JSON object:
{
  "clinic_name": "Clinic Name",
  "city": "City (if present)",
  "address": "Address (if present)",
  "bin": "BIN (12 digit business identification number, if present)",
  "email": "Email (if present)",
  "phone": "Phone (if present)",
  "effective_date": "YYYY-MM-DD",
  "currency": "KZT or USD or RUB (default to KZT)"
}
`,
    },
  ]);

  const metaPayload = parseMaybeJson(metaResponse.response?.text() || '');
  const fallbackClinicName = fileName.split('.')[0] || 'Нераспознанная клиника';
  const meta = normalizeParsedPayload(metaPayload, fallbackClinicName, text);

  const result: ParsedPriceList = {
    clinic_name: meta.clinic_name,
    city: meta.city,
    address: meta.address,
    bin: meta.bin,
    email: meta.email,
    phone: meta.phone,
    effective_date: meta.effective_date,
    currency: meta.currency,
    items: [],
    raw_content: text,
  };

  const lines = text.split('\n').map((line) => normalizeWhitespace(line)).filter(Boolean);
  const chunkSize = 250;
  const numChunks = Math.ceil(lines.length / chunkSize);

  for (let i = 0; i < numChunks; i++) {
    const chunkLines = lines.slice(i * chunkSize, (i + 1) * chunkSize);
    const chunkText = chunkLines.join('\n');

    try {
      const itemResponse = await callGeminiWithRetry(model, [
        {
          text: `Here is a portion of a clinic price list text:
---
${chunkText}
---

Extract the services and prices from this portion. Return ONLY a JSON object:
{
  "items": [
    {
      "service_name_raw": "Raw service name as written in document",
      "price_original": 12000,
      "price_nonresident_original": 15000,
      "service_code_source": "service code/id if present"
    }
  ]
}
`,
        },
      ]);

      const chunkPayload = parseMaybeJson(itemResponse.response?.text() || '');
      const chunkItems = normalizeParsedPayload(chunkPayload, fallbackClinicName, chunkText).items;
      result.items.push(...chunkItems);
    } catch (chunkErr: unknown) {
      const message = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
      console.error(`[PARSER] Ошибка разбора чанка ${i + 1} для ${fileName}:`, message);
    }
  }

  return result;
}

function parseGeminiResponse(text: string, fileName: string, fallbackText: string): ParsedPriceList {
  const payload = parseMaybeJson(text);
  return normalizeParsedPayload(payload, fileName.replace(/\.[^/.]+$/, ''), fallbackText);
}
