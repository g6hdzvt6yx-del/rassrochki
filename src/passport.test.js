import { describe, it, expect } from 'vitest';
import { normalizePassport, withPassport, passportLines, matchesPickerQuery, passportOf } from './passport';

describe('паспортные данные', () => {
  it('пустой паспорт не сохраняется', () => {
    expect(normalizePassport({ series: '  ', number: '' })).toBeNull();
    expect(withPassport({ 0: { paidAmount: 100 }, __passport: { series: '1' } }, { series: '' })).toEqual({ 0: { paidAmount: 100 } });
  });
  it('сохраняет паспорт, не трогая платежи и служебные ключи', () => {
    const payments = { 0: { paidAmount: 100 }, __contacts: [{ id: 'x' }] };
    const next = withPassport(payments, { series: ' 90 12 ', number: '123456', issuedBy: 'ОВД  района' });
    expect(next[0]).toEqual({ paidAmount: 100 });
    expect(next.__contacts).toEqual([{ id: 'x' }]);
    expect(next.__passport.series).toBe('90 12');
    expect(next.__passport.issuedBy).toBe('ОВД района');
    expect(payments.__passport).toBeUndefined();
    expect(passportOf({ payments: next }).number).toBe('123456');
  });
  it('формирует строки для печати', () => {
    expect(passportLines({ series: '9012', number: '123456', issueDate: '2020-05-01', issuedBy: 'МВД', birthDate: '1990-01-02' })).toEqual([
      ['Паспорт', '9012 123456'], ['Выдан', 'МВД, 01.05.2020'], ['Дата и место рождения', '02.01.1990'],
    ]);
  });
});

describe('поиск в списке клиентов', () => {
  const client = { name: 'Иванов Иван Петрович', phone: '+7 (928) 111-22-33' };
  it('ищет по любой части имени, без учёта регистра и порядка слов', () => {
    expect(matchesPickerQuery(client, 'иван')).toBe(true);
    expect(matchesPickerQuery(client, 'петрович ив')).toBe(true);
    expect(matchesPickerQuery(client, 'сидоров')).toBe(false);
  });
  it('ищет по цифрам телефона', () => {
    expect(matchesPickerQuery(client, '1112233')).toBe(true);
    expect(matchesPickerQuery(client, '22')).toBe(false);
  });
});

import { guarantorPassportOf, contractPassportLines } from './passport';
describe('паспорт поручителя', () => {
  it('хранится отдельно от паспорта клиента и подписывается в печати', () => {
    let payments = withPassport({ 0: { paidAmount: 5 } }, { series: '1111', number: '222222' });
    payments = withPassport(payments, { series: '3333', number: '444444' }, '__guarantorPassport');
    const contract = { payments };
    expect(passportOf(contract).series).toBe('1111');
    expect(guarantorPassportOf(contract).series).toBe('3333');
    expect(contractPassportLines(contract)).toEqual([['Паспорт', '1111 222222'], ['Поручитель — паспорт', '3333 444444']]);
    expect(withPassport(payments, {}, '__guarantorPassport').__passport.series).toBe('1111');
    expect(withPassport(payments, {}, '__guarantorPassport').__guarantorPassport).toBeUndefined();
  });
});
