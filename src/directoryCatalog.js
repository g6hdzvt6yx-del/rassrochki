import { normalizePhone, formatPhone } from './phone';
import { PASSPORT_FIELDS, normalizePassport, passportOf } from './passport';
import { directoryClients, directoryProducts } from './directories';

// Справочники хранятся в таблице directory_items: kind — вид справочника, data — поля записи.
// Описание полей ниже задаёт и форму, и проверку, и колонки списка.
export const DIRECTORY_KINDS = [
  { kind: 'products', title: 'Товары', one: 'товар', fields: [
    { key: 'name', label: 'Название', required: true },
    { key: 'categoryId', label: 'Категория', type: 'ref', ref: 'categories' },
    { key: 'purchasePrice', label: 'Закупочная цена, ₽', type: 'money' },
    { key: 'salePrice', label: 'Продажная цена, ₽', type: 'money' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'clients', title: 'Клиенты', one: 'клиента', fields: [
    { key: 'name', label: 'ФИО', required: true },
    { key: 'phone', label: 'Телефон', type: 'tel' },
    { key: 'address', label: 'Адрес проживания' },
    { key: 'responsibleId', label: 'Ответственный сотрудник', type: 'ref', ref: 'employees' },
    { key: 'passport', label: 'Паспортные данные', type: 'passport' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'accounts', title: 'Карты и счета', one: 'карту или счёт', fields: [
    { key: 'name', label: 'Название', required: true, placeholder: 'Например: Сбер — основная' },
    { key: 'type', label: 'Тип', type: 'select', options: [['card', 'Карта'], ['account', 'Счёт']] },
    { key: 'bank', label: 'Банк' },
    { key: 'owner', label: 'Владелец' },
    { key: 'last4', label: 'Последние 4 цифры', type: 'last4' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'cashboxes', title: 'Кассы', one: 'кассу', fields: [
    { key: 'name', label: 'Название', required: true, placeholder: 'Например: Магазин на Ленина' },
    { key: 'location', label: 'Где находится' },
    { key: 'responsibleId', label: 'Ответственный', type: 'ref', ref: 'employees' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'employees', title: 'Сотрудники', one: 'сотрудника', fields: [
    { key: 'name', label: 'ФИО', required: true },
    { key: 'role', label: 'Должность', type: 'select', options: [['seller', 'Продавец'], ['manager', 'Менеджер'], ['responsible', 'Ответственный за клиентов'], ['other', 'Другое']] },
    { key: 'phone', label: 'Телефон', type: 'tel' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'categories', title: 'Категории товаров', one: 'категорию', fields: [
    { key: 'name', label: 'Название', required: true },
  ] },
  { kind: 'articles', title: 'Статьи доходов и расходов', one: 'статью', fields: [
    { key: 'name', label: 'Название', required: true },
    { key: 'type', label: 'Вид', type: 'select', required: true, options: [['income', 'Доход'], ['expense', 'Расход']] },
  ] },
  { kind: 'guarantors', title: 'Поручители', one: 'поручителя', fields: [
    { key: 'name', label: 'ФИО', required: true },
    { key: 'phone', label: 'Телефон', type: 'tel' },
    { key: 'clientId', label: 'За какого клиента', type: 'ref', ref: 'clients' },
    { key: 'relation', label: 'Кем приходится клиенту', placeholder: 'Брат, сосед, коллега…' },
    { key: 'note', label: 'Примечание', type: 'textarea' },
  ] },
  { kind: 'payment_methods', title: 'Способы оплаты', one: 'способ оплаты', fields: [
    { key: 'name', label: 'Название', required: true },
    { key: 'method', label: 'Вид', type: 'select', required: true, options: [['cash', 'Наличные'], ['bank', 'Перевод / безнал']] },
  ] },
];

export const kindInfo = (kind) => DIRECTORY_KINDS.find((k) => k.kind === kind);

// Стандартные записи, которые можно добавить одной кнопкой в пустой справочник.
export const DIRECTORY_DEFAULTS = {
  categories: ['Телефоны', 'Техника', 'Мебель', 'Прочее'].map((name) => ({ name })),
  articles: [
    { name: 'Продажи', type: 'income' }, { name: 'Закупки', type: 'expense' }, { name: 'Аренда', type: 'expense' },
    { name: 'Зарплата', type: 'expense' }, { name: 'Доставка', type: 'expense' },
  ],
  payment_methods: [{ name: 'Наличные', method: 'cash' }, { name: 'Перевод', method: 'bank' }],
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => clean(value).toLocaleLowerCase('ru');

// Проверяет и очищает поля записи. Бросает ошибку с понятным текстом.
export function validateDirectoryData(kind, values) {
  const info = kindInfo(kind);
  if (!info) throw new Error('Неизвестный справочник.');
  const data = {};
  for (const field of info.fields) {
    const raw = values?.[field.key];
    if (field.type === 'passport') {
      const passport = normalizePassport(raw);
      if (passport) data.passport = passport;
      continue;
    }
    const text = field.type === 'textarea' ? String(raw ?? '').trim() : clean(raw);
    if (!text) {
      if (field.required) throw new Error(`Заполните поле «${field.label}».`);
      continue;
    }
    if (field.type === 'money') {
      const n = Number(text.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw new Error(`«${field.label}»: укажите сумму числом.`);
      data[field.key] = Math.round(n * 100) / 100;
    } else if (field.type === 'tel') {
      if (!normalizePhone(text)) throw new Error(`«${field.label}»: укажите российский номер или оставьте поле пустым.`);
      data[field.key] = formatPhone(text);
    } else if (field.type === 'last4') {
      if (!/^\d{4}$/.test(text)) throw new Error('Последние цифры карты — ровно 4 цифры.');
      data[field.key] = text;
    } else if (field.type === 'select') {
      if (!field.options.some(([v]) => v === text)) throw new Error(`«${field.label}»: выберите значение из списка.`);
      data[field.key] = text;
    } else {
      data[field.key] = text;
    }
  }
  return data;
}

// Запись с тем же названием (и телефоном, если он есть) уже в справочнике.
export function findDuplicate(items, kind, data, exceptId) {
  return items.find((item) => item.kind === kind && item.id !== exceptId && (
    data.phone && item.data.phone
      ? normalizePhone(item.data.phone) === normalizePhone(data.phone) && norm(item.data.name) === norm(data.name)
      : norm(item.data.name) === norm(data.name)
  )) || null;
}

// Подпись записи: «Сбер — основная · •• 1234», «Иванов И. · 8-999-…».
export function itemLabel(item) {
  if (!item) return '';
  const d = item.data || {};
  if (item.kind === 'accounts') return [d.name, d.last4 && `•• ${d.last4}`].filter(Boolean).join(' · ');
  return d.name || '';
}

// Строка для подсказок «Карта поступления» при оплате: банк · владелец · последние цифры.
export const accountCardLabel = (item) => {
  const d = item.data || {};
  return [d.bank || d.name, d.owner, d.last4].filter(Boolean).join(' · ');
};

// Где используется запись: товары категории, поручители клиента и т. п.
export function itemReferences(items, target) {
  const refs = [];
  for (const info of DIRECTORY_KINDS) {
    for (const field of info.fields.filter((f) => f.type === 'ref' && f.ref === target.kind)) {
      items.filter((i) => i.kind === info.kind && i.data[field.key] === target.id).forEach((i) => refs.push(i));
    }
  }
  return refs;
}

// Записи, которые можно перенести из уже введённых договоров (без дублей).
export function candidatesFromContracts(kind, contracts, items) {
  const existing = items.filter((i) => i.kind === kind);
  const has = (data) => Boolean(findDuplicate(existing, kind, data));
  const result = [];
  const queued = () => result.map((data) => ({ id: '', kind, data }));
  const push = (data) => { if (data.name && !has(data) && !findDuplicate(queued(), kind, data)) result.push(data); };
  if (kind === 'clients') {
    for (const group of directoryClients(contracts)) {
      const data = { name: clean(group.name), phone: normalizePhone(group.phone) ? formatPhone(group.phone) : '' };
      const passport = group.contracts.map(passportOf).find(Boolean);
      if (passport) {
        data.passport = passport;
        if (passport.address) data.address = passport.address;
      }
      if (!data.phone) delete data.phone;
      push(data);
    }
  } else if (kind === 'products') {
    for (const group of directoryProducts(contracts)) {
      const latest = group.contracts.find((c) => +c.totalPrice > 0);
      push({ name: clean(group.name), ...(latest ? { salePrice: +latest.totalPrice } : {}) });
    }
  } else if (kind === 'guarantors') {
    const clients = items.filter((i) => i.kind === 'clients');
    for (const c of contracts) {
      const name = clean(c.guarantorName);
      if (!name) continue;
      const data = { name };
      if (normalizePhone(c.guarantorPhone)) data.phone = formatPhone(c.guarantorPhone);
      const client = clients.find((i) => (normalizePhone(c.phone) && normalizePhone(i.data.phone) === normalizePhone(c.phone))
        || norm(i.data.name) === norm(c.clientName));
      if (client) data.clientId = client.id;
      push(data);
    }
  }
  return result;
}

export const newDirectoryId = () => `d${crypto.randomUUID()}`;

/* --------------------------- Облако (Supabase) --------------------------- */

const rowToItem = (row) => ({ id: row.id, kind: row.kind, data: row.data || {}, updatedAt: row.updated_at });

export async function listDirectoryItems(db) {
  const { data, error } = await db.from('directory_items').select('id,kind,data,updated_at').order('created_at', { ascending: true });
  if (error) throw new Error(error.message || 'Не удалось загрузить справочники.');
  return (data || []).map(rowToItem);
}

export async function insertDirectoryItems(db, kind, list) {
  if (!list.length) return [];
  const rows = list.map((data) => ({ id: newDirectoryId(), kind, data: validateDirectoryData(kind, data) }));
  const { data, error } = await db.from('directory_items').insert(rows).select('id,kind,data,updated_at');
  if (error) throw new Error(error.message || 'Не удалось сохранить запись.');
  return (data || []).map(rowToItem);
}

export async function updateDirectoryItem(db, item, values) {
  const data = validateDirectoryData(item.kind, values);
  const { data: saved, error } = await db.from('directory_items')
    .update({ data, updated_at: new Date().toISOString() }).eq('id', item.id).select('id,kind,data,updated_at');
  if (error) throw new Error(error.message || 'Не удалось сохранить запись.');
  if (!saved || !saved.length) throw new Error('Запись не найдена или недоступна. Обновите страницу.');
  return rowToItem(saved[0]);
}

export async function deleteDirectoryItem(db, id) {
  const { error } = await db.from('directory_items').delete().eq('id', id);
  if (error) throw new Error(error.message || 'Не удалось удалить запись.');
}

export { PASSPORT_FIELDS };
