import path from 'path';
import crypto from 'crypto';

export const SUPPORTED_PRICE_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'scan_pdf']);

export function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName || '');
  const normalized = baseName.normalize('NFKC');
  const cleaned = normalized
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'upload.bin';
}

export function buildStoredFileName(fileName: string, prefix?: string) {
  const safeBase = sanitizeFileName(fileName).replace(/\s+/g, '_');
  const scope = prefix || crypto.randomUUID();
  return `${scope}_${safeBase}`;
}

export function getFileExtension(fileName: string) {
  return path.extname(sanitizeFileName(fileName)).toLowerCase().replace('.', '');
}

export function isSupportedPriceFile(fileName: string) {
  return SUPPORTED_PRICE_EXTENSIONS.has(getFileExtension(fileName));
}

export function isUuidLike(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

