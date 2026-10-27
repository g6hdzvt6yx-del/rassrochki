import { describe, it, expect } from 'vitest';
import { receiptsOf, withAddedReceipts, withoutReceipt, receiptStoragePath } from './receipts';

const a = { name: 'a.jpg', path: 'c1/0-1.jpg' };
const b = { name: 'b.pdf', path: 'c1/0-2.pdf' };
const c = { name: 'c.png', path: 'c1/0-3.png' };

describe('несколько чеков на платёж', () => {
  it('читает старый одиночный чек и новый список', () => {
    expect(receiptsOf(null)).toEqual([]);
    expect(receiptsOf({ receipt: a })).toEqual([a]);
    expect(receiptsOf({ receipt: a, receipts: [b] })).toEqual([a, b]);
    expect(receiptsOf({ receipt: a, receipts: [a, b] })).toEqual([a, b]);
  });
  it('добавляет чеки, переводя старый в список и сохраняя оплату', () => {
    const next = withAddedReceipts({ paidDate: '2026-10-01', receipt: a }, [b, c]);
    expect(next).toEqual({ paidDate: '2026-10-01', receipts: [a, b, c] });
  });
  it('удаляет только выбранный чек', () => {
    const { record, removed } = withoutReceipt({ paidDate: '2026-10-01', receipt: a, receipts: [b] }, b);
    expect(removed).toEqual(b);
    expect(record).toEqual({ paidDate: '2026-10-01', receipts: [a] });
  });
  it('после удаления последнего чека пустая запись платежа исчезает', () => {
    expect(withoutReceipt({ receipts: [a] }, a).record).toBeNull();
    expect(withoutReceipt({ paidDate: '2026-10-01', receipt: a }, a).record).toEqual({ paidDate: '2026-10-01' });
  });
  it('даёт разные пути файлам, загруженным одновременно', () => {
    expect(receiptStoragePath('c1', 0, 'Фото.JPG', 0, 5)).toBe('c1/0-5.jpg');
    expect(receiptStoragePath('c1', 0, 'Фото.JPG', 2, 5)).toBe('c1/0-5-2.jpg');
    expect(receiptStoragePath('c1', 0, 'скан', 1, 5)).toBe('c1/0-5-1');
  });
});
