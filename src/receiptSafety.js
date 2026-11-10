// Безопасное открытие чеков (аудит безопасности от 03.11.2026, находка 1).
//
// Чек платежа хранится либо файлом в облаке (receipt.path), либо встроенной
// строкой receipt.dataUrl (так их хранила программа на Mac). Строку из базы
// нельзя подставлять в адрес окна: «javascript:…» выполнится внутри сайта и
// прочтёт сессию руководителя. Поэтому открываем только:
//   • встроенный чек — фото или PDF в base64, превращённый в Blob-ссылку;
//   • файл из облака — подписанную ссылку на бакет receipts именно нашего проекта.
// Всё остальное считается повреждённым чеком и не открывается.
// Та же проверка стоит в базе: supabase/006_security_followup.sql, receipts_are_safe().

// Типы файлов чеков — те же, что разрешены бакету receipts. SVG и HTML сюда не входят: в них бывает скрипт.
export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MIME_ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg' };
const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;
const MAX_DATA_URL = 40 * 1024 * 1024;

export class UnsafeReceiptError extends Error {
  constructor(message = 'Чек повреждён или имеет недопустимый формат — открыть его нельзя. Удалите чек и прикрепите заново.') {
    super(message);
    this.name = 'UnsafeReceiptError';
  }
}

const normalMime = (type) => {
  const t = String(type || '').trim().toLowerCase();
  return MIME_ALIASES[t] || t;
};

/** Разбирает встроенный чек. Возвращает { mime, base64 } или null, если это не фото/PDF в base64. */
export function parseReceiptDataUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_DATA_URL) return null;
  const m = DATA_URL_RE.exec(value.replace(/\s+/g, ''));
  if (!m) return null;
  const mime = normalMime(m[1]);
  return RECEIPT_MIME_TYPES.includes(mime) ? { mime, base64: m[2] } : null;
}

export const isSafeReceiptDataUrl = (value) => parseReceiptDataUrl(value) !== null;

/** Путь файла в хранилище: относительный, без «..», «//», «\» и схемы. */
export function isSafeReceiptPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes(':') || value.includes('//')) return false;
  return !value.split('/').some((part) => part === '..' || part === '.');
}

/** Чек целиком: встроенная копия (если есть) — фото/PDF, путь (если есть) — безопасный. */
export function isSafeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (receipt.dataUrl !== undefined && receipt.dataUrl !== null && !isSafeReceiptDataUrl(receipt.dataUrl)) return false;
  if (receipt.path !== undefined && receipt.path !== null && !isSafeReceiptPath(receipt.path)) return false;
  return Boolean(receipt.path || receipt.dataUrl);
}

/** Превращает встроенный чек в Blob-ссылку этого сайта. Бросает UnsafeReceiptError для всего, что не фото/PDF. */
export function receiptBlobUrl(dataUrl) {
  const parsed = parseReceiptDataUrl(dataUrl);
  if (!parsed) throw new UnsafeReceiptError();
  let binary;
  try { binary = atob(parsed.base64); } catch { throw new UnsafeReceiptError(); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: parsed.mime }));
}

const isLocalHost = (host) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

/** Подписанная ссылка на файл из бакета receipts именно нашего проекта Supabase. */
export function isCloudReceiptUrl(value, projectUrl) {
  let url, base;
  try { url = new URL(String(value)); base = new URL(String(projectUrl)); } catch { return false; }
  // http допустим только для локальной проверки (облако на этом же компьютере).
  const httpOk = base.protocol === 'http:' && isLocalHost(base.hostname);
  if (base.protocol !== 'https:' && !httpOk) return false;
  if (url.origin !== base.origin || url.username || url.password) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  return url.pathname.startsWith(`${basePath}/storage/v1/object/sign/receipts/`);
}

/** Последняя проверка перед тем, как подставить адрес в окно: Blob этого сайта или ссылка облака. */
export function isOpenableReceiptHref(href, selfOrigin, projectUrl) {
  let url;
  try { url = new URL(String(href)); } catch { return false; }
  if (url.protocol === 'blob:') return Boolean(selfOrigin) && String(href).startsWith(`blob:${selfOrigin}/`);
  return isCloudReceiptUrl(href, projectUrl);
}
