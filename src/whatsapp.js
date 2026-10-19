const money = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const fmtDate = (d) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));

// ссылка wa.me с предзаполненным напоминанием; null, если номер не похож на российский
export const waReminderLink = (phone, name, item, amount, dueDate, status, overdueRows = []) => {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  else if (d.length === 10) d = "7" + d;
  if (d.length !== 11 || d[0] !== "7") return null;
  const overdue = status === "overdue";
  const debts = overdueRows.filter((row) => row.status === "overdue" && row.remainingDue > 0);
  const debtBreakdown = debts.length > 1
    ? [
      "Просроченные платежи:",
      ...debts.map((row, index) => `${index + 1}. ${fmtDate(row.dueDate)} — ${money(row.remainingDue)}`),
      `Общая сумма просрочки: ${money(debts.reduce((sum, row) => sum + row.remainingDue, 0))}`,
    ]
    : [`Дата платежа: ${fmtDate(dueDate)}`, `Сумма платежа: ${money(amount)}`];
  const text = [
    "Ассаламу 1алайкум! Компания «Apple Finans» Уведомляет вас",
    name ? `Уважаемый(ая) ${name}!` : "",
    "",
    item ? `Товар: ${item}` : "",
    ...debtBreakdown,
    "",
    overdue
      ? "По вашему договору образовалась просрочка платежа. Просим вас внести просроченный платёж в ближайшее время."
      : "Напоминаем о предстоящем платеже по вашему договору. Просим внести платёж до указанной даты.",
  ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n");
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

export function operatorReminderLink(client) {
  const pending = client.schedule.filter(p => p.remaining > 0).sort((a, b) => a.due - b.due);
  const next = pending.find(p => p.overdue) || pending[0];
  if (!next) return null;
  const debts = pending.filter(p => p.overdue).map(p => ({status: 'overdue', remainingDue: p.remaining, dueDate: p.due}));
  return waReminderLink(client.phone, client.clientName, client.item, next.remaining, next.due, next.overdue ? 'overdue' : 'upcoming', debts);
}
