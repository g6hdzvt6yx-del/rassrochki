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
