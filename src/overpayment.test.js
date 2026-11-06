import { describe, expect, it } from "vitest";
import { addOverpayment, deleteOverpayment, overpaidSum, overpaymentsOf } from "./payments";
import { cashEntries } from "./cash";
import { summarizeClient } from "./clientSummary";

describe("переплата сверх графика", () => {
  it("добавляется в договор и суммируется, не трогая платежи по графику", () => {
    const base = { 0: { paidDate: "2026-01-05" } };
    const once = addOverpayment(base, { amount: 1000, date: "2026-02-01", createdAt: "t1", destination: { method: "cash" }, comment: "Сверх графика" });
    const twice = addOverpayment(once, { amount: 500.004, date: "2026-02-02", createdAt: "t2", destination: { method: "bank", card: "Сбер" } });
    expect(twice[0]).toEqual(base[0]);
    expect(overpaymentsOf(twice)).toHaveLength(2);
    expect(overpaidSum(twice)).toBe(1500);
    expect(twice.__overpayments[0]).toEqual({ date: "2026-02-01", amount: 1000, createdAt: "t1", method: "cash", comment: "Сверх графика" });
  });

  it("нулевая сумма ничего не меняет", () => {
    const base = { 0: { paidDate: "2026-01-05" } };
    expect(addOverpayment(base, { amount: 0, date: "2026-02-01" })).toBe(base);
  });

  it("удаляется по одной записи; пустой список убирается из договора", () => {
    const p = addOverpayment({}, { amount: 1000, date: "2026-02-01", createdAt: "t1" });
    expect(() => deleteOverpayment(p, 0, { amount: 5 })).toThrow(/изменилась/);
    expect(() => deleteOverpayment(p, 3)).toThrow(/не найдена/);
    expect(deleteOverpayment(p, 0, p.__overpayments[0])).toEqual({});
  });

  it("попадает в кассу и в историю платежей клиента", () => {
    const contract = { id: "c1", clientName: "Клиент", item: "Товар", totalPrice: 2000, downPayment: 0, markup: 0, termMonths: 2,
      payments: { 0: { paidDate: "2026-01-05", paymentEvents: [{ date: "2026-01-05", amount: 1000, createdAt: "t1", method: "cash" }] },
        1: { paidDate: "2026-01-05", paymentEvents: [{ date: "2026-01-05", amount: 1000, createdAt: "t1", method: "cash" }] },
        __overpayments: [{ date: "2026-01-05", amount: 1000, createdAt: "t1", method: "cash" }] } };
    const cash = cashEntries([contract]);
    expect(cash.filter(e => e.purpose.startsWith("Переплата"))).toEqual([expect.objectContaining({ amount: 1000, method: "cash" })]);
    expect(cash.reduce((s, e) => s + e.amount, 0)).toBe(3000);

    const rows = [0, 1].map(i => ({ n: i + 1, index: i, dueDate: `2026-0${i + 1}-05`, remainingDue: 0, status: "paid",
      paymentEvents: contract.payments[i].paymentEvents, paidAmount: 1000 }));
    const summary = summarizeClient([contract], () => ({ rows, remaining: 0, overdueSum: 0 }), "2026-02-01");
    expect(summary.overpaid).toBe(1000);
    expect(summary.payments).toEqual([expect.objectContaining({ amount: 3000, paymentNo: "1, 2 + переплата" })]);
  });
});
