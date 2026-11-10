import { buildFinancialReport } from "./financialReport.js";

// Чистая прибыль собственника за период (кассовый метод, всё по датам):
// полученная наценка − выплаты вкладчикам − расходы из реестра.
// Вкладчики в расходах не участвуют, поэтому расходы вычитаются только из части собственника.
export function ownerNetProfit({ contracts, withdrawals, expenses = [], getStats, from, to }) {
  const r = buildFinancialReport({ contracts, investors: [], withdrawals, expenses, getStats, from, to, asOf: to });
  return { from, to, profitReceived: r.profitReceived, investorPayout: r.investorPayout, expenses: r.expenses, net: r.netProfit };
}

const pad = (n) => String(n).padStart(2, "0");
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Границы месяца "YYYY-MM"; текущий месяц — по сегодняшний день.
export function monthPeriod(month, today = localDay()) {
  const [y, m] = month.split("-").map(Number);
  const last = `${month}-${pad(new Date(y, m, 0).getDate())}`;
  return { from: `${month}-01`, to: last > today ? today : last };
}

export function shiftMonthKey(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export const monthTitle = (month) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)).replace(" г.", "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
