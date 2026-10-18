import { describe, expect, it } from 'vitest';
import { clientContacts } from './contacts';

const contract = (id, phone, clientName, contacts = []) => ({ id, phone, clientName, item: id, payments: { __contacts: contacts } });

describe('история контактов в карточке и договоре', () => {
  it('собирает договоры клиента по нормализованному телефону, начиная с новых контактов', () => {
    const first = contract('a', '8 (999) 123-45-67', 'Клиент', [{ id: 'old', occurredAt: '2026-09-01T12:00:00Z', note: 'Ранее' }]);
    const second = contract('b', '+7 999 123 45 67', 'Клиент', [{ id: 'new', occurredAt: '2026-09-29T12:00:00Z', note: 'Обещал', promisedAmount: 1000 }]);
    const other = contract('c', '89991111111', 'Клиент', [{ id: 'other' }]);
    const result = clientContacts([first, second, other], first);
    expect(result.map((c) => c.id)).toEqual(['new', 'old']);
    expect(result[0]).toMatchObject({ _contractId: 'b', _item: 'b', promisedAmount: 1000 });
    expect(first.payments.__contacts[0]._contractId).toBeUndefined();
  });
  it('без телефона использует имя, как полный договор', () => {
    const first = contract('a', '', ' Клиент ');
    const second = contract('b', '', 'клиент', [{ id: 'contact' }]);
    expect(clientContacts([first, second], first)).toHaveLength(1);
  });
  it('не объединяет безымянные записи и поддерживает отсутствие истории', () => {
    const first = contract('a', '', '');
    const other = contract('b', '', '', [{ id: 'other' }]);
    expect(clientContacts([first, other], first)).toEqual([]);
    expect(clientContacts([], null)).toEqual([]);
    expect(clientContacts([{ id: 'a', phone: '', clientName: 'Клиент' }], first)).toEqual([]);
  });
});
