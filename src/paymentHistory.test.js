import { expect, it } from 'vitest';
import { contractReceipts, receiptPurpose, receiptMethod, receiptNote } from './paymentHistory';

const money = (v) => `${v} руб.`;

it('строит таблицу: сумма по графику, фактически внесено, остаток по платежу', () => {
  const rows = [
    { n: 1, index: 0, amountDue: 10800, paymentEvents: [
      // порядок записи нарочно перепутан — остаток считается по датам
      { date: '2026-08-20', amount: 600, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
      { date: '2026-08-03', amount: 10200, createdAt: '2026-08-03T10:00:00.000Z', method: 'cash' },
    ] },
    { n: 2, index: 1, amountDue: 10800, paymentEvents: [
      { date: '2026-08-20', amount: 4400, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
    ] },
    { n: 3, index: 2, amountDue: 10800, paymentEvents: [{ date: '2026-09-01', amount: 3400, legacy: true }] },
  ];
  const list = contractReceipts({ downPayment: 2000, startDate: '2026-07-04' }, rows);
  expect(list.map((r) => [r.date, r.due, r.amount, r.numbers, r.remaining])).toEqual([
    ['2026-07-04', 2000, 2000, [], 0],
    ['2026-08-03', 10800, 10200, [1], 600],
    ['2026-08-20', 10800, 600, [1], 0],
    ['2026-08-20', 10800, 4400, [2], 6400],
    ['2026-09-01', 10800, 3400, [3], 7400],
  ]);
  expect(receiptPurpose(list[0])).toBe('Первоначальный взнос');
  expect(receiptPurpose(list[3])).toBe('Платёж №2');
  expect(receiptMethod(list[3])).toBe('Безнал · Сбер');
  // одна оплата 5 000, разнесённая на платежи №1 и №2
  expect(list[2].receiptTotal).toBe(5000);
  expect(receiptNote(list[2], money)).toBe('Безнал · Сбер — часть оплаты 5000 руб.');
  expect(receiptNote(list[1], money)).toBe('Наличные');
  expect(list[4].receiptTotal).toBeUndefined();
});
