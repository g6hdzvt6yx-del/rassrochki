import { expect, it } from 'vitest';
import { contractReceipts, receiptPurpose, receiptMethod, receiptNote } from './paymentHistory';

const money = (v) => `${v} руб.`;

it('одна строка — одна оплата с полной внесённой суммой; разбивка в комментарии', () => {
  const rows = [
    { n: 1, index: 0, amountDue: 10800, paymentEvents: [
      // порядок записи нарочно перепутан — остаток считается по датам
      { date: '2026-08-20', amount: 600, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
      { date: '2026-08-03', amount: 10200, createdAt: '2026-08-03T10:00:00.000Z', method: 'cash' },
    ] },
    { n: 2, index: 1, amountDue: 10800, paymentEvents: [
      { date: '2026-08-20', amount: 9900, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
    ] },
    { n: 3, index: 2, amountDue: 10800, paymentEvents: [{ date: '2026-09-01', amount: 3400, legacy: true }] },
  ];
  const list = contractReceipts({ downPayment: 2000, startDate: '2026-07-04' }, rows);
  expect(list.map((r) => [r.date, r.due, r.amount, r.numbers, r.remaining])).toEqual([
    ['2026-07-04', 2000, 2000, [], 0],
    ['2026-08-03', 10800, 10200, [1], 600],
    // одна оплата 10 500: 600 закрыли №1, 9 900 ушли в №2 (остаток по №2 — 900)
    ['2026-08-20', 10800, 10500, [1, 2], 900],
    ['2026-09-01', 10800, 3400, [3], 7400],
  ]);
  expect(receiptPurpose(list[0])).toBe('Первоначальный взнос');
  expect(receiptPurpose(list[2])).toBe('Платежи №1, 2');
  expect(receiptMethod(list[2])).toBe('Безнал · Сбер');
  expect(receiptNote(list[2], money)).toBe('в №1 — 600 руб., в №2 — 9900 руб. · Безнал · Сбер');
  expect(receiptNote(list[1], money)).toBe('Наличные');
  // «Итого» по фактическим суммам не задваивается
  expect(list.reduce((s, r) => s + r.amount, 0)).toBe(2000 + 10200 + 10500 + 3400);
});
