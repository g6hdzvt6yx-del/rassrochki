import { describe, expect, it } from "vitest";
import { addMonthsClamped, investorProfitBreakdown, profitComparisonByMonth, scheduledProfitSummary, receivedProfitByMonth, receivedSummary, splitReceived, splitScheduleAmount } from "./finance";

const stats = (contract) => contract.stats;
const localIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe("финансовые итоги", () => {
  it("делит фактическое поступление на капитал и прибыль без расхождения", () => {
    expect(splitReceived(600, 1000, 200)).toEqual({ received: 600, principalReturned: 500, profitReceived: 100 });
  });

  it("учитывает полные и частичные платежи, но не первоначальный взнос", () => {
    const contracts = [{
      id: "c1", clientName: "Тест", totalPrice: 1200, downPayment: 200, markup: 200,
      stats: { paidSum: 600, rows: [{ n: 1, paidAmount: 400, paidDate: "2026-01-01" }, { n: 2, paidAmount: 200, paidDate: "2026-02-01" }, { n: 3, paidAmount: 0 }] },
    }];
    const result = receivedSummary(contracts, stats);
    expect(result.received).toBe(600);
    expect(result.rows).toHaveLength(2);
    expect(result.received).toBe(result.principalReturned + result.profitReceived);
  });

  it("фильтрует полученные платежи по выбранному месяцу", () => {
    const contracts = [{
      id: "c1", clientName: "Тест", totalPrice: 1200, downPayment: 200, markup: 200,
      stats: { paidSum: 600, rows: [{ n: 1, paidAmount: 400, paidDate: "2026-01-15" }, { n: 2, paidAmount: 200, paidDate: "2026-02-10" }] },
    }];
    const january = receivedSummary(contracts, stats, "2026-01");
    expect(january.received).toBe(400);
    expect(january.rows).toHaveLength(1);
    expect(january.principalReturned + january.profitReceived).toBe(400);
  });

  it("не смешивает частичные оплаты одного платежа, внесённые в разные даты", () => {
    const contracts = [{
      id: "c1", clientName: "Тест", totalPrice: 1200, downPayment: 200, markup: 200,
      stats: { paidSum: 600, rows: [{
        n: 1, paidAmount: 600, paidDate: "2026-02-10",
        paymentEvents: [{ date: "2026-01-20", amount: 250 }, { date: "2026-02-10", amount: 350 }],
      }] },
    }];
    expect(receivedSummary(contracts, stats, "2026-01").received).toBe(250);
    expect(receivedSummary(contracts, stats, "2026-02").received).toBe(350);
    expect(receivedSummary(contracts, stats).received).toBe(600);
  });

  it("показывает полученную прибыль отдельно по каждому месяцу", () => {
    const contracts = [{
      id: "c1", clientName: "Тест", totalPrice: 1000, downPayment: 0, markup: 200,
      stats: { rows: [{ n: 1, paidAmount: 600, paymentEvents: [
        { date: "2026-01-20", amount: 250 }, { date: "2026-02-10", amount: 350 },
      ] }] },
    }];
    const months = receivedProfitByMonth(contracts, stats);
    expect(months.map(({ month, received, profitReceived }) => ({ month, received, profitReceived }))).toEqual([
      { month: "2026-02", received: 350, profitReceived: 58 },
      { month: "2026-01", received: 250, profitReceived: 42 },
    ]);
  });

  it("не смешивает вкладчика, общий пул и потерянную привязку", () => {
    const base = { totalPrice: 1000, downPayment: 0, markup: 200, stats: { paidSum: 600, rows: [] } };
    const result = investorProfitBreakdown([
      { ...base, id: "a", clientName: "A", investorId: "i1" },
      { ...base, id: "b", clientName: "B", investorId: "" },
      { ...base, id: "c", clientName: "C", investorId: "missing" },
    ], [{ id: "i1", name: "Вкладчик", amount: 5000 }], [], stats);
    expect(result.groups.map((group) => group.name)).toEqual(["Вкладчик", "Общий пул", "Без привязки к вкладчику"]);
    expect(result.groups.every((group) => group.contractCount === 1)).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(result.difference).toBe(0);
  });

  it("корректно переносит платёж с конца месяца", () => {
    expect(localIso(addMonthsClamped("2024-01-31", 1))).toBe("2024-02-29");
    expect(localIso(addMonthsClamped("2025-01-31", 1))).toBe("2025-02-28");
    expect(localIso(addMonthsClamped("2026-03-31", 1))).toBe("2026-04-30");
  });

  it("распределяет округление без потери рублей", () => {
    const rows = splitScheduleAmount(1000, 3);
    expect(rows).toEqual([333, 333, 334]);
    expect(rows.reduce((sum, value) => sum + value, 0)).toBe(1000);
  });

  it("не увеличивает фиксированную сумму договора при делении на месяцы", () => {
    expect(splitScheduleAmount(69000, 6)).toEqual([11500, 11500, 11500, 11500, 11500, 11500]);
    const uneven = splitScheduleAmount(69001, 6);
    expect(uneven.reduce((sum, value) => sum + value, 0)).toBe(69001);
  });

  it("не создаёт отрицательные суммы", () => {
    expect(splitReceived(-10, 1000, 200)).toEqual({ received: 0, principalReturned: 0, profitReceived: 0 });
    expect(splitScheduleAmount(-100, 3)).toEqual([0, 0, 0]);
  });

  it("сохраняет помесячную историю нескольких частичных оплат", () => {
    const contract = {
      id: "partial", clientName: "Тест", totalPrice: 1000, downPayment: 0, markup: 200,
      stats: { paidSum: 600, rows: [{ n: 1, paidAmount: 600, paymentEvents: [
        { date: "2026-01-10", amount: 100 }, { date: "2026-01-25", amount: 200 }, { date: "2026-02-02", amount: 300 },
      ] }] },
    };
    expect(receivedSummary([contract], stats, "2026-01").received).toBe(300);
    expect(receivedSummary([contract], stats, "2026-02").received).toBe(300);
    expect(receivedSummary([contract], stats).received).toBe(600);
  });
});


describe("плановая и фактическая прибыль", () => {
  const contracts = [{ id: "c", totalPrice: 1000, markup: 200, stats: { rows: [
    { n: 1, dueDate: new Date(2026, 0, 15), amountDue: 600, paidAmount: 600,
      paymentEvents: [{ date: "2026-02-01", amount: 300 }, { date: "2026-03-01", amount: 300 }] },
    { n: 2, dueDate: new Date(2026, 3, 15), scheduledDueDate: new Date(2026, 1, 15), amountDue: 600, paidAmount: 0 },
  ] } }];
  it("сохраняет полный план оплаченного платежа и разделяет частичные поступления по датам", () => {
    const rows = profitComparisonByMonth(contracts, stats);
    expect(rows.map((r) => [r.month, r.profitScheduled, r.profitReceived])).toEqual([
      ["2026-04", 100, 0], ["2026-03", 0, 50], ["2026-02", 0, 50], ["2026-01", 100, 0],
    ]);
  });
  it("учитывает перенос в новом месяце и включает будущие неоплаченные обязательства", () => {
    expect(scheduledProfitSummary(contracts, stats, "2026-02").profitScheduled).toBe(0);
    expect(scheduledProfitSummary(contracts, stats, "2026-04").profitScheduled).toBe(100);
    expect(scheduledProfitSummary(contracts, stats).profitScheduled).toBe(200);
  });
  it("обрабатывает отсутствие договоров", () => {
    expect(profitComparisonByMonth([], stats)).toEqual([]);
    expect(scheduledProfitSummary([], stats).profitScheduled).toBe(0);
  });
});


describe("произвольный период", () => {
  const dates = ["2026-09-30", "2026-10-01", "2026-10-15", "2026-10-30", "2026-10-31", "2026-11-01", "2027-01-01"];
  const contracts = [{ id: "range", totalPrice: 1000, markup: 200, stats: { rows: [
    ...dates.map((date, index) => ({ n: index + 1, dueDate: new Date(`${date}T12:00:00`), amountDue: 120,
      paymentEvents: [{ date: `${date}T23:59:59`, amount: 120 }] })),
    { n: 8, paidAmount: 120, paidDate: null },
  ] } }];
  it.each([
    ["2026-10-01", "2026-10-30", 360],
    ["2026-10-15", "2026-10-15", 120],
    ["2026-09-30", "2027-01-01", 840],
    ["2026-12-01", "2026-12-31", 0],
    ["2026-10-30", "2026-10-01", 0],
    ["", "2026-10-30", 0],
  ])("учитывает обе границы %s — %s", (from, to, expected) => {
    const actual = receivedSummary(contracts, stats, "", { from, to });
    const planned = scheduledProfitSummary(contracts, stats, "", { from, to });
    expect(actual.received).toBe(expected);
    expect(planned.scheduled).toBe(expected);
    expect(actual.profitReceived).toBe(expected / 6);
    expect(planned.profitScheduled).toBe(expected / 6);
    expect(actual.reconciled).toBe(true);
  });
  it("возвращает все поступления после сброса периода, включая недатированные", () => {
    expect(receivedSummary(contracts, stats).received).toBe(960);
  });
});
