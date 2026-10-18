import { describe, it, expect } from 'vitest';
import { actualPaid, prepareContractEdit, draftContractId } from './contractSafety';
import { splitScheduleAmount } from './finance';

const original = { totalPrice: 12000, downPayment: 0, markup: 0, termMonths: 2,
  payments: { 0: { paidDate: '2026-01-02', paymentEvents: [{ date: '2026-01-02', amount: 6000 }] } } };
describe('сохранность оплат при редактировании договора', () => {
  it('не увеличивает полученные деньги вслед за суммой договора', () => {
    const changed = prepareContractEdit(original, { totalPrice: 16000 });
    expect(actualPaid(changed.payments[0], 8000)).toBe(6000);
    expect(changed.payments[0].paymentEvents).toEqual(original.payments[0].paymentEvents);
  });
  it('фиксирует сумму старой оплаты без событий до пересчёта', () => {
    const legacy = { ...original, payments: { 0: { paidDate: '2026-01-02' } } };
    const changed = prepareContractEdit(legacy, { totalPrice: 16000 });
    expect(actualPaid(changed.payments[0], 8000)).toBe(6000);
    expect(legacy.payments[0].paymentEvents).toBeUndefined();
  });
  it('учитывает несколько частичных поступлений независимо от старого paidAmount', () => {
    expect(actualPaid({ paidAmount: 500, paymentEvents: [{ amount: 200 }, { amount: 700 }] }, 1000)).toBe(900);
  });
  it('сохраняет частичную оплату старого формата', () => {
    const changed = prepareContractEdit({ ...original, payments: { 0: { paidDate: '2026-01-02', paidAmount: 3000 } } }, { totalPrice: 16000 });
    expect(actualPaid(changed.payments[0], 8000)).toBe(3000);
  });
  it('не разрешает уменьшить график ниже уже полученной суммы', () => {
    expect(() => prepareContractEdit(original, { totalPrice: 8000 })).toThrow('меньше уже полученных');
  });
  it.each([
    { paidDate: '2026-02-01' }, { receipt: { path: 'receipt.pdf' } },
    { deferralHistory: [{ toDate: '2026-03-01' }] }, { notifiedAt: '2026-02-01' },
  ])('не удаляет месяц с историей %j', (record) => {
    expect(() => prepareContractEdit({ ...original, payments: { 1: record } }, { termMonths: 1 })).toThrow('Нельзя убрать платёж №2');
  });
  it('разрешает сокращение пустого графика, сохраняя историю контактов', () => {
    const contacts = [{ note: 'Договорились' }];
    const changed = prepareContractEdit({ ...original, payments: { __contacts: contacts } }, { termMonths: 1 });
    expect(changed.payments.__contacts).toEqual(contacts);
    expect(splitScheduleAmount(changed.totalPrice, changed.termMonths)).toEqual([12000]);
  });
  it('связывает новые и старые черновики с исходным договором', () => {
    expect(draftContractId({ data: { contractId: 'c1' } })).toBe('c1');
    expect(draftContractId({ draft_type: 'Редактирование договора', id: 'edit-contract-c123' })).toBe('c123');
    expect(draftContractId({ draft_type: 'Новый договор', id: 'new-contract-123' })).toBeNull();
  });
});
