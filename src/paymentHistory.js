// Таблица фактических оплат по договору: одна строка — одна оплата,
// как её вводили (amount — вся внесённая сумма). due и remaining —
// сумма по графику и остаток платежа, в который дошли деньги.
// Оплата, разнесённая по нескольким платежам, хранится частями
// с общим createdAt — здесь они склеиваются, разбивка лежит в splits.

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

  // Склеиваем части одной оплаты: фактическая сумма — вся внесённая сумма,
  // «Сумма» и «Остаток» — по последнему платежу, куда дошли деньги,
  // а разбивка по платежам уходит в комментарий.
  const groups = new Map();
  parts.forEach((p) => {
    const g = groups.get(p.key);
    if (!g) { groups.set(p.key, { ...p, splits: [{ n: p.numbers[0], amount: p.amount }] }); return; }
    g.amount += p.amount;
    g.splits.push({ n: p.numbers[0], amount: p.amount });
    if (p.numbers[0] > g.numbers[g.numbers.length - 1]) { g.due = p.due; g.remaining = p.remaining; }
    g.numbers = [...new Set([...g.numbers, ...p.numbers])].sort((x, y) => x - y);
    if (!g.comment && p.comment) g.comment = p.comment;
    g.earlyPayoff = g.earlyPayoff || p.earlyPayoff;
  });
  const receipts = [...groups.values()].map((g) => {
    const splits = g.splits.sort((x, y) => x.n - y.n);
    return splits.length > 1 ? { ...g, splits } : { ...g, splits: [] };
  });

  const down = +contract?.downPayment || 0;
  if (down > 0) {
    const dest = contract.payments?.__downPaymentDestination || {};
    receipts.push({
      date: String(contract.contractDate || contract.startDate || '').slice(0, 10),
      due: down, amount: down, remaining: 0, numbers: [], downPayment: true, createdAt: '',
      method: dest.method || '', card: dest.card || '', comment: '', key: 'down', splits: [],
    });
  }
  return receipts.sort((a, b) => a.date.localeCompare(b.date)
    || (b.downPayment ? 1 : 0) - (a.downPayment ? 1 : 0)
    || String(a.createdAt).localeCompare(String(b.createdAt))
    || (a.numbers[0] || 0) - (b.numbers[0] || 0));
}

export const receiptPurpose = (r) => r.downPayment
  ? 'Первоначальный взнос'
  : `${r.earlyPayoff ? 'Досрочно · ' : ''}${r.numbers.length > 1 ? 'Платежи' : 'Платёж'} №${r.numbers.join(', ')}`;

export const receiptMethod = (r) => r.method === 'cash' ? 'Наличные' : r.method === 'bank' ? `Безнал${r.card ? ` · ${r.card}` : ''}` : '';

// «Способ / комментарий»: если оплата закрыла несколько платежей —
// сколько зачтено в каждый, затем способ оплаты и комментарий.
export const receiptNote = (r, money) => [
  (r.splits || []).map((s) => `в №${s.n} — ${money(s.amount)}`).join(', '),
  receiptMethod(r),
  r.comment,
].filter(Boolean).join(' · ');
