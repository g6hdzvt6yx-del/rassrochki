import { describe, expect, it } from "vitest";
import { allocateContractPayment } from "./payments";

const row = (index, status = "upcoming", paidAmount = 0) => ({
  index, n: index + 1, status, paid: false,
  amountDue: 100, paidAmount, remainingDue: 100 - paidAmount,
  dueDate: new Date(`2026-0${index + 1}-10T00:00:00`),
});

describe("распределение оплаты по договору", () => {
  it("суммой больше ежемесячного платежа закрывает несколько месяцев", () => {
    const result = allocateContractPayment({
      rows: [row(0, "overdue"), row(1, "overdue"), row(2)],
      selectedIndex: 2, amount: 250, date: "2026-03-20", createdAt: "now",
    });

    expect(result.allocations.map(({ number, amount, full }) => ({ number, amount, full }))).toEqual([
      { number: 1, amount: 100, full: true },
      { number: 2, amount: 100, full: true },
      { number: 3, amount: 50, full: false },
    ]);
    expect(result.payments[2].paidAmount).toBe(50);
    expect(result.appliedAmount).toBe(250);
    expect(result.remainder).toBe(0);
  });

  it("в первую очередь закрывает старые просрочки и учитывает прежнюю частичную оплату", () => {
    const result = allocateContractPayment({
      payments: { 0: { paidDate: "2026-01-15", paidAmount: 40 } },
      rows: [row(0, "overdue", 40), row(1, "overdue"), row(2)],
      selectedIndex: 2, amount: 110, date: "2026-03-20", createdAt: "now",
    });

    expect(result.allocations.map(({ number, amount }) => ({ number, amount }))).toEqual([
      { number: 1, amount: 60 }, { number: 2, amount: 50 },
    ]);
    expect(result.payments[0].paidAmount).toBeUndefined();
    expect(result.payments[0].paymentEvents.map((event) => event.amount)).toEqual([40, 60]);
    expect(result.payments[1].paidAmount).toBe(50);
  });

  it("сохраняет комментарий вместе с фактом оплаты", () => {
    const result = allocateContractPayment({
      rows: [row(0, "overdue")], selectedIndex: 0, amount: 100,
      date: "2026-03-20", createdAt: "now", comment: "Оплатил наличными",
    });
    expect(result.payments[0].paymentEvents[0].comment).toBe("Оплатил наличными");
  });
});
