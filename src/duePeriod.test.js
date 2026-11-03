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

import * as XLSX from "xlsx";
import { buildDuePeriodWorkbook, duePeriodExportRows, duePeriodFileName } from "./duePeriodExcel";
describe("выгрузка в Excel за период", () => {
  const [from, to] = monthBounds("2026-10");
  const s = duePeriodSummary(contracts, c => c.stats, from, to);
  it("строки по платежам с учётом выбранной плитки", () => {
    expect(s.rows).toHaveLength(4);
    expect(duePeriodExportRows(s, "unpaid").map(r => [r.contractId, r.remaining, r.state])).toEqual([["b", 200, "partial"]]);
    expect(duePeriodExportRows(s, "paid")).toHaveLength(3);
    expect(duePeriodExportRows(s, "")).toHaveLength(4);
  });
  it("файл: заголовок, таблица, итог и лист «Итоги»", () => {
    const { wb, rows } = buildDuePeriodWorkbook(XLSX, { summary: s, list: "unpaid", periodLabel: "Октябрь 2026", from, to });
    expect(rows).toBe(1);
    expect(wb.SheetNames).toEqual(["Платежи за период", "Итоги"]);
    const data = XLSX.utils.sheet_to_json(wb.Sheets["Платежи за период"], { header: 1 });
    expect(data[0][0]).toContain("Не оплатили или частично · Октябрь 2026 (01.10.2026 — 31.10.2026)");
    expect(data[3].slice(1, 2)).toEqual(["иван "]);
    expect(data[3].slice(5, 12)).toEqual(["10.10.2026", 500, 300, 0, 200, "", "Оплачен частично"]);
    expect(data[5].slice(6, 10)).toEqual([500, 300, 0, 200]);
  });
  it("понятное имя файла", () => {
    expect(duePeriodFileName("2026-10-01", "2026-10-31", "unpaid")).toBe("dolzhny_oplatit_2026-10_ne_oplatili.xlsx");
    expect(duePeriodFileName("2026-02-01", "2026-02-28", "paid")).toBe("dolzhny_oplatit_2026-02_oplatili.xlsx");
    expect(duePeriodFileName("2026-10-01", "2026-10-15")).toBe("dolzhny_oplatit_2026-10-01_2026-10-15.xlsx");
  });
});
