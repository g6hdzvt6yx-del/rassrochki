import { describe, it, expect } from 'vitest';
import { sortContracts } from './contractSort';
import { nextMarkAction } from './operatorMarks';

const day = (s) => new Date(s + 'T00:00:00');
const stats = {
  a: { remaining: 50000, overdueSum: 10000, rows: [{ status: 'overdue', remainingDue: 10000, dueDate: day('2026-10-01') }], next: { dueDate: day('2026-10-01') } },
  b: { remaining: 90000, overdueSum: 0, rows: [], next: { dueDate: day('2026-11-05') } },
  c: { remaining: 20000, overdueSum: 30000, rows: [{ status: 'overdue', remainingDue: 30000, dueDate: day('2026-09-01') }], next: { dueDate: day('2026-09-01') } },
  d: { remaining: 0, overdueSum: 0, rows: [], next: null },
};
const list = ['a', 'b', 'c', 'd'].map((id) => ({ id, clientName: { a: 'Вера', b: 'Анна', c: 'Борис', d: 'Глеб' }[id] }));
const get = (c) => stats[c.id];
const marks = { a: [{ at: '2026-10-20T10:00:00Z' }], c: [{ at: '2026-10-28T10:00:00Z' }], b: [] };
const ids = (...args) => sortContracts(list, ...args).map((c) => c.id);

describe('сортировка договоров', () => {
  it('по просрочке: дольше и больше — выше; без просрочки — в конце', () => {
    expect(ids('overdue', 'desc', get)).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('overdue', 'asc', get)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('по остатку в обе стороны', () => {
    expect(ids('remaining', 'desc', get)).toEqual(['b', 'a', 'c', 'd']);
    expect(ids('remaining', 'asc', get)).toEqual(['d', 'c', 'a', 'b']);
  });
  it('по дате последней отметки; без отметок всегда в конце', () => {
    expect(ids('lastMark', 'desc', get, marks)).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('lastMark', 'asc', get, marks)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('прежние варианты работают как раньше и не меняют исходный список', () => {
    expect(ids('created', 'desc', get)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('name', 'desc', get)).toEqual(['b', 'c', 'a', 'd']);
    expect(ids('dueDate', 'desc', get)).toEqual(['c', 'a', 'b', 'd']);
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('следующее действие из отметки', () => {
  const now = new Date('2026-10-31T12:00:00');
  it('берёт самую свежую отметку со структурированной датой', () => {
    const action = nextMarkAction([
      { id: 'x', note: 'перезвоню завтра' },
      { id: 'y', nextContactAt: '2026-10-31T15:00:00', promisedDate: '2026-11-06', promisedAmount: 20000 },
      { id: 'z', promisedDate: '2026-10-01' },
    ], now);
    expect(action.mark.id).toBe('y');
    expect(action.items.map((i) => [i.kind, i.state])).toEqual([['callback', 'today'], ['promise', 'future']]);
    expect(action.items[1].amount).toBe(20000);
  });
  it('помечает просроченную дату и возвращает null без дат', () => {
    expect(nextMarkAction([{ promisedDate: '2026-10-20' }], now).items[0].state).toBe('late');
    expect(nextMarkAction([{ note: 'текст' }], now)).toBeNull();
    expect(nextMarkAction([], now)).toBeNull();
  });
});
