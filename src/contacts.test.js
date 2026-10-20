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

it('объединяет журнал оператора с историей администратора без изменения договора',()=>{
 const first=contract('a','89991234567','Клиент',[{id:'manual',occurredAt:'2026-10-19T12:00:00Z',note:'Ранее'}]);
 const second=contract('b','89991234567','Клиент');
 const logs=[{id:'1',contract_id:'b',result:'promised',note:'Проверка',created_at:'2026-10-20T10:00:00Z',promised_date:'2026-10-21',promised_amount:10000},{id:'2',contract_id:'unrelated',result:'promised',promised_amount:90000}];
 const result=clientContacts([first,second],first,logs);
 expect(result).toHaveLength(2);
 expect(result[0]).toMatchObject({id:'operator:1',resultLabel:'Обещал оплатить',note:'Проверка',promisedDate:'2026-10-21',promisedAmount:10000,readOnly:true,_contractId:'b'});
 expect(first.payments.__contacts).toHaveLength(1);
 expect(second.payments.__contacts).toHaveLength(0);
 expect(clientContacts([first,second],first,logs)).toEqual(result);
});
it('сохраняет время обратного звонка и сообщение об оплате отдельно от платежей',()=>{
 const c=contract('a','','Клиент');
 const result=clientContacts([c],c,[{id:'1',contract_id:'a',result:'callback',next_contact_at:'2026-10-21T10:00:00Z'},{id:'2',contract_id:'a',result:'reported_paid'}]);
 expect(result[0].nextContactDate).toBe('2026-10-21T10:00:00Z');
 expect(result[1].resultLabel).toContain('нужна проверка');
 expect(c.payments).toEqual({__contacts:[]});
});
