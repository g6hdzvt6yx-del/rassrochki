// Общий журнал денег: что пришло от клиентов и что ушло (расходы и выводы) за период.
import { cashEntries, destinationLabel } from "./cash";
import { expenseInRange, expensePeriod, periodLabel } from "./expenses";

const day = (value) => String(value || "").slice(0, 10);
const cents = (n) => Math.round((Number(n) || 0) * 100);

export function moneyJournal({ contracts = [], expenses = [], withdrawals = [], investors = [], purposes = {} }) {
  const investorName = (id) => investors.find((i) => i.id === id)?.name || "";
  const incoming = cashEntries(contracts).map((e) => ({
    key: `in:${e.id}`, kind: "in", date: day(e.date), amount: Number(e.amount) || 0,
    title: e.client || "Клиент", detail: [e.purpose, e.item].filter(Boolean).join(" · "), via: destinationLabel(e),
    note: e.comment || "", contractId: e.contractId,
  }));
  const spent = expenses.map((e) => ({
    key: `ex:${e.id}`, kind: "expense", date: day(e.date), period: expensePeriod(e), amount: Number(e.amount) || 0,
    title: e.category || "Расход", detail: `Расход за ${periodLabel(expensePeriod(e)).toLowerCase()}`, via: e.paidFrom || "", note: e.note || "", expense: e,
  }));
  const out = withdrawals.map((w) => ({
    key: `wd:${w.id}`, kind: "withdrawal", date: day(w.date), amount: Number(w.amount) || 0,
    title: purposes[w.purpose] || "Вывод", detail: ["Вывод", investorName(w.investorId)].filter(Boolean).join(" · "),
    via: "", note: w.note || "",
  }));
  return [...incoming, ...spent, ...out];
}

export const JOURNAL_KINDS = { all: "Всё", in: "Поступления", out: "Списания" };

// basis: "paid" — всё по дате движения денег; "period" — расходы по месяцу расхода, остальное по дате.
export function filterJournal(list, { from = "", to = "", kind = "all", search = "", basis = "paid" } = {}) {
  if (from && to && from > to) return [];
  const q = search.trim().toLowerCase();
  const inRange = (e) => (basis === "period" && e.kind === "expense" ? expenseInRange(e.expense, from, to, "period")
    : (!from || e.date >= from) && (!to || e.date <= to));
  return list.filter((e) => inRange(e)
    && (kind === "all" || (kind === "in" ? e.kind === "in" : e.kind !== "in"))
    && (!q || `${e.title} ${e.detail} ${e.via} ${e.note}`.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (a.kind === "in" ? -1 : 0) - (b.kind === "in" ? -1 : 0) || a.key.localeCompare(b.key));
}

export function journalTotals(list) {
  let inc = 0, exp = 0, wd = 0;
  list.forEach((e) => { if (e.kind === "in") inc += cents(e.amount); else if (e.kind === "expense") exp += cents(e.amount); else wd += cents(e.amount); });
  return { incoming: inc / 100, expenses: exp / 100, withdrawals: wd / 100, outgoing: (exp + wd) / 100, balance: (inc - exp - wd) / 100 };
}

const ruDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const KIND_LABEL = { in: "Поступление", expense: "Расход", withdrawal: "Вывод" };

// cashRows — те же отборы строго по датам движения денег: «Пришло − ушло» считается только по ним.
export function buildJournalWorkbook(XLSX, rows, { from = "", to = "", basis = "paid", cashRows = rows } = {}) {
  const wb = XLSX.utils.book_new();
  const t = journalTotals(rows);
  const cash = journalTotals(cashRows);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Дата оплаты", "Тип", "Кто / статья", "Подробно", "Период расхода", "Куда / откуда", "Пришло", "Ушло", "Комментарий"],
    ...rows.map((e) => [ruDate(e.date), KIND_LABEL[e.kind], e.title, e.detail, e.period ? periodLabel(e.period) : "", e.via, e.kind === "in" ? e.amount : "", e.kind === "in" ? "" : e.amount, e.note]),
    [], ["", "", "Итого", "", "", "", t.incoming, t.outgoing, ""], ["", "", "Пришло − ушло (деньги за эти даты)", "", "", "", cash.balance, "", ""],
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 34 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Журнал денег");
  const period = from || to ? `${from ? ruDate(from) : "начала"} — ${to ? ruDate(to) : "сегодня"}` : "всё время";
  const summary = XLSX.utils.aoa_to_sheet([["Отбор", period], ["Расходы считаются", basis === "period" ? "по периоду расхода" : "по дате оплаты"], [],
    ["Пришло от клиентов", t.incoming], [basis === "period" ? "Расходы за период (по месяцу расхода)" : "Расходы оплачено", t.expenses], ["Выводы", t.withdrawals],
    ["Пришло − ушло (деньги за эти даты)", cash.balance]]);
  summary["!cols"] = [{ wch: 38 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, summary, "Итоги");
  return wb;
}
