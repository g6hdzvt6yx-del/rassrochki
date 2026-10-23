import {it,expect} from 'vitest';
import {deletePaymentEvent} from './payments';
import {cashEntries} from './cash';
const record={paidDate:'2026-10-23',receipt:{name:'чек'},paymentEvents:[{date:'2026-08-04',amount:10200},{date:'2026-10-23',amount:602,method:'bank',card:'Карта'}]};
const args={payments:{0:record},row:{index:0,amountDue:10802},eventIndex:1,expectedRecord:record};
it('удаляет только ошибочные 602 и пересчитывает кассу и остаток',()=>{const p=deletePaymentEvent(args);expect(p[0].paidAmount).toBe(10200);expect(p[0].paidDate).toBe('2026-08-04');expect(p[0].paymentEvents).toHaveLength(1);expect(p[0].receipt).toEqual(record.receipt);expect(cashEntries([{id:'c',totalPrice:10802,termMonths:1,payments:p}]).reduce((s,e)=>s+e.amount,0)).toBe(10200);expect(record.paymentEvents).toHaveLength(2);});
it('последнее поступление удаляется без потери чека и отсрочки',()=>{const r={paidDate:'2026-10-23',paidAmount:602,receipt:{name:'чек'},deferredUntil:'2026-11-01'};const p=deletePaymentEvent({...args,payments:{0:r},expectedRecord:r,eventIndex:0,row:{index:0,amountDue:10802,paymentEvents:[{date:r.paidDate,amount:602}]}});expect(p[0]).toEqual({receipt:r.receipt,deferredUntil:r.deferredUntil});});
it('пустая запись удаляется, чужие месяцы сохраняются',()=>{const r={paidDate:'2026-10-23',paymentEvents:[{date:'2026-10-23',amount:10}]};expect(deletePaymentEvent({...args,payments:{0:r,1:record},expectedRecord:r,eventIndex:0})).toEqual({1:record});});
it('отклоняет устаревшую запись и неправильный индекс',()=>{expect(()=>deletePaymentEvent({...args,expectedRecord:{}})).toThrow();expect(()=>deletePaymentEvent({...args,eventIndex:5})).toThrow();});
