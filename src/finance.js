export function splitReceived(paidSum, principal, markup) {
  const received = Math.max(0, Math.round(+paidSum || 0));
  const principalValue = Math.max(0, Math.round(+principal || 0));
  const markupValue = Math.max(0, Math.round(+markup || 0));
  const financed = principalValue + markupValue;
  const profitReceived = financed > 0 ? Math.round((received * markupValue) / financed) : 0;
  return { received, principalReturned: received - profitReceived, profitReceived };
}

export function addMonthsClamped(dateString, months) {
  const source = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(source.getTime())) return new Date(NaN);
  const day = source.getDate();
  source.setDate(1);
  source.setMonth(source.getMonth() + months);
  const lastDay = new Date(source.getFullYear(), source.getMonth() + 1, 0).getDate();
  source.setDate(Math.min(day, lastDay));
  source.setHours(0, 0, 0, 0);
  return source;
}

export function splitScheduleAmount(total, parts) {
  const count = Math.max(1, Math.trunc(+parts || 1));
  const rounded = Math.max(0, Math.round(+total || 0));
  const base = Math.round(rounded / count);
  const amounts = Array(count).fill(base);
  amounts[count - 1] = rounded - base * (count - 1);
  return amounts;
}

// Границы произвольного периода включаются целиком, без преобразования часового пояса.
function inDateRange(value, range) {
  if (!range) return true;
  const date = String(value || "").slice(0, 10);
  return Boolean(range.from && range.to && range.from <= range.to
    && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= range.from && date <= range.to);
}

export function receivedSummary(contracts, getStats, month = "", range = null) {
  const rows = [];
  let received = 0, principalReturned = 0, profitReceived = 0;
  contracts.forEach((contract) => {
    const stats = getStats(contract);
    const principal = Math.max(0, (+contract.totalPrice || 0) - (+contract.downPayment || 0));
    const paidRows = stats.rows.flatMap((payment) => {
      const events = Array.isArray(payment.paymentEvents) && payment.paymentEvents.length
        ? payment.paymentEvents
        : (payment.paidAmount > 0 ? [{ date: payment.paidDate, amount: payment.paidAmount, legacy: true }] : []);
      return events.filter((event) => +event.amount > 0 && inDateRange(event.date, range) && (!month || String(event.date || "").slice(0, 7) === month))
        .map((event) => ({ payment, event }));
    });
    const periodPaid = paidRows.reduce((sum, row) => sum + (+row.event.amount || 0), 0);
    const split = splitReceived(periodPaid, principal, contract.markup);
    received += split.received;
    principalReturned += split.principalReturned;
    profitReceived += split.profitReceived;
    paidRows.forEach(({ payment, event }) => rows.push({
      contractId: contract.id,
      clientName: contract.clientName,
      item: contract.item || "",
      paymentNo: payment.n,
      paidDate: event.date,
      amount: +event.amount || 0,
    }));
  });
  rows.sort((a, b) => String(b.paidDate || "").localeCompare(String(a.paidDate || "")));
  return { received, principalReturned, profitReceived, rows, month, reconciled: received === principalReturned + profitReceived };
}

export function receivedProfitByMonth(contracts, getStats) {
  const allTime = receivedSummary(contracts, getStats);
  const months = [...new Set(allTime.rows
    .map((row) => String(row.paidDate || "").slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
  return months.map((month) => ({ month, ...receivedSummary(contracts, getStats, month) }));
}

// План включает полную сумму обязательства, даже если оно уже оплачено.
export function scheduledProfitSummary(contracts, getStats, month = "", range = null) {
  let scheduled = 0, profitScheduled = 0;
  const rows = [];
  contracts.forEach((contract) => {
    let amount = 0;
    getStats(contract).rows.forEach((payment) => {
      const date = payment.dueDate;
      const dueDate = date instanceof Date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : String(date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || (month && dueDate.slice(0, 7) !== month) || !inDateRange(dueDate, range)) return;
      const value = Math.max(0, +payment.amountDue || 0);
      amount += value;
      rows.push({ contractId: contract.id, clientName: contract.clientName, item: contract.item || "", paymentNo: payment.n, dueDate, amount: value });
    });
    const principal = Math.max(0, (+contract.totalPrice || 0) - (+contract.downPayment || 0));
    const split = splitReceived(amount, principal, contract.markup);
    scheduled += split.received;
    profitScheduled += split.profitReceived;
  });
  rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return { scheduled, profitScheduled, rows };
}

export function profitComparisonByMonth(contracts, getStats) {
  const actual = receivedProfitByMonth(contracts, getStats);
  const planned = scheduledProfitSummary(contracts, getStats);
  const months = [...new Set([...actual.map((row) => row.month), ...planned.rows.map((row) => row.dueDate.slice(0, 7))])].sort().reverse();
  return months.map((month) => ({ month,
    ...receivedSummary(contracts, getStats, month),
    profitScheduled: scheduledProfitSummary(contracts, getStats, month).profitScheduled,
  }));
}

export function investorProfitBreakdown(contracts, investors, withdrawals, getStats) {
  const knownIds = new Set(investors.map((investor) => investor.id));
  const groups = new Map();
  const ensure = (key, name, invested = 0) => {
    if (!groups.has(key)) groups.set(key, {
      key, name, invested, capitalInTurnover: 0, capitalReturned: 0,
      profitReceived: 0, profitExpected: 0, paidOut: 0, profitToPay: 0, contractCount: 0, contracts: [],
    });
    return groups.get(key);
  };
  investors.forEach((investor) => ensure(investor.id, investor.name, +investor.amount || 0));
  ensure("__pool__", "Общий пул");
  ensure("__unassigned__", "Без привязки к вкладчику");

  contracts.forEach((contract) => {
    const key = contract.investorId ? (knownIds.has(contract.investorId) ? contract.investorId : "__unassigned__") : "__pool__";
    const group = groups.get(key);
    const stats = getStats(contract);
    const principal = Math.max(0, (+contract.totalPrice || 0) - (+contract.downPayment || 0));
    const markup = Math.max(0, +contract.markup || 0);
    const split = splitReceived(stats.paidSum, principal, markup);
    group.capitalReturned += split.principalReturned;
    group.capitalInTurnover += Math.max(0, principal - split.principalReturned);
    group.profitReceived += split.profitReceived;
    group.profitExpected += Math.max(0, markup - split.profitReceived);
    group.contractCount += 1;
    group.contracts.push({ id: contract.id, clientName: contract.clientName, item: contract.item, ...split, profitExpected: Math.max(0, markup - split.profitReceived) });
  });
  withdrawals.filter((w) => w.purpose === "investor_payout").forEach((withdrawal) => {
    const key = withdrawal.investorId && knownIds.has(withdrawal.investorId) ? withdrawal.investorId : "__pool__";
    groups.get(key).paidOut += +withdrawal.amount || 0;
  });
  groups.forEach((group) => { group.profitToPay = Math.max(0, group.profitReceived - group.paidOut); });
  const list = [...groups.values()].filter((group) => group.invested || group.contractCount || group.paidOut);
  const totalProfitReceived = list.reduce((sum, group) => sum + group.profitReceived, 0);
  const expectedTotalProfitReceived = contracts.reduce((sum, contract) => {
    const principal = Math.max(0, (+contract.totalPrice || 0) - (+contract.downPayment || 0));
    return sum + splitReceived(getStats(contract).paidSum, principal, contract.markup).profitReceived;
  }, 0);
  const difference = totalProfitReceived - expectedTotalProfitReceived;
  return { groups: list, totalProfitReceived, expectedTotalProfitReceived, difference, reconciled: difference === 0 };
}
