import { addMonthsClamped, splitScheduleAmount } from './finance';
import { actualPaid } from './contractSafety';
export function callSchedule(client, now=new Date()) {
 const today=new Date(now);today.setHours(0,0,0,0);
 return splitScheduleAmount(client.financed,client.termMonths).map((amount,index)=>{
  const p=client.payments?.[index];
  const due=p?.deferredUntil?new Date(p.deferredUntil+'T00:00:00'):addMonthsClamped(client.startDate,index);
  const remaining=Math.max(0,amount-actualPaid(p,amount));
  return {index,due,amount,remaining,overdue:remaining>0&&due<today,upcoming:remaining>0&&due>=today&&(due-today)/86400000<=3};
 });
}
