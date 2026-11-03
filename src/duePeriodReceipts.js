import { cashEntries, destinationLabel } from "./cash";
import { profitShare } from "./expectedPayments";

const KIND_ORDER = (label) => (label === "Наличные" ? 0 : label.startsWith("Безнал") ? 1 : 2);

// Деньги, фактически полученные в периоде (по дате оплаты), в разрезе вида поступления.
// Включает погашение старых долгов, досрочные платежи и первоначальные взносы.
// contractIds — если выбрана плитка, учитываются только договоры этой группы.
export function periodReceipts(contracts, from, to, contractIds = null) {
  const shares = new Map(contracts.map((c) => [c.id, profitShare(c)]));
  const valid = Boolean(from && to && from <= to);
  const rows = valid ? cashEntries(contracts)
    .filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date || "") && e.date.slice(0, 10) >= from && e.date.slice(0, 10) <= to)
    .filter((e) => !contractIds || contractIds.has(e.contractId))
    .map((e) => {
      const down = e.purpose === "Первоначальный взнос";
      const amount = Math.max(0, +e.amount || 0);
      return { ...e, date: e.date.slice(0, 10), amount, down, kind: destinationLabel(e), profit: down ? 0 : amount * (shares.get(e.contractId) || 0) };
    }) : [];
  rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.client).localeCompare(String(b.client), "ru"));
  const kinds = new Map();
  rows.forEach((r) => {
    if (!kinds.has(r.kind)) kinds.set(r.kind, { label: r.kind, amount: 0, profit: 0, count: 0 });
    const k = kinds.get(r.kind); k.amount += r.amount; k.profit += r.profit; k.count += 1;
  });
  const byKind = [...kinds.values()].map((k) => ({ ...k, profit: Math.round(k.profit) }))
    .sort((a, b) => KIND_ORDER(a.label) - KIND_ORDER(b.label) || b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    rows, byKind, total, count: rows.length,
    profit: byKind.reduce((s, k) => s + k.profit, 0),
    downPayments: rows.filter((r) => r.down).reduce((s, r) => s + r.amount, 0),
    clients: new Set(rows.map((r) => String(r.client || "").trim().toLocaleLowerCase("ru"))).size,
  };
}
