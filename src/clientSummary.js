import { normalizePhone } from './phone';

// A missing phone must not merge a namesake with a different known phone.
export function contractsForClient(contracts, client) {
  if (!client) return [];
  const phone = normalizePhone(client.phone);
  const name = String(client.clientName || '').trim().toLocaleLowerCase('ru');
  return contracts.filter(c => c.id === client.id || (phone
    ? normalizePhone(c.phone) === phone
    : !normalizePhone(c.phone) && name && String(c.clientName || '').trim().toLocaleLowerCase('ru') === name));
}
const dateKey = value => {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  return String(value || '').slice(0,10);
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function summarizeClient(contracts, getStats, today) {
  const items = contracts.map(contract => ({ contract, stats: getStats(contract) }));
  const paymentGroups = new Map(), upcoming = [], overdueDates = [];
  let remaining = 0, overdue = 0, undated = 0;
  for (const { contract, stats } of items) {
    remaining += Math.max(0, stats.remaining);
    overdue += Math.max(0, stats.overdueSum);
    for (const row of stats.rows) {
      const due = dateKey(row.dueDate);
      if (row.remainingDue > 0 && validDate(due)) {
        if (row.status === 'overdue') overdueDates.push(due);
        if (due >= today) upcoming.push({ contract, row, date: due, amount: row.remainingDue });
      }
      const events = row.paymentEvents?.length ? row.paymentEvents : [{ date: row.paidDate, amount: row.paidAmount }];
      for (const [index, event] of events.entries()) {
        if (!(+event.amount > 0)) continue;
        const date = dateKey(event.date);
        if (!validDate(date)) { undated += +event.amount; continue; }
        if (date > today) continue;
        // One receipt can be allocated across several schedule rows.
        const key = event.createdAt ? `${contract.id}:${date}:${event.createdAt}` : `${contract.id}:${row.n}:${index}`;
        const previous = paymentGroups.get(key);
        if (previous) { previous.amount += +event.amount; previous.numbers.push(row.n); }
        else paymentGroups.set(key, { contract, date, amount: +event.amount, numbers: [row.n], createdAt: event.createdAt || '', key });
      }
    }
  }
  upcoming.sort((a,b) => a.date.localeCompare(b.date) || String(a.contract.id).localeCompare(String(b.contract.id)));
  const payments = [...paymentGroups.values()].map(p => ({ ...p, paymentNo: [...new Set(p.numbers)].join(', ') }));
  payments.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  overdueDates.sort();
  const nextDate = upcoming[0]?.date;
  const next = upcoming.filter(p => p.date === nextDate);
  return { items, remaining, overdue, active: items.filter(i => i.stats.remaining > 0).length,
    overdueDays: overdueDates.length ? Math.max(0, Math.round((Date.parse(today)-Date.parse(overdueDates[0]))/86400000)) : 0,
    next, nextAmount: next.reduce((sum,p) => sum+p.amount,0), payments, lastPayment: payments[0] || null, undated };
}
