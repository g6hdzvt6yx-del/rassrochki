import { splitScheduleAmount } from './finance';
import { actualPaid } from './contractSafety';
export const cashCards = contracts => [...new Set(contracts.flatMap(c => [
  ...(c.payments?.__cashCards || []),
  ...(c.payments?.__downPaymentDestination?.card ? [c.payments.__downPaymentDestination.card] : []),
  ...Object.values(c.payments || {}).flatMap(r => (r?.paymentEvents || []).map(e => e.card).filter(Boolean)),
]))].sort((a,b) => a.localeCompare(b,'ru'));
export function paymentDestination(method, card = '') {
  if (!['cash','bank'].includes(method)) throw new Error('Выберите способ оплаты');
  const name = String(card).trim();
  if (method === 'bank' && !name) throw new Error('Укажите карту для безналичной оплаты');
  return { method, ...(method === 'bank' ? {card:name} : {}) };
}
// Дата получения первоначального взноса: день составления договора, иначе день, когда договор
// внесли в программу. Дата первого платежа по графику сюда не подходит — она обычно на месяц позже.
const localDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const downPaymentDate = c => String(c.contractDate || '').slice(0, 10) || (c.createdAt ? localDay(c.createdAt) : '') || String(c.startDate || '').slice(0, 10);
export function cashEntries(contracts) {
  return contracts.flatMap(c => {
    const amounts = splitScheduleAmount(Math.max(0,+c.totalPrice - (+c.downPayment || 0) + (+c.markup || 0)), c.termMonths);
    const rows = Object.entries(c.payments || {}).filter(([key]) => /^\d+$/.test(key)).flatMap(([key,r]) => {
      const events = r.paymentEvents?.length ? r.paymentEvents : r.paidDate ? [{date:r.paidDate,amount:actualPaid(r,amounts[+key] || 0)}] : [];
      return events.filter(e => +e.amount > 0).map((e,i) => ({...e,id:`${c.id}:${key}:${i}`,client:c.clientName,item:c.item,contractId:c.id,purpose:`Платёж №${+key+1}`}));
    });
    if (+c.downPayment > 0) rows.push({id:`${c.id}:down`,client:c.clientName,item:c.item,contractId:c.id,purpose:'Первоначальный взнос',date:downPaymentDate(c),amount:+c.downPayment,...c.payments?.__downPaymentDestination});
    return rows;
  }).sort((a,b) => String(b.date).localeCompare(String(a.date)));
}
export const destinationLabel = e => e.method === 'cash' ? 'Наличные' : e.method === 'bank' ? `Безнал · ${e.card || 'Карта не указана'}` : 'Способ не указан';
