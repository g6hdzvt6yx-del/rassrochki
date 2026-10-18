const byDueDate = (left, right) => {
  const dateDifference = new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
  return dateDifference || left.index - right.index;
};

/**
 * Распределяет одно фактическое поступление по графику договора.
 * Порядок: старые просрочки -> выбранный платёж -> следующие платежи.
 */
export const allocateContractPayment = ({ payments = {}, rows = [], selectedIndex, amount, date, createdAt, comment = "" }) => {
  const requestedAmount = Math.max(0, Number(amount) || 0);
  const paymentComment = String(comment || "").trim();
  const eligible = rows.filter((row) => !row.paid && row.remainingDue > 0);
  const overdue = eligible.filter((row) => row.status === "overdue").sort(byDueDate);
  const selected = eligible.find((row) => row.index === selectedIndex);
  const alreadyQueued = new Set(overdue.map((row) => row.index));
  const ordered = [...overdue];

  if (selected && !alreadyQueued.has(selected.index)) {
    ordered.push(selected);
    alreadyQueued.add(selected.index);
  }
  eligible.sort(byDueDate).forEach((row) => {
    if (!alreadyQueued.has(row.index)) ordered.push(row);
  });

  const nextPayments = { ...payments };
  const allocations = [];
  let remainder = requestedAmount;

  for (const row of ordered) {
    if (remainder <= 0) break;
    const allocated = Math.min(remainder, row.remainingDue);
    if (allocated <= 0) continue;

    const current = nextPayments[row.index] || {};
    const previousEvents = Array.isArray(current.paymentEvents) && current.paymentEvents.length
      ? [...current.paymentEvents]
      : (row.paidAmount > 0 && current.paidDate
        ? [{ date: current.paidDate, amount: row.paidAmount, legacy: true }]
        : []);
    const totalPaid = row.paidAmount + allocated;
    const event = { date, amount: allocated, createdAt };
    if (paymentComment) event.comment = paymentComment;
    const record = {
      ...current,
      paidDate: date,
      paymentEvents: [...previousEvents, event],
    };
    if (totalPaid >= row.amountDue) delete record.paidAmount;
    else record.paidAmount = totalPaid;

    nextPayments[row.index] = record;
    allocations.push({
      index: row.index,
      number: row.n,
      amount: allocated,
      totalPaid,
      full: totalPaid >= row.amountDue,
      before: current,
      after: record,
    });
    remainder -= allocated;
  }

  return {
    payments: nextPayments,
    allocations,
    requestedAmount,
    appliedAmount: requestedAmount - remainder,
    remainder,
  };
};
