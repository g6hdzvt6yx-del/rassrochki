import { describe, it, expect } from 'vitest';
import { contractsForClient, summarizeClient } from './clientSummary';
const client = { id:'a', clientName:'Иван Иванов', phone:'8 (999) 123-45-67' };
describe('matching a client', () => {
 it('matches normalized phones but not a namesake with a different phone', () => {
  const related = contractsForClient([client, { id:'b', phone:'+7 999 123 45 67' }, { id:'c', clientName:client.clientName, phone:'89990000000' }], client);
  expect(related.map(c => c.id)).toEqual(['a','b']);
 });
 it('only matches other missing phones when using a name fallback', () => {
  const a={ id:'a',clientName:' Иван ',phone:'' };
  expect(contractsForClient([a,{id:'b',clientName:'иван'}, {id:'c',clientName:'Иван',phone:'89990000000'}],a).map(c=>c.id)).toEqual(['a','b']);
  expect(contractsForClient([{id:'a'},{id:'b'}],{id:'a'}).map(c=>c.id)).toEqual(['a']);
 });
});
const row = (due, amount, status, events=[]) => ({ n:1,dueDate:new Date(due+'T00:00:00'),remainingDue:amount,status,paymentEvents:events });
describe('client balances and history', () => {
 it('sums all contracts, includes closed contract history, groups simultaneous upcoming payments and respects deferred due dates', () => {
  const contracts=[{id:'a'},{id:'b'},{id:'closed'}];
  const stats={
   a:{remaining:67000,overdueSum:7000,rows:[row('2026-10-07',7000,'overdue',[{date:'2026-10-12',amount:5000}]),row('2026-10-20',20000,'upcoming')]},
   b:{remaining:17000,overdueSum:0,rows:[{...row('2026-10-20',12000,'upcoming'),scheduledDueDate:new Date('2026-09-20T00:00:00')}]},
   closed:{remaining:0,overdueSum:0,rows:[row('2026-09-01',0,'paid',[{date:'2026-09-01',amount:9000}])]}
  };
  const s=summarizeClient(contracts,c=>stats[c.id],'2026-10-15');
  expect(s.remaining).toBe(84000);expect(s.overdue).toBe(7000);expect(s.overdueDays).toBe(8);expect(s.active).toBe(2);
  expect(s.nextAmount).toBe(32000);expect(s.next).toHaveLength(2);expect(s.payments).toHaveLength(2);expect(s.lastPayment.amount).toBe(5000);
 });
 it('handles partial and legacy payments, ignores future events for last payment, flags undated receipts', () => {
  const s=summarizeClient([client],()=>({remaining:50,overdueSum:0,rows:[
   {...row('2026-10-15',50,'partial'),paidAmount:25,paidDate:'2026-10-14'},
   {...row('2026-11-01',0,'paid'),paidAmount:30},
   row('2026-12-01',0,'paid',[{date:'2026-11-01',amount:100}])
  ]}),'2026-10-15');
  expect(s.nextAmount).toBe(50);expect(s.lastPayment.amount).toBe(25);expect(s.undated).toBe(30);expect(s.payments).toHaveLength(1);
 });
 it('supports an empty client and fully paid portfolios', () => {
  const s=summarizeClient([],()=>{},'2026-10-15');
  expect(s.remaining).toBe(0);expect(s.active).toBe(0);expect(s.next).toEqual([]);expect(s.lastPayment).toBeNull();
 });
});
it('shows the full receipt when one payment covers several schedule rows', () => {
 const s=summarizeClient([client],()=>({remaining:100,overdueSum:0,rows:[
  {...row('2026-10-01',0,'paid',[{date:'2026-10-14',amount:7000,createdAt:'2026-10-14T10:00:00Z'}]),n:1},
  {...row('2026-11-01',100,'partial',[{date:'2026-10-14',amount:5000,createdAt:'2026-10-14T10:00:00Z'}]),n:2}
 ]}),'2026-10-15');
 expect(s.payments).toHaveLength(1);expect(s.lastPayment.amount).toBe(12000);expect(s.lastPayment.paymentNo).toBe('1, 2');
});
