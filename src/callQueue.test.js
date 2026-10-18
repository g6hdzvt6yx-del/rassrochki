import {it,expect} from 'vitest';
import {callSchedule} from './callQueue';
it('shows actual partial debt and respects deferrals',()=>{
 const rows=callSchedule({financed:300,termMonths:3,startDate:'2026-08-18',payments:{0:{paidDate:'2026-08-18'},1:{paidDate:'2026-09-18',paidAmount:40},2:{deferredUntil:'2026-11-18'}}},new Date('2026-10-18T12:00:00'));
 expect(rows[0].remaining).toBe(0);expect(rows[1].remaining).toBe(60);expect(rows[1].overdue).toBe(true);expect(rows[2].overdue).toBe(false);expect(rows[2].upcoming).toBe(false);
});
it('includes today and next three days, excludes later and paid payments',()=>{
 const c={financed:100,termMonths:1,startDate:'2026-10-21',payments:{}};
 expect(callSchedule(c,new Date('2026-10-18T12:00:00'))[0].upcoming).toBe(true);
 expect(callSchedule({...c,startDate:'2026-10-22'},new Date('2026-10-18T12:00:00'))[0].upcoming).toBe(false);
});
