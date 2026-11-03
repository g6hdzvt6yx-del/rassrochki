const dateKey = value => value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : String(value || "").slice(0, 10);
export const dateInPeriod = (value, from, to) => {
  const date = dateKey(value);
  return Boolean(from && to && from <= to && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= from && date <= to);
};
export function expectedPayments(contracts, getStats, from, to = from) {
  const rows = [];
  contracts.forEach(contract => {
    const stats = getStats(contract);
    stats.rows.forEach(payment => {
      if (payment.paid || !dateInPeriod(payment.dueDate, from, to)) return;
      rows.push({
        contractId: contract.id, clientName: contract.clientName, phone: contract.phone || "",
        item: contract.item || "", paymentNo: payment.n, amount: payment.amountDue,
        dueDate: dateKey(payment.dueDate), paidAmount: payment.paidAmount, remaining: payment.remainingDue,
        totalDebt: stats.remaining, overdueDebt: stats.overdueSum,
        status: payment.status, notifiedAt: payment.notifiedAt,
      });
    });
  });
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName, "ru"));
  return { rows, clients: new Set(rows.map(row => row.clientName.trim().toLocaleLowerCase("ru"))).size,
    remaining: rows.reduce((sum, row) => sum + row.remaining, 0) };
}

// Кто должен был заплатить за период по графику — включая тех, кто уже оплатил.
// Клиент считается «оплатившим», если все его платежи со сроком в периоде закрыты полностью.
export function duePeriodSummary(contracts, getStats, from, to = from) {
  const clients = new Map();
  const rows = [];
  const contractIds = { all: new Set(), paid: new Set(), unpaid: new Set() };
  let scheduled = 0, paid = 0, payments = 0;
  contracts.forEach(contract => {
    let contractDue = 0, contractLeft = 0;
    const contractRows = [];
    getStats(contract).rows.forEach(payment => {
      if (!dateInPeriod(payment.dueDate, from, to)) return;
      const amount = Math.max(0, +payment.amountDue || 0);
      const left = Math.max(0, Math.min(amount, +payment.remainingDue || 0));
      payments += 1; scheduled += amount; paid += amount - left;
      contractDue += 1; contractLeft += left;
      const events = Array.isArray(payment.paymentEvents) ? payment.paymentEvents : [];
      const lastPaid = events.map(e => String(e?.date || "").slice(0, 10)).filter(Boolean).sort().pop() || (payment.paidDate ? String(payment.paidDate).slice(0, 10) : "");
      contractRows.push({
        contractId: contract.id, clientName: contract.clientName || "", phone: contract.phone || "", item: contract.item || "",
        investorId: contract.investorId || "", paymentNo: payment.n, dueDate: dateKey(payment.dueDate),
        amount, paid: amount - left, remaining: left, lastPaidDate: amount - left > 0 ? lastPaid : "",
        state: left <= 0 ? "paid" : amount - left > 0 ? "partial" : "unpaid", overdue: left > 0 && payment.status === "overdue",
      });
    });
    if (!contractDue) return;
    const key = String(contract.clientName || "").trim().toLocaleLowerCase("ru") || `#${contract.id}`;
    clients.set(key, (clients.get(key) || 0) + contractLeft);
    contractIds.all.add(contract.id);
    contractIds[contractLeft > 0 ? "unpaid" : "paid"].add(contract.id);
    rows.push(...contractRows);
  });
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName, "ru") || a.paymentNo - b.paymentNo);
  const left = [...clients.values()];
  return {
    clients: left.length, paidClients: left.filter(sum => sum <= 0).length, unpaidClients: left.filter(sum => sum > 0).length,
    payments, scheduled, paid, remaining: scheduled - paid, contractIds, rows,
  };
}

// Границы календарного месяца "YYYY-MM" → ["YYYY-MM-01", "YYYY-MM-последний день"].
export function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return ["", ""];
  const [year, m] = month.split("-").map(Number);
  const last = new Date(year, m, 0).getDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

export function shiftMonth(month, delta) {
  const [year, m] = String(month).split("-").map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
