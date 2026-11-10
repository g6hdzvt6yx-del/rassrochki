// Реестр расходов: оплаты аренды, зарплаты, рекламы и т. п.
// У расхода две даты, как в учёте «по начислению»:
//  • date   — дата оплаты (когда деньги ушли): по ней считаются касса, «Свободно» и журнал денег;
//  • period — месяц расхода "YYYY-MM" (к какому месяцу относится): по нему считаются
//             аналитика расходов и чистая прибыль (netProfit.js, financialReport.js).
// Одна запись — одна выплата: смена периода не создаёт нового движения денег.

export const EXPENSE_CATEGORIES = [
  "Аренда", "Зарплата", "Реклама", "Связь и интернет", "Налоги",
  "Транспорт", "Хозяйственные", "Банк и комиссии", "Прочее",
];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthOf = (iso) => String(iso || "").slice(0, 7);
// Период записи; у старых записей без периода — месяц даты оплаты.
export const expensePeriod = (e) => (MONTH_RE.test(e?.period || "") ? e.period : monthOf(e?.date));
const periodStart = (e) => `${expensePeriod(e)}-01`;

export const expenseFromRow = (r) => ({
  id: r.id, date: r.date, period: monthOf(r.period) || monthOf(r.date), amount: Number(r.amount) || 0,
  category: r.category || "Прочее", paidFrom: r.paid_from || "", note: r.note || "",
  createdAt: r.created_at || "",
});

export const expenseToRow = (e) => ({
  id: e.id, date: e.date, period: `${expensePeriod(e)}-01`, amount: Number(e.amount),
  category: (e.category || "").trim() || "Прочее", paid_from: (e.paidFrom || "").trim(), note: (e.note || "").trim(),
});

// Проверка формы: возвращает текст ошибки или пустую строку.
export function validateExpense(e) {
  if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Укажите дату оплаты.";
  if (!MONTH_RE.test(e.period || "")) return "Выберите период расхода — месяц, к которому относится расход.";
  const amount = Number(String(e.amount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return "Сумма должна быть больше нуля.";
  if ((e.category || "").trim().length > 100) return "Название статьи — не длиннее 100 символов.";
  if ((e.paidFrom || "").trim().length > 100) return "Поле «Оплачено из» — не длиннее 100 символов.";
  if ((e.note || "").trim().length > 2000) return "Комментарий — не длиннее 2000 символов.";
  return "";
}

export const parseAmount = (value) => Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));

// Сдвиг месяца "YYYY-MM" на delta месяцев.
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const periodLabel = (month) => {
  if (!MONTH_RE.test(month || "")) return "";
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

// Месяцы для выбора периода: 3 года назад от месяца оплаты и 3 месяца вперёд, плюс уже выбранный.
export function periodOptions(paymentDate, selected = "") {
  const base = monthOf(paymentDate) || monthOf(new Date().toISOString());
  const list = [];
  for (let i = 3; i >= -36; i -= 1) list.push(shiftMonth(base, i));
  if (MONTH_RE.test(selected) && !list.includes(selected)) list.push(selected);
  return list.sort().reverse();
}

// Новые сверху; при одной дате — позже добавленные выше.
export const sortExpenses = (list, basis = "paid") => [...list].sort((a, b) =>
  (basis === "period" ? expensePeriod(b).localeCompare(expensePeriod(a)) : 0)
  || (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "") || String(b.id).localeCompare(String(a.id)));

// Попадает ли расход в отбор. basis: "paid" — по дате оплаты, "period" — по месяцу расхода
// (месяц считается попавшим, если в отбор входит его первое число — так соседние отчёты не задваивают расход).
export const expenseInRange = (e, from = "", to = "", basis = "paid") => {
  const key = basis === "period" ? periodStart(e) : e.date;
  return (!from || key >= from) && (!to || key <= to);
};

export function filterExpenses(list, { from = "", to = "", category = "", search = "", basis = "paid" } = {}) {
  if (from && to && from > to) return [];
  const q = search.trim().toLowerCase();
  return sortExpenses(list.filter((e) =>
    expenseInRange(e, from, to, basis) && (!category || e.category === category)
    && (!q || `${e.category} ${e.paidFrom} ${e.note}`.toLowerCase().includes(q))), basis);
}

// Итоги в копейках, чтобы не копить ошибки округления.
export function expenseTotals(list) {
  const cents = new Map();
  let total = 0;
  list.forEach((e) => {
    const c = Math.round((Number(e.amount) || 0) * 100);
    total += c;
    cents.set(e.category, (cents.get(e.category) || 0) + c);
  });
  const byCategory = [...cents.entries()].map(([category, c]) => ({ category, amount: c / 100 }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "ru"));
  return { total: total / 100, count: list.length, byCategory };
}

// Подсказки для полей: стандартные статьи плюс уже использованные.
export const categoryOptions = (list) => [...new Set([...EXPENSE_CATEGORIES, ...list.map((e) => e.category).filter(Boolean)])];
export const paidFromOptions = (list, cards = []) => [...new Set(["Наличные", ...cards, ...list.map((e) => e.paidFrom).filter(Boolean)])];

const ruDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");

export function buildExpensesWorkbook(XLSX, rows, { from = "", to = "", basis = "paid" } = {}) {
  const wb = XLSX.utils.book_new();
  const period = from || to ? `${from ? ruDate(from) : "начала"} — ${to ? ruDate(to) : "сегодня"}` : "всё время";
  const totals = expenseTotals(rows);
  const list = XLSX.utils.aoa_to_sheet([
    ["Дата оплаты", "Период расхода", "Статья", "Оплачено из", "Сумма", "Комментарий"],
    ...rows.map((e) => [ruDate(e.date), periodLabel(expensePeriod(e)), e.category, e.paidFrom, Number(e.amount), e.note]),
    [], ["", "", "Итого", "", totals.total, ""],
  ]);
  list["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, list, "Расходы");
  const summary = XLSX.utils.aoa_to_sheet([
    ["Отбор", period], ["Считается", basis === "period" ? "по периоду расхода (месяцу, к которому относится расход)" : "по дате оплаты"], [],
    ["Статья", "Сумма"], ...totals.byCategory.map((t) => [t.category, t.amount]), ["Итого", totals.total],
  ]);
  summary["!cols"] = [{ wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, summary, "По статьям");
  return wb;
}
