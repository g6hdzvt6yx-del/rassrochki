// Список фактических поступлений по договору — так, как платил клиент.
// Одна оплата, разнесённая по нескольким платежам графика, хранится
// частями в разных строках с общим createdAt — здесь склеиваем обратно.

const destinationKey = (e) => `${e.method || ''}|${e.card || ''}`;

export function contractReceipts(contract, rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    (row.paymentEvents || []).forEach((event, i) => {
      const amount = +event.amount || 0;
      if (!event?.date || amount <= 0) return;
      const date = String(event.date).slice(0, 10);
      const key = event.createdAt
        ? `${date}|${String(event.createdAt).slice(0, 19)}|${destinationKey(event)}`
        : `${date}|row${row.index}|${i}`;
      const g = groups.get(key);
      if (g) {
        g.amount += amount;
        if (!g.numbers.includes(row.n)) g.numbers.push(row.n);
        if (event.comment && !g.comment) g.comment = event.comment;
      } else {
        groups.set(key, {
          date, amount, numbers: [row.n], createdAt: event.createdAt || '',
          method: event.method || '', card: event.card || '',
          comment: event.comment || '', earlyPayoff: !!event.earlyPayoff,
        });
      }
    });
  });
  const list = [...groups.values()];
  const down = +contract?.downPayment || 0;
  if (down > 0) {
    const dest = contract.payments?.__downPaymentDestination || {};
    list.push({
      date: String(contract.contractDate || contract.startDate || '').slice(0, 10),
      amount: down, numbers: [], downPayment: true, createdAt: '',
      method: dest.method || '', card: dest.card || '', comment: '',
    });
  }
  return list
    .map((r) => ({ ...r, numbers: [...r.numbers].sort((a, b) => a - b) }))
    .sort((a, b) => a.date.localeCompare(b.date)
      || (b.downPayment ? 1 : 0) - (a.downPayment ? 1 : 0)
      || String(a.createdAt).localeCompare(String(b.createdAt))
      || (a.numbers[0] || 0) - (b.numbers[0] || 0));
}

export const receiptPurpose = (r) => r.downPayment
  ? 'Первоначальный взнос'
  : `${r.earlyPayoff ? 'Досрочно · ' : ''}${r.numbers.length > 1 ? 'Платежи' : 'Платёж'} №${r.numbers.join(', ')}`;

export const receiptMethod = (r) => r.method === 'cash' ? 'Наличные' : r.method === 'bank' ? `Безнал${r.card ? ` · ${r.card}` : ''}` : '';
