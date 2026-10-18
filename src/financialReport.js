import { splitReceived } from './finance';

const day = (value) => String(value || '').slice(0, 10);
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function buildFinancialReport({ contracts, investors, withdrawals, getStats, from, to, investorId = '', asOf }) {
  if (!validDay(from) || !validDay(to) || from > to) throw new Error('Укажите корректный период отчёта.');
  if (to > asOf) throw new Error('Конец периода не может быть позже сегодняшней даты.');
  if (investorId && !investors.some(i => i.id === investorId)) throw new Error('Вкладчик не найден.');
  const within = date => validDay(day(date)) && day(date) >= from && day(date) <= to;
  const selected = contracts.filter(c => !investorId || c.investorId === investorId);
  const payments = [], portfolio = [];
  let received = 0, principalReturned = 0, profitReceived = 0, undated = 0;
  for (const c of selected) {
    const contractName = `${String(c.clientName || '').trim() || 'Клиент не указан'} — ${String(c.item || '').trim() || 'Товар не указан'}`;
    const stats = getStats(c);
    const principal = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0));
    let amount = 0;
    for (const row of stats.rows) {
      const events = row.paymentEvents?.length ? row.paymentEvents : [{ date: row.paidDate, amount: row.paidAmount }];
      for (const event of events) {
        if (!(+event.amount > 0)) continue;
        if (!validDay(day(event.date))) { undated += +event.amount; continue; }
        if (!within(event.date)) continue;
        amount += +event.amount;
        payments.push({ contractId: c.id, contractName, date: day(event.date), paymentNo: row.n, amount: +event.amount });
      }
    }
    const split = splitReceived(amount, principal, c.markup);
    received += split.received; principalReturned += split.principalReturned; profitReceived += split.profitReceived;
    const total = splitReceived(stats.paidSum, principal, c.markup);
    portfolio.push({ id: c.id, contractName, capital: Math.max(0, principal - total.principalReturned), remaining: Math.max(0, stats.remaining), overdue: stats.overdueSum, expected: Math.max(0, (+c.markup || 0) - total.profitReceived) });
  }
  const outflows = withdrawals.filter(w => (!investorId || (w.investorId === investorId && w.purpose === 'investor_payout')) && within(w.date));
  const sumPurpose = purpose => outflows.filter(w => w.purpose === purpose).reduce((s, w) => s + (+w.amount || 0), 0);
  const sum = key => portfolio.reduce((s, c) => s + c[key], 0);
  return { from, to, asOf, investorId, audience: investorId ? investors.find(i => i.id === investorId).name : 'Собственник — весь портфель', received, principalReturned, profitReceived, undated, payments: payments.sort((a,b) => a.date.localeCompare(b.date)), portfolio, outflows,
    investorPayout: sumPurpose('investor_payout'), ownerPayout: sumPurpose('owner'), restock: sumPurpose('restock'), other: sumPurpose('other'),
    capital: sum('capital'), remaining: sum('remaining'), overdue: sum('overdue'), expected: sum('expected') };
}

export function reportMetrics(r) {
  return [ ['Получено платежей за период', r.received], ['Возврат основного капитала за период', r.principalReturned], ['Полученная наценка за период', r.profitReceived], ['Выплачено инвесторам за период', r.investorPayout],
    ...(!r.investorId ? [['Выплачено собственнику за период', r.ownerPayout], ['Выводы на закупку за период', r.restock], ['Прочие выводы за период', r.other]] : []),
    ['Капитал в рассрочках на сегодня', r.capital], ['Остаток платежей на сегодня', r.remaining], ['Просрочка на сегодня', r.overdue], ['Неполученная наценка на сегодня', r.expected] ];
}
export const REPORT_NOTE = 'Управленческий отчёт. Наценка распределяется пропорционально платежам и не является чистой прибылью или суммой к выплате инвестору. Первоначальные взносы и внесения капитала не входят в поступления. Остатки рассчитаны на дату формирования по текущим данным, а не на конец выбранного периода. Договоры общего пула не распределяются между инвесторами автоматически.';
export function buildFinancialReportWorkbook(XLSX, r) {
  const wb = XLSX.utils.book_new();
  const append = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  append('Итоги', [['Финансовый отчёт', r.audience], ['Период', `${r.from} — ${r.to}`], ['Дата формирования', r.asOf], ['Валюта', 'RUB'], [], ...reportMetrics(r), [], ['Платежи без корректной даты (исключены из периода)', r.undated], ['Методика', REPORT_NOTE]], [62, 85]);
  append('Платежи', [['Договор', 'Дата', 'Номер платежа', 'Сумма, ₽'], ...r.payments.map(p => [p.contractName, p.date, p.paymentNo, p.amount])], [64, 16, 18, 20]);
  append('Портфель на сегодня', [['Договор', 'Капитал, ₽', 'Остаток, ₽', 'Просрочка, ₽', 'Ожидаемая наценка, ₽'], ...r.portfolio.map(c => [c.contractName, c.capital, c.remaining, c.overdue, c.expected])], [64, 20, 20, 20, 24]);
  const labels = { owner: 'Собственнику', investor_payout: 'Инвестору', restock: 'Закупка', other: 'Прочее' };
  append('Выплаты', [['Дата', 'Назначение', 'Сумма, ₽'], ...r.outflows.map(w => [w.date, labels[w.purpose] || w.purpose, +w.amount || 0])], [18, 26, 22]);
  return wb;
}
