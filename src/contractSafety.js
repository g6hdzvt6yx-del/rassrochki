import { splitScheduleAmount } from './finance';

export function actualPaid(record, scheduledAmount) {
  if (Array.isArray(record?.paymentEvents) && record.paymentEvents.length) {
    return record.paymentEvents.reduce((sum, event) => sum + Math.max(0, Number(event.amount) || 0), 0);
  }
  if (!record?.paidDate) return 0;
  return record.paidAmount == null ? scheduledAmount : Math.max(0, Number(record.paidAmount) || 0);
}

const amounts = (contract) => splitScheduleAmount(
  Math.max(0, (+contract.totalPrice || 0) - (+contract.downPayment || 0) + (+contract.markup || 0)),
  contract.termMonths,
);

// Freeze legacy full payments BEFORE recalculating the schedule. Never delete history.
export function prepareContractEdit(original, changes) {
  const updated = { ...original, ...changes, payments: { ...(original.payments || {}) } };
  const oldAmounts = amounts(original);
  const nextAmounts = amounts(updated);
  for (const [key, record] of Object.entries(updated.payments)) {
    if (!/^\d+$/.test(key)) continue;
    const index = Number(key);
    if (index >= nextAmounts.length && record && Object.keys(record).length) {
      throw new Error(`Нельзя убрать платёж №${index + 1}: у него есть оплата, чек или история действий. Сохраните этот месяц в графике.`);
    }
    const paid = actualPaid(record, oldAmounts[index] || 0);
    if (paid > (nextAmounts[index] ?? 0)) {
      throw new Error(`Новый платёж №${index + 1} меньше уже полученных ${paid} ₽. Измените сумму или срок, чтобы сохранить оплаченный платёж.`);
    }
    if (paid > 0 && !(Array.isArray(record.paymentEvents) && record.paymentEvents.length)) {
      updated.payments[key] = { ...record, paidAmount: paid,
        paymentEvents: [{ date: record.paidDate, amount: paid, legacy: true }] };
    }
  }
  return updated;
}

export function draftContractId(draft) {
  if (draft?.data?.contractId) return draft.data.contractId;
  if (draft?.draft_type !== 'Редактирование договора') return null;
  // Old edit drafts stored the association in their id only.
  return /^edit-contract-(.+?)(?:-copy-\d+)?$/.exec(draft.id || '')?.[1] || null;
}
