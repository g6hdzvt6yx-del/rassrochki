// Раздел «Расходы»: кассы и счета, категории, операции. Хранение — Supabase
// (supabase/006_expenses.sql); остатки касс/счетов пересчитывает база.

export const BUILTIN_CATEGORIES = [
  { id: 'purchase', name: 'Закуп', hint: 'Оплата товаров и материалов' },
  { id: 'salary', name: 'Зарплата', hint: 'Выплаты сотрудникам' },
  { id: 'collection', name: 'Инкассация', hint: 'Изъятие денег из кассы' },
  { id: 'other', name: 'Прочее', hint: 'Другие расходы' },
];
export const ACCOUNT_KINDS = { cash: 'Касса', bank: 'Счёт' };

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => clean(value).toLocaleLowerCase('ru');

export const allCategories = (custom = []) => [
  ...BUILTIN_CATEGORIES,
  ...custom.map((c) => ({ id: c.id, name: c.name, custom: true })),
];
export const categoryName = (id, custom = []) =>
  allCategories(custom).find((c) => c.id === id)?.name || 'Категория удалена';

// Перемещение — деньги остались внутри программы: из одной кассы/счёта в другую.
export const isTransfer = (e) => Boolean(e.toAccountId);
// Инкассация уменьшает кассу, но расходом для прибыли не является; перемещение — тоже.
export const countsForProfit = (e) => e.category !== 'collection' && !isTransfer(e);

/* --------------------------- Даты --------------------------- */

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const localTime = (value) => {
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// «2026-10-28» + «14:05» в часовом поясе устройства → ISO для timestamptz
export function combineDateTime(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Укажите дату операции.');
  if (!/^\d{2}:\d{2}$/.test(time || '')) throw new Error('Укажите время операции.');
  const d = new Date(`${day}T${time}:00`);
  if (Number.isNaN(d.getTime()) || localDay(d) !== day) throw new Error('Некорректная дата операции.');
  return d.toISOString();
}

// Быстрые периоды фильтра: с какой по какую дату (включительно).
export function periodRange(preset, now = new Date()) {
  const today = localDay(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { from: localDay(d), to: today };
  }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'prevMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: localDay(first), to: localDay(last) };
  }
  return { from: '', to: '' };
}

/* --------------------------- Проверка формы --------------------------- */

export function parseAmount(raw) {
  const n = Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new Error('Укажите сумму больше нуля.');
  if (n >= 1e9) throw new Error('Слишком большая сумма.');
  return Math.round(n * 100) / 100;
}

// Значения формы → поля строки expenses. Бросает ошибку с понятным текстом.
export function validateExpense(f, { accounts = [], categories = [] } = {}) {
  const amount = parseAmount(f.amount);
  if (!allCategories(categories).some((c) => c.id === f.category)) throw new Error('Выберите категорию.');
  const from = accounts.find((a) => a.id === f.accountId);
  if (!from) throw new Error('Выберите, откуда списать деньги: кассу или счёт.');
  const transfer = f.category === 'collection' && f.target === 'internal';
  let toAccountId = null;
  if (transfer) {
    const to = accounts.find((a) => a.id === f.toAccountId);
    if (!to) throw new Error('Выберите кассу или счёт, куда переводятся деньги.');
    if (to.id === from.id) throw new Error('Нельзя переводить в ту же кассу или счёт.');
    toAccountId = to.id;
  }
  const recipient = clean(f.recipient);
  if (!transfer && f.category === 'collection' && !recipient) throw new Error('Для инкассации укажите получателя или место перевода.');
  if (recipient.length > 200) throw new Error('Получатель — не длиннее 200 символов.');
  const comment = String(f.comment ?? '').trim();
  if (comment.length > 2000) throw new Error('Комментарий — не длиннее 2000 символов.');
  return {
    amount, category: f.category, occurred_at: combineDateTime(f.day, f.time),
    account_id: from.id, to_account_id: toAccountId, recipient, comment,
  };
}

/* --------------------------- Строки БД --------------------------- */

export const expenseFromRow = (r) => ({
  id: r.id, amount: Number(r.amount) || 0, category: r.category, occurredAt: r.occurred_at,
  accountId: r.account_id, toAccountId: r.to_account_id || null, recipient: r.recipient || '',
  comment: r.comment || '', receipt: r.receipt || null,
  createdByName: r.created_by_name || '', createdAt: r.created_at,
  updatedByName: r.updated_by_name || '', updatedAt: r.updated_at || null,
});
export const accountFromRow = (r) => ({
  id: r.id, name: r.name, kind: r.kind, balance: Number(r.balance) || 0, archived: Boolean(r.archived),
});
export const categoryFromRow = (r) => ({ id: r.id, name: r.name });

/* --------------------------- Фильтры и итоги --------------------------- */

export function filterExpenses(list, { from = '', to = '', category = '', recipient = '', accountId = '', query = '' } = {}, ctx = {}) {
  const q = norm(query);
  const qDigits = q.replace(/[^\d]/g, '');
  return list.filter((e) => {
    const day = localDay(e.occurredAt);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (category === 'transfer') { if (!isTransfer(e)) return false; }
    else if (category && e.category !== category) return false;
    if (recipient && norm(e.recipient) !== norm(recipient)) return false;
    if (accountId && e.accountId !== accountId && e.toAccountId !== accountId) return false;
    if (!q) return true;
    const text = norm([
      e.recipient, e.comment, e.createdByName, categoryName(e.category, ctx.categories),
      ctx.accountName?.(e.accountId), ctx.accountName?.(e.toAccountId),
    ].filter(Boolean).join(' '));
    return text.includes(q) || (qDigits.length > 0 && String(e.amount).includes(qDigits));
  });
}

// Итоги периода: всё списанное, расходы для прибыли, инкассация, перемещения и разбивка.
export function summarizeExpenses(list, categories = []) {
  const byCategory = new Map();
  let outflow = 0, profitExpenses = 0, collection = 0, transfers = 0;
  for (const e of list) {
    if (isTransfer(e)) { transfers += e.amount; continue; }
    outflow += e.amount;
    if (e.category === 'collection') collection += e.amount;
    else profitExpenses += e.amount;
    const row = byCategory.get(e.category) || { id: e.category, name: categoryName(e.category, categories), total: 0, count: 0, forProfit: countsForProfit(e) };
    row.total += e.amount; row.count += 1;
    byCategory.set(e.category, row);
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    outflow: round(outflow), profitExpenses: round(profitExpenses), collection: round(collection), transfers: round(transfers),
    byCategory: [...byCategory.values()].map((r) => ({ ...r, total: round(r.total) })).sort((a, b) => b.total - a.total),
  };
}

// Как изменятся остатки после сохранения формы — для подсказки до записи в базу.
export function balanceAfter(accounts, previous, next) {
  const delta = new Map();
  const add = (id, v) => { if (id) delta.set(id, (delta.get(id) || 0) + v); };
  if (previous) { add(previous.accountId, previous.amount); add(previous.toAccountId, -previous.amount); }
  if (next) { add(next.account_id, -next.amount); add(next.to_account_id, next.amount); }
  return Object.fromEntries(accounts.map((a) => [a.id, Math.round((a.balance + (delta.get(a.id) || 0)) * 100) / 100]));
}

export const recentRecipients = (list) => {
  const seen = new Map();
  for (const e of [...list].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))) {
    const name = clean(e.recipient);
    if (name && !seen.has(norm(name))) seen.set(norm(name), name);
  }
  return [...seen.values()];
};

/* --------------------------- Облако (Supabase) --------------------------- */

const newId = (prefix) => `${prefix}${crypto.randomUUID()}`;
const fail = (error, fallback) => { throw new Error(error?.message || fallback); };

export async function loadExpenseData(db) {
  const [accounts, categories, expenses] = await Promise.all([
    db.from('money_accounts').select('*').order('created_at', { ascending: true }),
    db.from('expense_categories').select('*').order('created_at', { ascending: true }),
    db.from('expenses').select('*').order('occurred_at', { ascending: false }).limit(10000),
  ]);
  const error = accounts.error || categories.error || expenses.error;
  if (error) fail(error, 'Не удалось загрузить расходы.');
  return {
    accounts: (accounts.data || []).map(accountFromRow),
    categories: (categories.data || []).map(categoryFromRow),
    expenses: (expenses.data || []).map(expenseFromRow),
  };
}

export async function reloadAccounts(db) {
  const { data, error } = await db.from('money_accounts').select('*').order('created_at', { ascending: true });
  if (error) fail(error, 'Не удалось обновить остатки.');
  return (data || []).map(accountFromRow);
}

export async function saveExpense(db, id, row) {
  const query = id
    ? db.from('expenses').update(row).eq('id', id)
    : db.from('expenses').insert({ id: newId('e'), ...row });
  const { data, error } = await query.select('*');
  if (error) fail(error, 'Не удалось сохранить операцию.');
  if (!data?.length) throw new Error('Операция не найдена или недоступна. Обновите страницу.');
  return expenseFromRow(data[0]);
}

export async function deleteExpense(db, expense) {
  const { error } = await db.from('expenses').delete().eq('id', expense.id);
  if (error) fail(error, 'Не удалось удалить операцию.');
  if (expense.receipt?.path) await db.storage.from(RECEIPT_BUCKET).remove([expense.receipt.path]);
}

export async function saveAccount(db, account, values) {
  const name = clean(values.name);
  if (!name) throw new Error('Укажите название кассы или счёта.');
  if (name.length > 100) throw new Error('Название — не длиннее 100 символов.');
  if (!ACCOUNT_KINDS[values.kind]) throw new Error('Выберите: касса или счёт.');
  const row = { name, kind: values.kind };
  if (values.balance !== undefined && values.balance !== '') {
    const n = Number(String(values.balance).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error('Остаток укажите числом.');
    row.balance = Math.round(n * 100) / 100;
  }
  if (values.archived !== undefined) row.archived = Boolean(values.archived);
  const query = account
    ? db.from('money_accounts').update(row).eq('id', account.id)
    : db.from('money_accounts').insert({ id: newId('m'), ...row });
  const { data, error } = await query.select('*');
  if (error) fail(error, 'Не удалось сохранить кассу или счёт.');
  if (!data?.length) throw new Error('Касса или счёт не найдены. Обновите страницу.');
  return accountFromRow(data[0]);
}

export async function deleteAccount(db, id) {
  const { error } = await db.from('money_accounts').delete().eq('id', id);
  if (error) {
    if (/foreign key|violates/i.test(error.message || '')) throw new Error('По этой кассе или счёту есть операции — её можно только скрыть в архив.');
    fail(error, 'Не удалось удалить кассу или счёт.');
  }
}

export async function addCategory(db, name, existing = []) {
  const value = clean(name);
  if (!value) throw new Error('Укажите название категории.');
  if (value.length > 60) throw new Error('Название — не длиннее 60 символов.');
  if (allCategories(existing).some((c) => norm(c.name) === norm(value))) throw new Error('Такая категория уже есть.');
  const { data, error } = await db.from('expense_categories').insert({ id: newId('k'), name: value }).select('*');
  if (error) fail(error, 'Не удалось добавить категорию.');
  return categoryFromRow(data[0]);
}

export async function removeCategory(db, id) {
  const { error } = await db.from('expense_categories').delete().eq('id', id);
  if (error) fail(error, 'Не удалось удалить категорию.');
}

/* --------------------------- Чеки --------------------------- */

export const RECEIPT_BUCKET = 'expense-receipts';
const RECEIPT_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

export function expenseReceiptPath(ownerId, expenseId, fileName, now = Date.now()) {
  const ext = String(fileName || '').includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
  const safeExt = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '';
  return `${ownerId}/${expenseId}-${now}${safeExt}`;
}

export function checkReceiptFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) throw new Error('Файл чека больше 10 МБ.');
  if (file.type && !RECEIPT_TYPES.test(file.type)) throw new Error('Чек — фото (JPG, PNG, HEIC) или PDF.');
}

// Загружает файл и привязывает его к операции; старый файл удаляется после успешной привязки.
export async function attachExpenseReceipt(db, ownerId, expense, file) {
  checkReceiptFile(file);
  const path = expenseReceiptPath(ownerId, expense.id, file.name);
  const { error: uploadError } = await db.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) fail(uploadError, 'Не удалось загрузить чек.');
  const receipt = { name: file.name || 'чек', type: file.type || '', path };
  const { data, error } = await db.from('expenses').update({ receipt }).eq('id', expense.id).select('*');
  if (error || !data?.length) {
    await db.storage.from(RECEIPT_BUCKET).remove([path]);
    fail(error, 'Не удалось привязать чек к операции.');
  }
  if (expense.receipt?.path && expense.receipt.path !== path) await db.storage.from(RECEIPT_BUCKET).remove([expense.receipt.path]);
  return expenseFromRow(data[0]);
}

export async function detachExpenseReceipt(db, expense) {
  const { data, error } = await db.from('expenses').update({ receipt: null }).eq('id', expense.id).select('*');
  if (error || !data?.length) fail(error, 'Не удалось убрать чек.');
  if (expense.receipt?.path) await db.storage.from(RECEIPT_BUCKET).remove([expense.receipt.path]);
  return expenseFromRow(data[0]);
}

export async function receiptUrl(db, receipt) {
  const { data, error } = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(receipt.path, 120);
  if (error || !data?.signedUrl) fail(error, 'Не удалось открыть чек.');
  return data.signedUrl;
}
