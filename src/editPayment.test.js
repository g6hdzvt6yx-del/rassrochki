import {it,expect} from 'vitest';
import {editPaymentEvent} from './payments';
const rec={paidDate:'2026-10-23',receipt:{name:'чек'},paymentEvents:[{date:'2026-10-22',amount:40,method:'bank',card:'1234'},{date:'2026-10-23',amount:60,comment:'старый'}]};
const args={payments:{0:rec,__cashCards:['1234']},row:{index:0,amountDue:100},expectedRecord:rec,eventIndex:0,amount:20,date:'2026-10-21',comment:'исправлен',destination:{method:'cash'}};
it('редактирует одно поступление, сохраняет остальные и пересчитывает остаток',()=>{const p=editPaymentEvent(args);expect(p[0].paidAmount).toBe(80);expect(p[0].paymentEvents[0]).toMatchObject({amount:20,method:'cash',comment:'исправлен'});expect(p[0].paymentEvents[0].card).toBeUndefined();expect(p[0].paymentEvents[1]).toEqual(rec.paymentEvents[1]);expect(p[0].receipt).toEqual(rec.receipt);expect(p.__cashCards).toEqual(['1234']);expect(rec.paymentEvents[0].amount).toBe(40);});
it('редактирует старую полную оплату без событий',()=>{const old={paidDate:'2026-10-23'};expect(editPaymentEvent({...args,payments:{0:old},expectedRecord:old,row:{index:0,amountDue:100,paymentEvents:[{date:old.paidDate,amount:100,legacy:true}]},amount:90})[0].paidAmount).toBe(90);});
it('отклоняет устаревшую запись, превышение и некорректные значения',()=>{expect(()=>editPaymentEvent({...args,expectedRecord:{}})).toThrow();for(const amount of [0,-1,NaN,Infinity,41])expect(()=>editPaymentEvent({...args,amount})).toThrow();expect(()=>editPaymentEvent({...args,date:'2026-02-30'})).toThrow();});
it('восстанавливает полный статус без дублирования',()=>{const p=editPaymentEvent({...args,amount:40});expect(p[0].paidAmount).toBeUndefined();expect(p[0].paymentEvents).toHaveLength(2);});
import {editPaymentEventWithCarry} from './payments';
const sched=(payments)=>[0,1,2].map(i=>{const r=payments[i];const paid=(r?.paymentEvents||[]).reduce((s,e)=>s+e.amount,0);return {index:i,n:i+1,amountDue:100,paidAmount:paid,remainingDue:100-paid,paid:paid>=100,status:'upcoming',dueDate:new Date(2026,i,1),paymentEvents:r?.paymentEvents||[]};});
it('переплата при изменении поступления уменьшает следующий платёж',()=>{
 const p0={0:{paidDate:'2026-01-05',paymentEvents:[{date:'2026-01-05',amount:100,method:'bank',card:'Сбербанк'}]}};
 const rows=sched(p0);
 const r=editPaymentEventWithCarry({payments:p0,row:rows[0],rows,eventIndex:0,expectedRecord:p0[0],amount:130,date:'2026-01-06',comment:'',destination:{method:'bank',card:'Сбербанк'},createdAt:'now'});
 expect(r.excess).toBe(30);
 expect(r.payments[0].paymentEvents).toEqual([expect.objectContaining({amount:100,date:'2026-01-06'})]);
 expect(r.payments[0].paidAmount).toBeUndefined();
 expect(r.payments[1].paidAmount).toBe(30);
 expect(r.payments[1].paymentEvents[0]).toMatchObject({amount:30,date:'2026-01-06',method:'bank',card:'Сбербанк',carriedFrom:0,comment:'Переплата по платежу №1'});
 expect(r.payments[2]).toBeUndefined();
});
it('большая переплата закрывает следующий и переходит дальше; сверх остатка договора — ошибка',()=>{
 const p0={0:{paymentEvents:[{date:'2026-01-05',amount:100}]}};
 const rows=sched(p0);
 const r=editPaymentEventWithCarry({payments:p0,row:rows[0],rows,eventIndex:0,expectedRecord:p0[0],amount:250,date:'2026-01-05',comment:'',destination:{method:'cash'}});
 expect(r.payments[1].paidAmount).toBeUndefined();expect(r.payments[1].paymentEvents[0].amount).toBe(100);
 expect(r.payments[2].paidAmount).toBe(50);
 expect(()=>editPaymentEventWithCarry({payments:p0,row:rows[0],rows,eventIndex:0,expectedRecord:p0[0],amount:301,date:'2026-01-05',comment:'',destination:{method:'cash'}})).toThrow(/больше, чем осталось/);
});
it('сумма в пределах платежа сохраняется как раньше',()=>{
 const p0={0:{paymentEvents:[{date:'2026-01-05',amount:100}]}};const rows=sched(p0);
 const r=editPaymentEventWithCarry({payments:p0,row:rows[0],rows,eventIndex:0,expectedRecord:p0[0],amount:80,date:'2026-01-05',comment:'',destination:{method:'cash'}});
 expect(r.excess).toBe(0);expect(r.payments[0].paidAmount).toBe(80);
});
