import { describe, it, expect, vi } from 'vitest';
import {
  validateExpense, combineDateTime, periodRange, filterExpenses, summarizeExpenses, balanceAfter,
  countsForProfit, isTransfer, categoryName, recentRecipients, parseAmount, expenseReceiptPath,
  checkReceiptFile, addCategory, saveExpense, deleteAccount, localDay,
} from './expenses';

const accounts = [
  { id: 'cash', name: 'Касса', kind: 'cash', balance: 10000 },
  { id: 'bank', name: 'Сбер', kind: 'bank', balance: 50000 },
];
const form = (over = {}) => ({ amount: '1 500,5', category: 'purchase', day: '2026-10-28', time: '14:05', accountId: 'cash', target: 'external', toAccountId: '', recipient: '  ООО  Поставщик ', comment: ' партия ', ...over });
const op = (over) => ({ id: Math.random().toString(36), amount: 100, category: 'other', occurredAt: '2026-10-10T09:00:00', accountId: 'cash', toAccountId: null, recipient: '', comment: '', ...over });

describe('форма расхода', () => {
  it('очищает поля и переводит дату и время в ISO', () => {
    const row = validateExpense(form(), { accounts });
    expect(row).toMatchObject({ amount: 1500.5, category: 'purchase', account_id: 'cash', to_account_id: null, recipient: 'ООО Поставщик', comment: 'партия' });
    expect(new Date(row.occurred_at).getHours()).toBe(14);
    expect(localDay(row.occurred_at)).toBe('2026-10-28');
  });
  it('требует сумму, категорию и источник', () => {
    expect(() => validateExpense(form({ amount: '0' }), { accounts })).toThrow('больше нуля');
    expect(() => validateExpense(form({ amount: 'abc' }), { accounts })).toThrow('больше нуля');
    expect(() => validateExpense(form({ category: 'gift' }), { accounts })).toThrow('категорию');
    expect(() => validateExpense(form({ accountId: '' }), { accounts })).toThrow('откуда списать');
    expect(() => validateExpense(form({ time: '' }), { accounts })).toThrow('время');
    expect(() => combineDateTime('2026-02-30', '10:00')).toThrow('Некорректная');
  });
  it('принимает свою категорию', () => {
    expect(validateExpense(form({ category: 'k1' }), { accounts, categories: [{ id: 'k1', name: 'Аренда' }] }).category).toBe('k1');
    expect(categoryName('k1', [{ id: 'k1', name: 'Аренда' }])).toBe('Аренда');
    expect(categoryName('salary')).toBe('Зарплата');
  });
  it('инкассация требует получателя, а перевод в свою кассу — счёт зачисления', () => {
    expect(() => validateExpense(form({ category: 'collection', recipient: ' ' }), { accounts })).toThrow('получателя');
    expect(() => validateExpense(form({ category: 'collection', target: 'internal' }), { accounts })).toThrow('куда переводятся');
    expect(() => validateExpense(form({ category: 'collection', target: 'internal', toAccountId: 'cash' }), { accounts })).toThrow('ту же');
    const row = validateExpense(form({ category: 'collection', target: 'internal', toAccountId: 'bank', recipient: 'забыть' }), { accounts });
    expect(row).toMatchObject({ to_account_id: 'bank' });
  });
  it('для обычного расхода не создаёт перемещение, даже если оно было выбрано', () => {
    expect(validateExpense(form({ category: 'other', target: 'internal', toAccountId: 'bank' }), { accounts }).to_account_id).toBe(null);
  });
  it('разбирает сумму с пробелами и запятой', () => {
    expect(parseAmount('12 000,456')).toBe(12000.46);
  });
});

describe('прибыль, итоги и фильтры', () => {
  const list = [
    op({ category: 'purchase', amount: 3000, recipient: 'Поставщик', occurredAt: '2026-10-05T10:00:00' }),
    op({ category: 'salary', amount: 2000, recipient: 'Анна', occurredAt: '2026-10-06T10:00:00' }),
    op({ category: 'collection', amount: 5000, recipient: 'Владелец', occurredAt: '2026-10-07T10:00:00' }),
    op({ category: 'collection', amount: 4000, toAccountId: 'bank', occurredAt: '2026-10-08T10:00:00' }),
    op({ category: 'k1', amount: 700, recipient: 'Анна', comment: 'аренда склада', occurredAt: '2026-09-30T23:00:00' }),
  ];
  it('инкассация и перемещение не уменьшают прибыль', () => {
    expect(list.map(countsForProfit)).toEqual([true, true, false, false, true]);
    expect(isTransfer(list[3])).toBe(true);
    const s = summarizeExpenses(list, [{ id: 'k1', name: 'Аренда' }]);
    expect(s).toMatchObject({ outflow: 10700, profitExpenses: 5700, collection: 5000, transfers: 4000 });
    expect(s.byCategory.map((c) => [c.name, c.total, c.forProfit])).toEqual([
      ['Инкассация', 5000, false], ['Закуп', 3000, true], ['Зарплата', 2000, true], ['Аренда', 700, true],
    ]);
  });
  it('фильтрует по периоду, категории, получателю, кассе и поиску', () => {
    expect(filterExpenses(list, { from: '2026-10-01', to: '2026-10-31' })).toHaveLength(4);
    expect(filterExpenses(list, { category: 'collection' })).toHaveLength(2);
    expect(filterExpenses(list, { category: 'transfer' })).toHaveLength(1);
    expect(filterExpenses(list, { recipient: ' анна ' })).toHaveLength(2);
    expect(filterExpenses(list, { accountId: 'bank' })).toHaveLength(1);
    expect(filterExpenses(list, { query: 'склад' })).toHaveLength(1);
    expect(filterExpenses(list, { query: '3000' })).toHaveLength(1);
    expect(filterExpenses(list, { query: 'аренда' }, { categories: [{ id: 'k1', name: 'Аренда' }] })).toHaveLength(1);
  });
  it('собирает получателей без повторов, свежие первыми', () => {
    expect(recentRecipients(list)).toEqual(['Владелец', 'Анна', 'Поставщик']);
  });
  it('считает быстрые периоды', () => {
    const now = new Date(2026, 9, 28, 12); // среда
    expect(periodRange('today', now)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(periodRange('week', now)).toEqual({ from: '2026-10-26', to: '2026-10-28' });
    expect(periodRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(periodRange('prevMonth', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('all', now)).toEqual({ from: '', to: '' });
  });
});

describe('остатки', () => {
  it('новый расход списывает, перемещение переносит без повторного списания', () => {
    expect(balanceAfter(accounts, null, { amount: 1000, account_id: 'cash', to_account_id: null })).toEqual({ cash: 9000, bank: 50000 });
    const moved = balanceAfter(accounts, null, { amount: 4000, account_id: 'cash', to_account_id: 'bank' });
    expect(moved).toEqual({ cash: 6000, bank: 54000 });
    expect(moved.cash + moved.bank).toBe(60000);
  });
  it('изменение сначала возвращает старую сумму, потом списывает новую', () => {
    const previous = { amount: 1000, accountId: 'cash', toAccountId: null };
    expect(balanceAfter(accounts, previous, { amount: 1500, account_id: 'bank', to_account_id: null })).toEqual({ cash: 11000, bank: 48500 });
    expect(balanceAfter(accounts, { amount: 4000, accountId: 'cash', toAccountId: 'bank' }, null)).toEqual({ cash: 14000, bank: 46000 });
  });
});

describe('чеки и база', () => {
  it('строит путь в папке владельца и проверяет файл', () => {
    expect(expenseReceiptPath('owner-1', 'e1', 'Чек.JPG', 5)).toBe('owner-1/e1-5.jpg');
    expect(expenseReceiptPath('owner-1', 'e1', 'noext', 5)).toBe('owner-1/e1-5');
    expect(() => checkReceiptFile({ size: 11 * 1024 * 1024, type: 'image/jpeg' })).toThrow('10 МБ');
    expect(() => checkReceiptFile({ size: 10, type: 'text/html' })).toThrow('PDF');
    expect(() => checkReceiptFile({ size: 10, type: 'image/heic' })).not.toThrow();
  });
  it('не создаёт категорию-дубль', async () => {
    const db = { from: vi.fn() };
    await expect(addCategory(db, ' закуп ', [])).rejects.toThrow('уже есть');
    await expect(addCategory(db, 'Аренда', [{ id: 'k1', name: 'аренда' }])).rejects.toThrow('уже есть');
    expect(db.from).not.toHaveBeenCalled();
  });
  it('сохраняет новую операцию через insert и изменённую через update по id', async () => {
    const calls = [];
    const db = { from: (table) => ({
      insert: (row) => { calls.push(['insert', table, row]); return { select: async () => ({ data: [{ ...row, created_by_name: 'Админ' }], error: null }) }; },
      update: (row) => ({ eq: (col, id) => { calls.push(['update', table, row, col, id]); return { select: async () => ({ data: [{ ...row, id }], error: null }) }; } }),
    }) };
    const row = { amount: 10, category: 'other', occurred_at: '2026-10-28T10:00:00.000Z', account_id: 'cash', to_account_id: null, recipient: '', comment: '' };
    const created = await saveExpense(db, null, row);
    expect(created.id).toMatch(/^e/);
    expect(created.createdByName).toBe('Админ');
    await saveExpense(db, 'e1', row);
    expect(calls[1]).toEqual(['update', 'expenses', row, 'id', 'e1']);
  });
  it('объясняет, почему кассу с операциями нельзя удалить', async () => {
    const db = { from: () => ({ delete: () => ({ eq: async () => ({ error: { message: 'update or delete on table violates foreign key constraint' } }) }) }) };
    await expect(deleteAccount(db, 'cash')).rejects.toThrow('в архив');
  });
});
