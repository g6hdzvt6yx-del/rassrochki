import { describe, it, expect } from 'vitest';
import { operatorReminderLink, waReminderLink } from './whatsapp';
const payment=(remaining,day,overdue=false)=>({remaining,due:new Date(2026,9,day),overdue});
const client={phone:'8 (999) 123-45-67',clientName:'Тест',item:'Телефон'};
const message=url=>new URL(url).searchParams.get('text');
describe('operator WhatsApp reminders',()=>{
 it('uses the owner greeting and remaining debt breakdown',()=>{
  const url=operatorReminderLink({...client,schedule:[payment(100,2,true),payment(0,1,true),payment(200,3,true),payment(500,25)]});
  expect(new URL(url).pathname).toBe('/79991234567');
  const text=message(url);
  expect(text).toContain('Ассаламу 1алайкум! Компания «Apple Finans» Уведомляет вас');
  expect(text).toContain('1. 02.10.2026 — 100 ₽');
  expect(text).toContain('2. 03.10.2026 — 200 ₽');
  expect(text).toContain('Общая сумма просрочки: 300 ₽');
  expect(text).not.toContain('500 ₽');
 });
 it('matches the owner message for the earliest unpaid upcoming payment',()=>{
  const due=payment(150,22);
  expect(operatorReminderLink({...client,schedule:[payment(200,25),due,payment(0,1)]})).toBe(waReminderLink(client.phone,client.clientName,client.item,150,due.due,'upcoming'));
 });
 it('does not create links for invalid phones or fully paid contracts',()=>{
  expect(operatorReminderLink({...client,phone:'123',schedule:[payment(100,2,true)]})).toBeNull();
  expect(operatorReminderLink({...client,schedule:[payment(0,2)]})).toBeNull();
 });
});
