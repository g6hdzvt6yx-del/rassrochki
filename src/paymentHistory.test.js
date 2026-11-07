import { expect, it } from 'vitest';
import { contractReceipts, receiptPurpose, receiptMethod } from './paymentHistory';

it('склеивает одну оплату, разнесённую по двум платежам, и сортирует по дате', () => {
  const rows = [
    { n: 1, index: 0, paymentEvents: [
      { date: '2026-08-03', amount: 5000, createdAt: '2026-08-03T10:00:00.000Z', method: 'cash' },
      { date: '2026-08-20', amount: 5802, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
    ] },
    { n: 2, index: 1, paymentEvents: [
      { date: '2026-08-20', amount: 4198, createdAt: '2026-08-20T09:00:00.000Z', method: 'bank', card: 'Сбер' },
    ] },
    { n: 3, index: 2, paymentEvents: [{ date: '2026-09-01', amount: 3400, legacy: true }] },
  ];
  const list = contractReceipts({ downPayment: 2000, startDate: '2026-07-04' }, rows);
  expect(list.map((r) => [r.date, r.amount, r.numbers])).toEqual([
    ['2026-07-04', 2000, []],
    ['2026-08-03', 5000, [1]],
    ['2026-08-20', 10000, [1, 2]],
    ['2026-09-01', 3400, [3]],
  ]);
  expect(receiptPurpose(list[0])).toBe('Первоначальный взнос');
  expect(receiptPurpose(list[2])).toBe('Платежи №1, 2');
  expect(receiptMethod(list[2])).toBe('Безнал · Сбер');
  expect(list.reduce((s, r) => s + r.amount, 0)).toBe(2000 + 5000 + 5802 + 4198 + 3400);
});
