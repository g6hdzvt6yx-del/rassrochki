// Цифры справки и итогов Excel — без PDF-библиотек, чтобы не тянуть их в выгрузку Excel.
export const REPORT_GROUP_LABELS = { all: "все, кто должен был оплатить", paid: "оплатили полностью", unpaid: "не оплатили или частично" };

// Цифры справки для руководителя. list — выбранная плитка (all / paid / unpaid или пусто):
// справка строится только по договорам этой группы. receipts — поступления за период (periodReceipts).
// Клиент с несколькими договорами считается один раз.
export function duePeriodReportData(summary, { list = "", receipts = null } = {}) {
  const ids = list && summary.contractIds[list];
  const rows = ids ? summary.rows.filter((row) => ids.has(row.contractId)) : summary.rows;
  const byClient = new Map();
  let profitDue = 0, profitPaid = 0;
  rows.forEach((row) => {
    profitDue += row.amount * (row.profitShare || 0);
    profitPaid += row.paid * (row.profitShare || 0);
    const key = row.clientName.trim().toLocaleLowerCase("ru") || `#${row.contractId}`;
    if (!byClient.has(key)) byClient.set(key, {
      name: row.clientName.trim(), phone: row.phone, scheduled: 0, paid: 0, remaining: 0,
      payments: 0, firstUnpaid: "", lastPaidDate: "", overdue: false,
    });
    const c = byClient.get(key);
    c.scheduled += row.amount; c.paid += row.paid; c.remaining += row.remaining; c.payments += 1;
    if (!c.phone && row.phone) c.phone = row.phone;
    if (row.remaining > 0 && (!c.firstUnpaid || row.dueDate < c.firstUnpaid)) c.firstUnpaid = row.dueDate;
    if (row.lastPaidDate > c.lastPaidDate) c.lastPaidDate = row.lastPaidDate;
    if (row.overdue) c.overdue = true;
  });
  const clients = [...byClient.values()];
  const full = clients.filter((c) => c.remaining <= 0);
  const partial = clients.filter((c) => c.remaining > 0 && c.paid > 0);
  const none = clients.filter((c) => c.remaining > 0 && c.paid <= 0);
  const sum = (list, key) => list.reduce((total, c) => total + c[key], 0);
  const scheduled = sum(clients, "scheduled"), paid = sum(clients, "paid"), remaining = sum(clients, "remaining");
  const dueProfit = Math.round(profitDue), paidProfit = Math.min(dueProfit, Math.round(profitPaid));
  return {
    list: list || "all",
    due: { clients: clients.length, sum: scheduled, payments: sum(clients, "payments"), profit: dueProfit },
    paid: { clients: full.length + partial.length, sum: paid, full: full.length, partial: partial.length, profit: paidProfit },
    remaining: { clients: partial.length + none.length, sum: remaining, partial: partial.length, none: none.length, profit: dueProfit - paidProfit },
    receipts,
    overdueClients: clients.filter((c) => c.overdue).length,
    collectedPercent: scheduled > 0 ? Math.round((paid / scheduled) * 1000) / 10 : 0,
    debtors: [...partial, ...none].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "ru")),
    paidClients: full.sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}
