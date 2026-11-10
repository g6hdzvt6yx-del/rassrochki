import { describe, expect, it } from "vitest";
import { monthPeriod, monthTitle, ownerNetProfit, shiftMonthKey } from "./netProfit";

const contract = { id: "a", investorId: "", totalPrice: 1000, downPayment: 0, markup: 200 };
const getStats = () => ({ paidSum: 600, remaining: 600, overdueSum: 0, rows: [{ n: 1, paidAmount: 600, paymentEvents: [{ date: "2026-11-03", amount: 600 }] }] });

describe("чистая прибыль собственника", () => {
  it("наценка − выплаты вкладчикам − расходы за месяц", () => {
    const r = ownerNetProfit({
      contracts: [contract], getStats, from: "2026-11-01", to: "2026-11-10",
      withdrawals: [{ date: "2026-11-05", purpose: "investor_payout", amount: 30 }, { date: "2026-11-06", purpose: "owner", amount: 999 }],
      expenses: [{ date: "2026-11-07", amount: 40 }, { date: "2026-10-31", amount: 500 }],
    });
    expect(r.profitReceived).toBe(100);
    expect(r).toMatchObject({ investorPayout: 30, expenses: 40, net: 30 });
  });

  it("уходит в минус, если расходы больше", () => {
    const r = ownerNetProfit({ contracts: [contract], getStats, withdrawals: [], expenses: [{ date: "2026-11-02", amount: 250 }], from: "2026-11-01", to: "2026-11-30" });
    expect(r.net).toBe(-150);
  });

  it("границы и подписи месяцев", () => {
    expect(monthPeriod("2026-11", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(monthPeriod("2026-02", "2026-11-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(monthTitle("2026-11")).toMatch(/^Ноябрь 2026/);
  });
});
