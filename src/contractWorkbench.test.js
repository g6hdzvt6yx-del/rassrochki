import {describe,it,expect} from 'vitest';
import {overdueDays,daysLabel,staleNotification,matchesWorkView} from './contractWorkbench';
const now=new Date(2026,9,24,12);
describe('contract work queue',()=>{
 it('counts calendar days from earliest unpaid overdue row',()=>expect(overdueDays([{status:'overdue',remainingDue:1,dueDate:new Date(2026,9,20)},{status:'paid',remainingDue:0,dueDate:new Date(2026,8,1)}],now)).toBe(4));
 it('formats Russian days',()=>expect([1,2,4,11,21,22,25].map(daysLabel)).toEqual(['1 день','2 дня','4 дня','11 дней','21 день','22 дня','25 дней']));
 it('uses latest notification across all payments and 72-hour boundary',()=>{expect(staleNotification({},now)).toBe(true);expect(staleNotification({0:{notifiedAt:new Date(+now-72*3600000).toISOString()}},now)).toBe(true);expect(staleNotification({0:{notifiedAt:new Date(+now-80*3600000).toISOString()},1:{notifiedAt:new Date(+now-3600000).toISOString()}},now)).toBe(false)});
 it('excludes closed contracts and applies large debt threshold',()=>{expect(matchesWorkView('large',{done:false,overdueSum:100000},[],{},now)).toBe(true);expect(matchesWorkView('large',{done:true,overdueSum:100000},[],{},now)).toBe(false)});
 it('includes due callbacks and future promises in their respective views',()=>{expect(matchesWorkView('calls',{done:false},[{nextContactDate:'2026-10-23'}],{},now)).toBe(true);expect(matchesWorkView('promised',{done:false},[{promisedDate:'2026-10-25'}],{},now)).toBe(true);expect(matchesWorkView('promised',{done:false},[{promisedDate:'2026-10-23'}],{},now)).toBe(false)});
});
