// Общий журнал денег: что пришло от клиентов и что ушло (расходы и выводы) за период.
import { cashEntries, destinationLabel } from "./cash";

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
    key: `ex:${e.id}`, kind: "expense", date: day(e.date), amount: Number(e.amount) || 0,
    title: e.category || "Расход", detail: "Расход", via: e.paidFrom || "", note: e.note || "", expense: e,
  }));
  const out = withdrawals.map((w) => ({
    key: `wd:${w.id}`, kind: "withdrawal", date: day(w.date), amount: Number(w.amount) || 0,
    title: purposes[w.purpose] || "Вывод", detail: ["Вывод", investorName(w.investorId)].filter(Boolean).join(" · "),
    via: "", note: w.note || "",
  }));
  return [...incoming, ...spent, ...out];
}

export const JOURNAL_KINDS = { all: "Всё", in: "Поступления", out: "Списания" };

export function filterJournal(list, { from = "", to = "", kind = "all", search = "" } = {}) {
  if (from && to && from > to) return [];
  const q = search.trim().toLowerCase();
  return list.filter((e) => (!from || e.date >= from) && (!to || e.date <= to)
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

export function buildJournalWorkbook(XLSX, rows, { from = "", to = "" } = {}) {
  const wb = XLSX.utils.book_new();
  const t = journalTotals(rows);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Дата", "Тип", "Кто / статья", "Подробно", "Куда / откуда", "Пришло", "Ушло", "Комментарий"],
    ...rows.map((e) => [ruDate(e.date), KIND_LABEL[e.kind], e.title, e.detail, e.via, e.kind === "in" ? e.amount : "", e.kind === "in" ? "" : e.amount, e.note]),
    [], ["", "", "Итого", "", "", t.incoming, t.outgoing, ""], ["", "", "Разница (пришло − ушло)", "", "", t.balance, "", ""],
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 34 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Журнал денег");
  const period = from || to ? `${from ? ruDate(from) : "начала"} — ${to ? ruDate(to) : "сегодня"}` : "всё время";
  const summary = XLSX.utils.aoa_to_sheet([["Период", period], [], ["Пришло от клиентов", t.incoming], ["Расходы", t.expenses], ["Выводы", t.withdrawals], ["Разница", t.balance]]);
  summary["!cols"] = [{ wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, summary, "Итоги");
  return wb;
}
