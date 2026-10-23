const byDueDate = (left, right) => {
  const dateDifference = new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
  return dateDifference || left.index - right.index;
};

/**
 * Распределяет одно фактическое поступление по графику договора.
 * Порядок: старые просрочки -> выбранный платёж -> следующие платежи.
 */
export const allocateContractPayment = ({ payments = {}, rows = [], selectedIndex, amount, date, createdAt, comment = "", destination = {} }) => {
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
    const event = { date, amount: allocated, createdAt, ...destination };
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

// Edit one receipt within a schedule row, preserving other receipts and metadata.
export function editPaymentEvent({payments, row, eventIndex, expectedRecord, amount, date, comment, destination}) {
  const current = payments[row.index];
  if (JSON.stringify(current) !== JSON.stringify(expectedRecord)) throw new Error('Платёж изменился. Закройте форму и откройте заново.');
  const events = current?.paymentEvents?.length ? current.paymentEvents : row.paymentEvents;
  if (!events?.[eventIndex]) throw new Error('Поступление не найдено');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Укажите корректную дату');
  const total = events.reduce((sum,e,i)=>sum+(i===eventIndex ? value : Number(e.amount)),0);
  if (total > row.amountDue + 0.001) throw new Error('Сумма поступлений превышает платёж по графику. Для дополнительной оплаты используйте «Доплатить» или следующий платёж.');
  const nextEvents = events.map((event,i)=> {
    if (i !== eventIndex) return event;
    const {method,card,...rest}=event;
    return {...rest,amount:value,date,comment:String(comment || '').trim(),...destination,updatedAt:new Date().toISOString()};
  });
  const record = {...current,paymentEvents:nextEvents,paidDate:nextEvents.map(e=>e.date).sort().at(-1)};
  if (total >= row.amountDue) delete record.paidAmount;
  else record.paidAmount=total;
  return {...payments,[row.index]:record};
}

export function deletePaymentEvent({payments, row, eventIndex, expectedRecord}) {
  const current = payments[row.index];
  if (JSON.stringify(current) !== JSON.stringify(expectedRecord)) throw new Error('Платёж изменился. Закройте форму и откройте заново.');
  const events = current?.paymentEvents?.length ? current.paymentEvents : row.paymentEvents;
  if (!Number.isInteger(eventIndex) || !events?.[eventIndex]) throw new Error('Поступление не найдено');
  const nextEvents = events.filter((_,i)=>i !== eventIndex);
  const {paidDate,paidAmount,paymentEvents,...metadata} = current;
  const next = {...payments};
  if (!nextEvents.length) {
    if (Object.keys(metadata).length) next[row.index] = metadata;
    else delete next[row.index];
  } else {
    const total = nextEvents.reduce((sum,e)=>sum+Number(e.amount),0);
    next[row.index] = {...metadata,paymentEvents:nextEvents,paidDate:nextEvents.map(e=>e.date).sort().at(-1)};
    if (total < row.amountDue) next[row.index].paidAmount=total;
  }
  return next;
}
