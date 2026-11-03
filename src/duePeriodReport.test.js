import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { duePeriodSummary, monthBounds } from "./expectedPayments";
import { duePeriodReportData, createDuePeriodReportPdf, duePeriodReportFileName, clientsWord } from "./duePeriodReport";

const row = (n, d, amountDue, remainingDue, extra = {}) => ({ n, dueDate: new Date(2026, 9, d), amountDue, remainingDue, paid: remainingDue === 0, ...extra });
const contracts = [
  { id: "a", clientName: "Иван", phone: "89990000001", stats: { rows: [row(1, 5, 1000, 0, { paymentEvents: [{ date: "2026-10-04", amount: 1000 }] }), row(2, 31, 1000, 0, { paymentEvents: [{ date: "2026-10-30", amount: 1000 }] })] } },
  { id: "b", clientName: "Пётр", stats: { rows: [row(1, 10, 500, 200, { status: "overdue" })] } },
  { id: "c", clientName: "Мария", stats: { rows: [row(1, 15, 2000, 2000, { status: "overdue" })] } },
  { id: "d", clientName: "Олег", stats: { rows: [row(1, 20, 700, 0)] } },
];
const [from, to] = monthBounds("2026-10");
const report = duePeriodReportData(duePeriodSummary(contracts, c => c.stats, from, to));

describe("справка для руководителя", () => {
  it("должны оплатить / оплатили / остаток — клиенты и суммы сходятся", () => {
    expect(report.due).toEqual({ clients: 4, sum: 5200, payments: 5 });
    expect(report.paid).toEqual({ clients: 3, sum: 3000, full: 2, partial: 1 });
    expect(report.remaining).toEqual({ clients: 2, sum: 2200, partial: 1, none: 1 });
    expect(report.paid.sum + report.remaining.sum).toBe(report.due.sum);
    expect(report.collectedPercent).toBe(57.7);
    expect(report.overdueClients).toBe(2);
  });
  it("должники по убыванию остатка, оплатившие с датой оплаты", () => {
    expect(report.debtors.map(c => [c.name, c.remaining, c.firstUnpaid])).toEqual([["Мария", 2000, "2026-10-15"], ["Пётр", 200, "2026-10-10"]]);
    expect(report.paidClients.map(c => [c.name, c.lastPaidDate])).toEqual([["Иван", "2026-10-30"], ["Олег", ""]]);
  });
  it("создаёт PDF с кириллицей", () => {
    const font = readFileSync(new URL("./assets/DejaVuSans.ttf", import.meta.url)).toString("base64");
    const bytes = createDuePeriodReportPdf(report, { periodLabel: "Октябрь 2026", from, to, fontBase64: font, now: new Date(2026, 10, 4) });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("/FontFile2");
  });
  it("имя файла и склонение", () => {
    expect(duePeriodReportFileName("2026-10-01", "2026-10-31")).toBe("spravka_platezhi_2026-10.pdf");
    expect(duePeriodReportFileName("2026-10-01", "2026-10-15")).toBe("spravka_platezhi_2026-10-01_2026-10-15.pdf");
    expect([1, 2, 5, 11, 21, 22].map(clientsWord)).toEqual(["1 клиент", "2 клиента", "5 клиентов", "11 клиентов", "21 клиент", "22 клиента"]);
  });
});
