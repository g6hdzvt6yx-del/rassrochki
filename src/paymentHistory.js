// Таблица фактических оплат по договору: одна строка — одна оплата
// по одному платежу графика. Для каждой строки: сколько положено по
// графику (due), сколько внесено (amount) и сколько осталось по этому
// платежу после оплаты (remaining).
// Одна оплата, разнесённая по нескольким платежам, хранится частями
// с общим createdAt — такие части помечаются общей суммой оплаты.

const destinationKey = (e) => `${e.method || ''}|${e.card || ''}`;
const sortEvents = (a, b) => String(a.date).localeCompare(String(b.date))
  || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

export function contractReceipts(contract, rows = []) {
  const parts = [];
  rows.forEach((row) => {
    const events = (row.paymentEvents || [])
      .map((event, i) => ({ ...event, i }))
      .filter((event) => event?.date && (+event.amount || 0) > 0)
      .sort(sortEvents);
    let paid = 0;
    events.forEach((event) => {
      const amount = +event.amount || 0;
      const date = String(event.date).slice(0, 10);
      paid += amount;
      parts.push({
        date, due: +row.amountDue || 0, amount, remaining: Math.max(0, (+row.amountDue || 0) - paid),
        numbers: [row.n], createdAt: event.createdAt || '',
        method: event.method || '', card: event.card || '',
        comment: event.comment || '', earlyPayoff: !!event.earlyPayoff,
        key: event.createdAt
          ? `${date}|${String(event.createdAt).slice(0, 19)}|${destinationKey(event)}`
          : `${date}|row${row.index}|${event.i}`,
      });
    });
  });

  const totals = new Map();
  parts.forEach((p) => {
    const t = totals.get(p.key) || { amount: 0, count: 0 };
    totals.set(p.key, { amount: t.amount + p.amount, count: t.count + 1 });
  });
  parts.forEach((p) => {
    const t = totals.get(p.key);
    if (t.count > 1) { p.receiptTotal = t.amount; p.receiptParts = t.count; }
  });

  const down = +contract?.downPayment || 0;
  if (down > 0) {
    const dest = contract.payments?.__downPaymentDestination || {};
    parts.push({
      date: String(contract.contractDate || contract.startDate || '').slice(0, 10),
      due: down, amount: down, remaining: 0, numbers: [], downPayment: true, createdAt: '',
      method: dest.method || '', card: dest.card || '', comment: '', key: 'down',
    });
  }
  return parts.sort((a, b) => a.date.localeCompare(b.date)
    || (b.downPayment ? 1 : 0) - (a.downPayment ? 1 : 0)
    || String(a.createdAt).localeCompare(String(b.createdAt))
    || (a.numbers[0] || 0) - (b.numbers[0] || 0));
}

export const receiptPurpose = (r) => r.downPayment
  ? 'Первоначальный взнос'
  : `${r.earlyPayoff ? 'Досрочно · ' : ''}Платёж №${r.numbers.join(', ')}`;

export const receiptMethod = (r) => r.method === 'cash' ? 'Наличные' : r.method === 'bank' ? `Безнал${r.card ? ` · ${r.card}` : ''}` : '';

// «Способ / комментарий»: способ, комментарий и пометка о разнесённой оплате.
export const receiptNote = (r, money) => [
  receiptMethod(r),
  r.comment,
  r.receiptTotal ? `часть оплаты ${money(r.receiptTotal)}` : '',
].filter(Boolean).join(' — ');
