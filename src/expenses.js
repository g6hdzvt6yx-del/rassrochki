// Реестр расходов: оплаты аренды, зарплаты, рекламы и т. п.
// Вычитаются из прибыли собственника (netProfit.js) и уменьшают «Свободно» в «Капитале».

export const EXPENSE_CATEGORIES = [
  "Аренда", "Зарплата", "Реклама", "Связь и интернет", "Налоги",
  "Транспорт", "Хозяйственные", "Банк и комиссии", "Прочее",
];

export const expenseFromRow = (r) => ({
  id: r.id, date: r.date, amount: Number(r.amount) || 0,
  category: r.category || "Прочее", paidFrom: r.paid_from || "", note: r.note || "",
  createdAt: r.created_at || "",
});

export const expenseToRow = (e) => ({
  id: e.id, date: e.date, amount: Number(e.amount),
  category: (e.category || "").trim() || "Прочее", paid_from: (e.paidFrom || "").trim(), note: (e.note || "").trim(),
});

// Проверка формы: возвращает текст ошибки или пустую строку.
export function validateExpense(e) {
  if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Укажите дату оплаты.";
  const amount = Number(String(e.amount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return "Сумма должна быть больше нуля.";
  if ((e.category || "").trim().length > 100) return "Название статьи — не длиннее 100 символов.";
  if ((e.paidFrom || "").trim().length > 100) return "Поле «Оплачено из» — не длиннее 100 символов.";
  if ((e.note || "").trim().length > 2000) return "Комментарий — не длиннее 2000 символов.";
  return "";
}

export const parseAmount = (value) => Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));

// Новые сверху; при одной дате — позже добавленные выше.
export const sortExpenses = (list) => [...list].sort((a, b) =>
  (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "") || String(b.id).localeCompare(String(a.id)));

export function filterExpenses(list, { from = "", to = "", category = "", search = "" } = {}) {
  if (from && to && from > to) return [];
  const q = search.trim().toLowerCase();
  return sortExpenses(list.filter((e) =>
    (!from || e.date >= from) && (!to || e.date <= to) && (!category || e.category === category)
    && (!q || `${e.category} ${e.paidFrom} ${e.note}`.toLowerCase().includes(q))));
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

export function buildExpensesWorkbook(XLSX, rows, { from = "", to = "" } = {}) {
  const wb = XLSX.utils.book_new();
  const period = from || to ? `${from ? ruDate(from) : "начала"} — ${to ? ruDate(to) : "сегодня"}` : "всё время";
  const totals = expenseTotals(rows);
  const list = XLSX.utils.aoa_to_sheet([
    ["Дата", "Статья", "Оплачено из", "Сумма", "Комментарий"],
    ...rows.map((e) => [ruDate(e.date), e.category, e.paidFrom, Number(e.amount), e.note]),
    [], ["", "Итого", "", totals.total, ""],
  ]);
  list["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, list, "Расходы");
  const summary = XLSX.utils.aoa_to_sheet([
    ["Период", period], [],
    ["Статья", "Сумма"], ...totals.byCategory.map((t) => [t.category, t.amount]), ["Итого", totals.total],
  ]);
  summary["!cols"] = [{ wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, summary, "По статьям");
  return wb;
}
