import {describe,it,expect} from 'vitest';
import {cashEntries,cashCards,paymentDestination,destinationLabel} from './cash';
import {allocateContractPayment} from './payments';
const base={id:'c',clientName:'Клиент',totalPrice:1200,downPayment:200,markup:0,termMonths:2,startDate:'2026-10-01'};
describe('касса',()=>{
 it('не относит старые платежи и взносы к наличным',()=>{
  const entries=cashEntries([{...base,payments:{0:{paidDate:'2026-10-02'}}}]);
  expect(entries.reduce((s,e)=>s+e.amount,0)).toBe(700);
  expect(entries.every(e=>destinationLabel(e)==='Способ не указан')).toBe(true);
 });
 it('сохраняет карту при распределении и не удваивает поступление',()=>{
  const result=allocateContractPayment({rows:[{index:0,n:1,remainingDue:500,paidAmount:0,amountDue:500,status:'overdue',dueDate:'2026-10-01'},{index:1,n:2,remainingDue:500,paidAmount:0,amountDue:500,dueDate:'2026-11-01'}],selectedIndex:0,amount:700,date:'2026-10-02',destination:paymentDestination('bank','Банк 1234')});
  const entries=cashEntries([{...base,downPayment:0,payments:result.payments}]);
  expect(entries.reduce((s,e)=>s+e.amount,0)).toBe(700);
  expect(entries.every(e=>e.card==='Банк 1234')).toBe(true);
  expect(cashCards([{payments:result.payments}])).toEqual(['Банк 1234']);
 });
 it('требует способ и карту, не переносит карту на наличные',()=>{
  expect(()=>paymentDestination('')).toThrow();
  expect(()=>paymentDestination('bank',' ')).toThrow();
  expect(paymentDestination('cash','Банк')).toEqual({method:'cash'});
 });
 it('учитывает взнос и справочник, игнорирует служебные записи',()=>{
  const c={...base,payments:{__cashCards:['Банк 1234'],__contacts:[{amount:100}],__downPaymentDestination:{method:'bank',card:'Банк 1234'}}};
  expect(cashCards([c])).toEqual(['Банк 1234']);
  expect(cashEntries([c])).toHaveLength(1);
  expect(cashEntries([c])[0]).toMatchObject({amount:200,card:'Банк 1234'});
 });
 it('отмена платежа убирает поступление',()=>{
  expect(cashEntries([{...base,downPayment:0,payments:{0:{receipt:{name:'чек'}}}}])).toEqual([]);
 });
});
