// Чеки платежа: новый формат — массив payment.receipts, старый — одиночный payment.receipt.
// Читаем оба, пишем только массив.
export function receiptsOf(record) {
  if (!record || typeof record !== 'object') return [];
  const list = Array.isArray(record.receipts) ? record.receipts.filter((r) => r && (r.path || r.dataUrl)) : [];
  const legacy = record.receipt;
  if (legacy && (legacy.path || legacy.dataUrl) && !list.some((r) => sameReceipt(r, legacy))) return [legacy, ...list];
  return list;
}

const sameReceipt = (a, b) => (a.path && a.path === b.path) || (!a.path && a.dataUrl && a.dataUrl === b.dataUrl);

export function withAddedReceipts(record, added) {
  const { receipt: _legacy, ...rest } = record || {};
  return { ...rest, receipts: [...receiptsOf(record), ...added] };
}

// Убирает один чек (по пути, а для старых встроенных — по позиции в списке).
export function withoutReceipt(record, target) {
  const list = receiptsOf(record);
  const index = list.findIndex((r) => sameReceipt(r, target));
  if (index < 0) return { record, removed: null };
  const removed = list[index];
  const remaining = list.filter((_, i) => i !== index);
  const { receipt: _legacy, receipts: _list, ...rest } = record;
  const next = remaining.length ? { ...rest, receipts: remaining } : rest;
  return { record: Object.keys(next).length ? next : null, removed };
}

export function receiptStoragePath(cid, idx, fileName, order = 0, now = Date.now()) {
  const ext = String(fileName || '').includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
  const safeExt = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '';
  return `${cid}/${idx}-${now}${order ? `-${order}` : ''}${safeExt}`;
}
