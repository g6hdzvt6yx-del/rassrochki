import { describe, it, expect } from "vitest";
import { expectedPayments } from "./expectedPayments";
const contracts = [{ id: "a", clientName: "А", stats: { remaining: 900, overdueSum: 0, rows: [
  { n: 1, dueDate: new Date(2026, 9, 1), remainingDue: 100, paid: false },
  { n: 2, dueDate: new Date(2026, 9, 30), remainingDue: 200, paidAmount: 100, paid: false },
  { n: 3, dueDate: new Date(2026, 9, 15), remainingDue: 0, paid: true },
  { n: 4, dueDate: new Date(2026, 10, 1), remainingDue: 600, paid: false },
] } }];
describe("ожидаемые платежи за период", () => {
  it("включает обе границы, исключает оплаченные, считает остаток и уникальных клиентов", () => {
    const result = expectedPayments(contracts, c => c.stats, "2026-10-01", "2026-10-30");
    expect(result.rows.map(r => r.paymentNo)).toEqual([1, 2]);
    expect(result.remaining).toBe(300); expect(result.clients).toBe(1);
  });
  it("поддерживает один день и несколько месяцев", () => {
    expect(expectedPayments(contracts, c => c.stats, "2026-10-30").remaining).toBe(200);
    expect(expectedPayments(contracts, c => c.stats, "2026-10-01", "2027-01-01").remaining).toBe(900);
  });
  it("не показывает платежи для пустого или перевёрнутого периода", () => {
    expect(expectedPayments(contracts, c => c.stats, "", "2026-10-30").rows).toEqual([]);
    expect(expectedPayments(contracts, c => c.stats, "2026-10-30", "2026-10-01").rows).toEqual([]);
  });
});
