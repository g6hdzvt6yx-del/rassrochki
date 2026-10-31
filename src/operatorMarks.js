import { callResults } from './access';

// Отметки оператора собираются из уже существующих источников, без отдельной таблицы:
//  • call_log — результаты звонков операторов (статус, автор actor_id, время created_at);
//  • payments.__contacts — записи «История контактов», которые добавляют в карточке договора.
// Обе истории только дополняются: новая отметка не заменяет предыдущие.

export const CONTACT_TYPE_LABELS = {
  call: 'Звонок', whatsapp: 'WhatsApp', meeting: 'Встреча', other: 'Другое',
};

// Ключ автора для старых записей «Истории контактов», где автор не сохранялся.
export const LEGACY_ADMIN_AUTHOR = '__admin';
const LEGACY_ADMIN_NAME = 'Администратор';

// Варианты фильтра «Отметки оператора». Пустой выбор = «Все».
export const MARK_FILTER_OPTIONS = [
  ['has', 'Есть отметки'],
  ['none', 'Нет отметок'],
  ['promised', 'Обещал оплатить'],
  ['no_answer', 'Не отвечает'],
  ['callback', 'Перезвонить'],
  ['refused', 'Отказ от оплаты'],
  ['other', 'Другие отметки'],
];
const STATUS_CATEGORIES = new Set(['promised', 'no_answer', 'callback', 'refused']);

export const MARK_TONE = {
  informed: 'ok', promised: 'ok', reported_paid: 'warn', callback: 'warn',
  no_answer: 'bad', wrong_number: 'bad', help: 'bad', refused: 'bad',
};

// Категория для фильтра: четыре основных статуса, всё остальное — «Другие отметки».
export function markCategory(result) {
  return STATUS_CATEGORIES.has(result) ? result : 'other';
}

// Статус записи «Истории контактов». Новые записи хранят его явно (поле result),
// у старых он выводится из уже заполненных полей обещания и следующего контакта.
export function contactResult(contact) {
  if (contact?.result && callResults[contact.result]) return contact.result;
  if (contact?.promisedDate || +contact?.promisedAmount > 0) return 'promised';
  if (contact?.nextContactDate) return 'callback';
  return '';
}

export function markLabel(mark) {
  if (mark.result && callResults[mark.result]) return callResults[mark.result];
  return mark.typeLabel || 'Отметка';
}

const byNewest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));

export function marksFromCallLog(log, people = {}) {
  return {
    id: 'operator:' + log.id, source: 'operator', result: log.result || '',
    note: log.note || '', at: log.created_at || '',
    authorKey: log.actor_id || '', authorName: people[log.actor_id] || 'Оператор',
    promisedDate: log.promised_date || '', promisedAmount: +log.promised_amount || 0,
    nextContactAt: log.next_contact_at || '', typeLabel: 'Звонок',
  };
}

export function marksFromContact(contact, people = {}) {
  const authorKey = contact.authorId || LEGACY_ADMIN_AUTHOR;
  return {
    id: contact.id, source: 'admin', result: contactResult(contact),
    note: contact.note || '', at: contact.occurredAt || '',
    authorKey, authorName: contact.authorName || people[contact.authorId] || LEGACY_ADMIN_NAME,
    promisedDate: contact.promisedDate || '', promisedAmount: +contact.promisedAmount || 0,
    nextContactAt: contact.nextContactDate || '', typeLabel: CONTACT_TYPE_LABELS[contact.type] || 'Контакт',
  };
}

// { [contractId]: marks[] } — все отметки договора, самые свежие первыми.
export function marksByContract(contracts = [], callLogs = [], people = {}) {
  const logsByContract = new Map();
  for (const log of callLogs) {
    if (!log?.contract_id) continue;
    if (!logsByContract.has(log.contract_id)) logsByContract.set(log.contract_id, []);
    logsByContract.get(log.contract_id).push(log);
  }
  const result = {};
  for (const contract of contracts) {
    const contacts = Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : [];
    result[contract.id] = [
      ...contacts.filter(Boolean).map((contact) => marksFromContact(contact, people)),
      ...(logsByContract.get(contract.id) || []).map((log) => marksFromCallLog(log, people)),
    ].sort(byNewest);
  }
  return result;
}

// Список авторов для фильтра по сотруднику: [{ key, name, count }], по алфавиту.
export function markAuthors(marksMap = {}) {
  const authors = new Map();
  for (const marks of Object.values(marksMap)) {
    for (const mark of marks) {
      if (!mark.authorKey) continue;
      const item = authors.get(mark.authorKey) || { key: mark.authorKey, name: mark.authorName, count: 0 };
      item.count += 1;
      authors.set(mark.authorKey, item);
    }
  }
  return [...authors.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// statuses — выбранные варианты MARK_FILTER_OPTIONS (несколько сразу, объединяются по «ИЛИ»);
// author — 'all' или ключ сотрудника. Если сотрудник выбран, статус берётся из его последней отметки.
export function matchesMarkFilter(marks = [], { statuses = [], author = 'all' } = {}) {
  const scoped = author && author !== 'all' ? marks.filter((mark) => mark.authorKey === author) : marks;
  if (!statuses.length) return author && author !== 'all' ? scoped.length > 0 : true;
  const latest = scoped[0];
  return statuses.some((status) => {
    if (status === 'has') return Boolean(latest);
    if (status === 'none') return !latest;
    return Boolean(latest) && markCategory(latest.result) === status;
  });
}

export function toggleMarkStatus(statuses = [], status) {
  if (status === 'all') return [];
  return statuses.includes(status) ? statuses.filter((item) => item !== status) : [...statuses, status];
}
