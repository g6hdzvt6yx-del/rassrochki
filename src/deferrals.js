const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function changeDeferral(record = {}, scheduledDate, { mode = 'add', date, reason = '', now = new Date().toISOString() }) {
  const next = { ...record };
  const history = Array.isArray(record.deferralHistory) ? record.deferralHistory.map((entry) => ({ ...entry })) : [];
  if (!history.length && record.deferredUntil) history.push({
    fromDate: scheduledDate, toDate: record.deferredUntil, reason: record.deferralReason || '', createdAt: null,
  });
  if (!['add', 'edit', 'cancel'].includes(mode)) throw new Error('Неизвестное действие с отсрочкой');
  if (mode !== 'add' && !history.length) throw new Error('У платежа нет отсрочки');
  if (mode === 'cancel') history.pop();
  else {
    const previous = mode === 'edit' ? history.at(-1).fromDate : history.at(-1)?.toDate || scheduledDate;
    if (!validDate(date)) throw new Error('Укажите существующую дату отсрочки');
    if (date <= previous) throw new Error(`Дата отсрочки должна быть позже ${previous.split('-').reverse().join('.')}`);
    const entry = { fromDate: previous, toDate: date, reason: reason.trim() };
    if (mode === 'edit') history[history.length - 1] = { ...history.at(-1), ...entry, updatedAt: now };
    else history.push({ ...entry, createdAt: now });
  }
  if (history.length) {
    next.deferralHistory = history;
    next.deferredUntil = history.at(-1).toDate;
    next.deferralReason = history.at(-1).reason || '';
  } else {
    delete next.deferralHistory; delete next.deferredUntil; delete next.deferralReason;
  }
  return next;
}
