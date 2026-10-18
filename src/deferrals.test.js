import { describe, expect, it } from 'vitest';
import { changeDeferral } from './deferrals';

const scheduled = '2026-08-25';
const add = (record = {}, date = '2026-09-25') => changeDeferral(record, scheduled, { date, reason: ' Просьба клиента ', now: 'created' });

describe('управление отсрочками', () => {
  it('добавляет дату и причину, не изменяя исходную запись', () => {
    const original = { notifiedAt: 'notification' };
    const result = add(original);
    expect(result.deferralHistory).toEqual([{ fromDate: scheduled, toDate: '2026-09-25', reason: 'Просьба клиента', createdAt: 'created' }]);
    expect(original).toEqual({ notifiedAt: 'notification' });
  });
  it('исправляет текущую дату на более раннюю без создания нового переноса', () => {
    const original = add();
    const result = changeDeferral(original, scheduled, { mode: 'edit', date: '2026-09-10', reason: 'Уточнено', now: 'edited' });
    expect(result.deferredUntil).toBe('2026-09-10');
    expect(result.deferralHistory).toHaveLength(1);
    expect(result.deferralHistory[0]).toMatchObject({ createdAt: 'created', updatedAt: 'edited', reason: 'Уточнено' });
    expect(original.deferredUntil).toBe('2026-09-25');
  });
  it('разрешает изменить только причину', () => {
    const result = changeDeferral(add(), scheduled, { mode: 'edit', date: '2026-09-25', reason: 'Новая причина' });
    expect(result.deferralReason).toBe('Новая причина');
    expect(result.deferralHistory).toHaveLength(1);
  });
  it('отменяет переносы по очереди и сохраняет платежи, чеки и уведомления', () => {
    const metadata = { paidAmount: 100, paymentEvents: [{ amount: 100, date: scheduled }], receipt: 'receipt.pdf', notifiedAt: 'notification', comment: 'Комментарий' };
    const first = add(metadata);
    const second = add(first, '2026-10-25');
    expect(second.deferralHistory).toHaveLength(2);
    const restored = changeDeferral(second, scheduled, { mode: 'cancel' });
    expect(restored).toEqual(first);
    expect(changeDeferral(restored, scheduled, { mode: 'cancel' })).toEqual(metadata);
  });
  it('поддерживает старые отсрочки без массива истории', () => {
    const legacy = { deferredUntil: '2026-09-25', deferralReason: 'Старая причина', receipt: 'receipt.pdf' };
    const result = changeDeferral(legacy, scheduled, { mode: 'edit', date: '2026-09-20', reason: 'Исправлено' });
    expect(result.deferralHistory[0].fromDate).toBe(scheduled);
    expect(changeDeferral(legacy, scheduled, { mode: 'cancel' })).toEqual({ receipt: 'receipt.pdf' });
  });
  it('не позволяет пересечь предыдущую дату или сохранить несуществующую дату', () => {
    for (const date of ['', '2026-02-30', '2026-08-25', '2026-08-24']) {
      expect(() => changeDeferral(add(), scheduled, { mode: 'edit', date })).toThrow();
    }
    expect(() => add(add(), '2026-09-25')).toThrow();
    expect(() => changeDeferral(add(add(), '2026-10-25'), scheduled, { mode: 'edit', date: '2026-09-20' })).toThrow();
    expect(() => changeDeferral({}, scheduled, { mode: 'cancel' })).toThrow();
    expect(() => changeDeferral({}, scheduled, { mode: 'edit', date: '2026-09-25' })).toThrow();
  });
});
