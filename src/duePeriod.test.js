import { describe, it, expect } from "vitest";
import { duePeriodSummary, monthBounds, shiftMonth } from "./expectedPayments";
const row = (n, d, amountDue, remainingDue) => ({ n, dueDate: new Date(2026, 9, d), amountDue, remainingDue, paid: remainingDue === 0 });
const contracts = [
  { id: "a", clientName: "Иван", stats: { rows: [row(1, 5, 1000, 0), row(2, 31, 1000, 0)] } },
  { id: "b", clientName: "иван ", stats: { rows: [row(1, 10, 500, 200)] } },
  { id: "c", clientName: "Мария", stats: { rows: [row(1, 15, 2000, 0), { n: 2, dueDate: new Date(2026, 10, 15), amountDue: 2000, remainingDue: 2000 }] } },
  { id: "d", clientName: "Олег", stats: { rows: [{ n: 1, dueDate: new Date(2026, 8, 30), amountDue: 700, remainingDue: 700 }] } },
];
describe("кто должен был заплатить за период", () => {
  it("считает и оплативших, и не оплативших за октябрь", () => {
    const [from, to] = monthBounds("2026-10");
    const s = duePeriodSummary(contracts, c => c.stats, from, to);
    expect(s.clients).toBe(2); // Иван (2 договора) и Мария; Олег — сентябрь
    expect(s.paidClients).toBe(1); expect(s.unpaidClients).toBe(1);
    expect(s.payments).toBe(4); expect(s.scheduled).toBe(4500); expect(s.paid).toBe(4300); expect(s.remaining).toBe(200);
    expect([...s.contractIds.unpaid]).toEqual(["b"]); expect([...s.contractIds.paid].sort()).toEqual(["a", "c"]);
  });
  it("пустой или перевёрнутый период ничего не показывает", () => {
    expect(duePeriodSummary(contracts, c => c.stats, "2026-10-31", "2026-10-01").clients).toBe(0);
  });
  it("границы месяца и сдвиг через год", () => {
    expect(monthBounds("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthBounds("2028-02")).toEqual(["2028-02-01", "2028-02-29"]);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01"); expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
