import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { duePeriodSummary, monthBounds } from "./expectedPayments";
import { duePeriodReportData, createDuePeriodReportPdf, duePeriodReportFileName, clientsWord } from "./duePeriodReport";

const row = (n, d, amountDue, remainingDue, extra = {}) => ({ n, dueDate: new Date(2026, 9, d), amountDue, remainingDue, paid: remainingDue === 0, ...extra });
const contracts = [
  { id: "a", clientName: "Иван", totalPrice: 1600, markup: 400, phone: "89990000001", stats: { rows: [row(1, 5, 1000, 0, { paymentEvents: [{ date: "2026-10-04", amount: 1000 }] }), row(2, 31, 1000, 0, { paymentEvents: [{ date: "2026-10-30", amount: 1000 }] })] } },
  { id: "b", clientName: "Пётр", stats: { rows: [row(1, 10, 500, 200, { status: "overdue" })] } },
  { id: "c", clientName: "Мария", stats: { rows: [row(1, 15, 2000, 2000, { status: "overdue" })] } },
  { id: "d", clientName: "Олег", stats: { rows: [row(1, 20, 700, 0)] } },
];
const [from, to] = monthBounds("2026-10");
const report = duePeriodReportData(duePeriodSummary(contracts, c => c.stats, from, to));

describe("справка для руководителя", () => {
  it("должны оплатить / оплатили / остаток — клиенты и суммы сходятся", () => {
    expect(report.due).toEqual({ clients: 4, sum: 5200, payments: 5, profit: 400 });
    expect(report.paid).toEqual({ clients: 3, sum: 3000, full: 2, partial: 1, profit: 400 });
    expect(report.remaining).toEqual({ clients: 2, sum: 2200, partial: 1, none: 1, profit: 0 });
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

import { periodReceipts } from "./duePeriodReceipts";
describe("справка по выбранной плитке и поступления", () => {
  const summary = duePeriodSummary(contracts, c => c.stats, from, to);
  it("плитка «не оплатили» — в справке только должники", () => {
    const r = duePeriodReportData(summary, { list: "unpaid" });
    expect(r.list).toBe("unpaid");
    expect(r.due).toMatchObject({ clients: 2, sum: 2500 });
    expect(r.paid).toMatchObject({ clients: 1, sum: 300 });
    expect(r.remaining).toMatchObject({ clients: 2, sum: 2200 });
    expect(r.paidClients).toEqual([]);
  });
  it("плитка «оплатили» — только оплатившие", () => {
    const r = duePeriodReportData(summary, { list: "paid" });
    expect(r.due).toMatchObject({ clients: 2, sum: 2700 });
    expect(r.remaining.sum).toBe(0); expect(r.debtors).toEqual([]);
  });
  // реальные договоры: график 2 × 1000, наценка 500 из 2000 → прибыль 25 % каждого рубля
  const real = [
    { id: "x", clientName: "Иван", totalPrice: 1800, markup: 500, downPayment: 300, termMonths: 2, startDate: "2026-09-10",
      payments: { 0: { paymentEvents: [{ date: "2026-10-02", amount: 600, method: "cash" }, { date: "2026-10-20", amount: 400, method: "bank", card: "Сбер · 1234" }] },
        1: { paymentEvents: [{ date: "2026-10-25", amount: 200, method: "bank", card: "Сбер · 1234" }] }, __downPaymentDestination: { method: "cash" } } },
    { id: "y", clientName: "Мария", totalPrice: 1000, markup: 0, termMonths: 1, startDate: "2026-10-01",
      payments: { 0: { paidDate: "2026-10-05", paidAmount: 1000 } } },
  ];
  it("поступления за период по видам, итог и прибыль", () => {
    const r = periodReceipts(real, "2026-10-01", "2026-10-31");
    expect(r.byKind.map(k => [k.label, k.count, k.amount, k.profit])).toEqual([
      ["Наличные", 1, 600, 150], ["Безнал · Сбер · 1234", 2, 600, 150], ["Способ не указан", 1, 1000, 0],
    ]);
    expect(r.total).toBe(2200); expect(r.profit).toBe(300); expect(r.count).toBe(4); expect(r.downPayments).toBe(0);
  });
  it("первоначальный взнос в периоде — без прибыли; фильтр по договорам", () => {
    const r = periodReceipts(real, "2026-09-01", "2026-10-31", new Set(["x"]));
    expect(r.total).toBe(1500); expect(r.downPayments).toBe(300); expect(r.profit).toBe(300);
    expect(periodReceipts(real, "2026-10-31", "2026-10-01").count).toBe(0);
  });
  it("PDF с выборкой и поступлениями собирается", () => {
    const font = readFileSync(new URL("./assets/DejaVuSans.ttf", import.meta.url)).toString("base64");
    const r = duePeriodReportData(summary, { list: "unpaid", receipts: periodReceipts(real, "2026-10-01", "2026-10-31") });
    const text = Buffer.from(createDuePeriodReportPdf(r, { periodLabel: "Октябрь 2026", from, to, fontBase64: font })).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(duePeriodReportFileName(from, to, "unpaid")).toBe("spravka_platezhi_2026-10_ne_oplatili.pdf");
  });
});

import * as XLSX from "xlsx";
import { buildDuePeriodWorkbook } from "./duePeriodExcel";
it("Excel по выбранной плитке: итоги с прибылью и лист поступлений", () => {
  const summary = duePeriodSummary(contracts, c => c.stats, from, to);
  const receipts = periodReceipts([
    { id: "b", clientName: "Пётр", totalPrice: 1000, markup: 0, termMonths: 1, startDate: "2026-10-10",
      payments: { 0: { paymentEvents: [{ date: "2026-10-12", amount: 300, method: "cash" }] } } },
  ], from, to, summary.contractIds.unpaid);
  const { wb } = buildDuePeriodWorkbook(XLSX, { summary, list: "unpaid", periodLabel: "Октябрь 2026", from, to, receipts });
  expect(wb.SheetNames).toEqual(["Платежи за период", "Итоги", "Поступления"]);
  const totals = XLSX.utils.sheet_to_json(wb.Sheets["Итоги"], { header: 1 });
  expect(totals.find(r => r[0] === "Должны были оплатить")).toEqual(["Должны были оплатить", 2, 2500, 0]);
  expect(totals.find(r => r[0] === "Наличные")).toEqual(["Наличные", 1, 300, 0]);
  expect(totals.find(r => r[0] === "Всего поступлений")).toEqual(["Всего поступлений", 1, 300, 0]);
});
