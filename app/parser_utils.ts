import { GoogleGenerativeAI } from "@google/generative-ai";
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import pRetry from 'p-retry';

// Полифиллы для окружения Node, чтобы предотвратить сбои холста в pdf-parse
if (typeof global !== 'undefined') {
  if (!(global as any).DOMMatrix) {
    (global as any).DOMMatrix = class DOMMatrix {};
  }
  if (!(global as any).ImageData) {
    (global as any).ImageData = class ImageData {};
  }
  if (!(global as any).Path2D) {
    (global as any).Path2D = class Path2D {};
  }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ParsedPriceList {
  clinic_name: string;
  city?: string;
  address?: string;
  bin?: string;
  email?: string;
  phone?: string;
  effective_date: string; // ГГГГ-ММ-ДД
  currency: string;
  raw_content?: string;
  items: {
    service_name_raw: string;
    price_original: number;
    price_nonresident_original?: number;
    service_code_source?: string;
  }[];
}

/**
 * Надежная обертка для вызовов моделей Gemini с экспоненциальным бэкэффом попыток при помощи p-retry
 */
async function callGeminiWithRetry(model: any, content: any): Promise<any> {
  return pRetry(
    async () => {
      const res = await model.generateContent(content);
      // Проверка получения ответа
      if (!res || !res.response) {
        throw new Error("Пустой ответ от GoogleGenerativeAI");
      }
      return res;
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      onFailedAttempt: (error: any) => {
        const actualError = error.error || error;
        console.warn(
          `[GEMINI] Попытка ${error.attemptNumber} не удалась. Осталось попыток: ${error.retriesLeft}. Ошибка:`,
          actualError.message || actualError
        );
        if (actualError.stack) {
          console.warn(actualError.stack);
        }
      }
    }
  );
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

/**
 * Локальный регулярный/эвристический парсер текста для быстрого разбора простых макетов прайс-листов локально за 0 мс.
 */
function parseTextLocally(text: string, fileName: string): ParsedPriceList | null {
  const lines = text.split('\n');
  const items: any[] = [];

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.length < 5) continue;

    // Сопоставление названия услуги, за которым следует разделитель цены и число из 3-7 цифр
    // Примеры: "Консультация терапевта - 12000 тг", "УЗИ малого таза 15000", "МРТ головного мозга : 45 000"
    const match = cleanLine.match(/^(.*?)(?:[-:=➔]|\s{2,})?\s*(\d{1,3}(?:\s?\d{3}){0,2})\s*(?:тг|kzt|kzt\.|руб|\$)?$/i);
    if (match) {
      const name = match[1].trim();
      const priceStr = match[2].replace(/\s/g, '');
      const price = parseFloat(priceStr);

      if (name.length > 4 && price > 0 && isNaN(price) === false) {
        items.push({
          service_name_raw: name,
          price_original: price,
          price_nonresident_original: price
        });
      }
    }
  }

  // Эвристика: если успешно разобрано не менее 5 услуг, считать локальный разбор успешным
  if (items.length >= 5) {
    console.log(`[PARSER] Локальный регулярный парсер успешно извлек ${items.length} услуг.`);
    return {
      clinic_name: fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim(),
      effective_date: new Date().toISOString().split('T')[0],
      currency: "KZT",
      items
    };
  }

  return null;
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  console.log(`[PARSER] Начало парсинга PDF для ${fileName}...`);
  let extractedText = '';

  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    extractedText = result.text || '';
  } catch (err: any) {
    console.warn(`[PARSER] Локальный pdf-parse не удался, переход на мультимодальный Gemini OCR:`, err.message);
  }

  const cleanText = extractedText.trim();

  if (cleanText.length > 50) {
    // Сначала попробовать локальный эвристический парсинг (без обращений к API)
    const localResult = parseTextLocally(cleanText, fileName);
    if (localResult) {
      localResult.raw_content = cleanText;
      return localResult;
    }

    return parseTextWithGeminiInChunks(cleanText, fileName);
  }

  // Резервный вариант: полноценный мультимодальный Gemini OCR (загрузка изображения скана PDF)
  console.log(`[PARSER] Текст PDF пустой или слишком короткий. Переход на мультимодальный Gemini OCR...`);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const response = await callGeminiWithRetry(model, [
    {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType: "application/pdf"
      }
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
  "effective_date": "YYYY-MM-DD (extract the date the price list becomes effective, or today's date if not specified)",
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
`
    }
  ]);

  const parsed = parseGeminiResponse(response.response.text());
  parsed.raw_content = "[Мультимодальное OCR распознавание скана PDF]";
  return parsed;
}

async function parseDocx(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  const textContent = extractTextFromDocx(buffer);
  return parseTextWithGeminiInChunks(textContent, fileName);
}

function extractTextFromDocx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const docXml = zip.readAsText('word/document.xml');
  let text = docXml;

  // Принять все отслеживаемые изменения (удалить блоки w:del и w:delText)
  text = text.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');
  text = text.replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '');

  text = text.replace(/<\/w:tc>/g, '\t');
  text = text.replace(/<\/w:tr>/g, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&apos;/g, "'");
  return text;
}

async function parseExcel(buffer: Buffer, fileName: string): Promise<ParsedPriceList> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const textContent = rows.slice(0, 300).map(r => r.join('\t')).join('\n');
  const { headerRowIdx, nameColIdx, priceColIdx, priceNonresColIdx, codeColIdx, currencyColIdx } = findExcelHeaders(rows);

  if (headerRowIdx === -1 || nameColIdx === -1 || priceColIdx === -1) {
    console.log("Заголовки Excel не определены четко. Переход на разбор через Gemini.");
    return parseExcelWithGemini(rows, fileName);
  }

  const items: any[] = [];
  let detectedCurrency = 'KZT';

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const name = String(row[nameColIdx] || '').trim();
    if (!name) continue;

    const priceRes = parseFloat(String(row[priceColIdx] || '0').replace(/[^\d.]/g, ''));
    if (isNaN(priceRes) || priceRes <= 0) continue;

    const priceNonres = priceNonresColIdx !== -1
      ? parseFloat(String(row[priceNonresColIdx] || '0').replace(/[^\d.]/g, ''))
      : priceRes;

    const code = codeColIdx !== -1 ? String(row[codeColIdx] || '').trim() : undefined;

    if (currencyColIdx !== -1 && row[currencyColIdx]) {
      detectedCurrency = String(row[currencyColIdx]).trim();
    }

    items.push({
      service_name_raw: name,
      price_original: priceRes,
      price_nonresident_original: isNaN(priceNonres) ? priceRes : priceNonres,
      service_code_source: code
    });
  }

  let clinicName = fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
  let effectiveDate = new Date().toISOString().split('T')[0];

  for (let r = 0; r < Math.min(headerRowIdx, 10); r++) {
    const row = rows[r];
    if (!row) continue;
    const rowStr = row.join(' ').toLowerCase();

    const dateMatch = rowStr.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
    if (dateMatch) {
      effectiveDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }
  }

  if (headerRowIdx > 1) {
    const headerLines = rows.slice(0, headerRowIdx).map(r => r.join(' ')).join('\n');
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const metaResponse = await callGeminiWithRetry(model, `
Here are the top rows of an Excel price list sheet:
---
${headerLines}
---
And file name: ${fileName}

Identify the Clinic name, City, Address, BIN, Email, Phone, and Effective Date of this price list.
Respond ONLY in this JSON format:
{
  "clinic_name": "Clinic Name",
  "city": "City",
  "address": "Address",
  "bin": "BIN",
  "email": "Email",
  "phone": "Phone",
  "effective_date": "YYYY-MM-DD"
}
`);
      const meta = JSON.parse(metaResponse.response.text().trim().replace(/```json|```/g, ""));
      return {
        clinic_name: meta.clinic_name || clinicName,
        city: meta.city || undefined,
        address: meta.address || undefined,
        bin: meta.bin || undefined,
        email: meta.email || undefined,
        phone: meta.phone || undefined,
        effective_date: meta.effective_date || effectiveDate,
        currency: detectedCurrency,
        raw_content: textContent,
        items
      };
    } catch (e) {
      // Резервный переход
    }
  }

  return {
    clinic_name: clinicName,
    effective_date: effectiveDate,
    currency: detectedCurrency,
    raw_content: textContent,
    items
  };
}

async function parseExcelWithGemini(rows: any[][], fileName: string): Promise<ParsedPriceList> {
  const textContent = rows.slice(0, 500).map(r => r.join('\t')).join('\n');
  return parseTextWithGeminiInChunks(textContent, fileName);
}

function findExcelHeaders(rows: any[][]) {
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
      const val = String(row[c] || '').trim().toLowerCase();
      if (!val) continue;

      if (val.includes('наименование') || val.includes('название') || val.includes('услуга') || val.includes('процедура') || val === 'name' || val === 'service') {
        nameColIdx = c;
        hasName = true;
      }
      if (val.includes('цена') || val.includes('стоимость') || val === 'price' || val === 'rate') {
        if (val.includes('нерезидент') || val.includes('не-резидент') || val.includes('non-resident') || val.includes('nonresident')) {
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

async function parseTextWithGeminiInChunks(text: string, fileName: string): Promise<ParsedPriceList> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  // 1. Извлечь метаданные из первых 2000 символов текста
  const metadataText = text.slice(0, 2000);
  console.log(`[PARSER] Извлечение метаданных из первых 2000 символов для ${fileName}...`);
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
  "effective_date": "YYYY-MM-DD (extract the date the price list becomes effective, or today's date if not specified)",
  "currency": "KZT or USD or RUB (default to KZT)"
}
`
    }
  ]);

  let meta: any = {};
  try {
    const metaClean = parseGeminiResponse(metaResponse.response.text());
    meta = metaClean;
  } catch (e: any) {
    console.warn("[PARSER] Не удалось разобрать JSON метаданных, используются значения по умолчанию:", e.message);
  }

  // Установка значений по умолчанию
  const result: ParsedPriceList = {
    clinic_name: meta.clinic_name || fileName.split('.')[0] || "Нераспознанная клиника",
    city: meta.city || undefined,
    address: meta.address || undefined,
    bin: meta.bin || undefined,
    email: meta.email || undefined,
    phone: meta.phone || undefined,
    effective_date: meta.effective_date || new Date().toISOString().split('T')[0],
    currency: meta.currency || 'KZT',
    items: [],
    raw_content: text
  };

  // 2. Обработка позиций чанками
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const chunkSize = 250; // обрабатывать по 250 строк за раз (оптимизировано под лимиты бесплатного тарифа)
  const numChunks = Math.ceil(lines.length / chunkSize);

  console.log(`[PARSER] Обработка ${lines.length} строк файла ${fileName} в ${numChunks} чанках...`);

  for (let i = 0; i < numChunks; i++) {
    const chunkLines = lines.slice(i * chunkSize, (i + 1) * chunkSize);
    const chunkText = chunkLines.join('\n');

    console.log(`[PARSER] Парсинг чанка ${i + 1}/${numChunks} (${chunkLines.length} строк) для ${fileName}...`);
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
`
        }
      ]);

      const chunkData = parseGeminiResponse(itemResponse.response.text());
      if (chunkData && Array.isArray(chunkData.items)) {
        for (const item of chunkData.items) {
          if (item && item.service_name_raw && typeof item.price_original === 'number') {
            result.items.push({
              service_name_raw: item.service_name_raw,
              price_original: item.price_original,
              price_nonresident_original: typeof item.price_nonresident_original === 'number' ? item.price_nonresident_original : undefined,
              service_code_source: item.service_code_source || undefined
            });
          }
        }
      }
    } catch (chunkErr: any) {
      console.error(`[PARSER] Ошибка разбора чанка ${i + 1} для ${fileName}:`, chunkErr.message);
    }
  }

  console.log(`[PARSER] Завершен чанковый разбор для ${fileName}. Всего извлечено услуг: ${result.items.length}`);
  return result;
}

function parseGeminiResponse(text: string): ParsedPriceList {
  let cleanText = text.trim();
  if (cleanText.includes("```json")) {
    cleanText = cleanText.split("```json")[1].split("```")[0].trim();
  } else if (cleanText.includes("```")) {
    cleanText = cleanText.split("```")[1].split("```")[0].trim();
  }
  return JSON.parse(cleanText) as ParsedPriceList;
}
