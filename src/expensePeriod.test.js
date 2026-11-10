// Сценарий: зарплата 30 000 ₽ выплачена 05.11.2026 за октябрь 2026.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { expenseFromRow, expenseToRow, expenseTotals, filterExpenses, periodOptions, shiftMonth } from "./expenses";
import { filterJournal, journalTotals, moneyJournal } from "./moneyJournal";
import { ownerNetProfit } from "./netProfit";
import { buildFinancialReport } from "./financialReport";
import { buildFullExcelBackupWorkbook } from "./excelBackup";
import { cloudSnapshot } from "./cloudBackup";

const salary = { id: "s1", date: "2026-11-05", period: "2026-10", amount: 30000, category: "Зарплата", paidFrom: "Наличные", note: "Адам" };
const nov = { from: "2026-11-01", to: "2026-11-30" }, oct = { from: "2026-10-01", to: "2026-10-31" };
const getStats = () => ({ rows: [] });
const freeCapital = (list) => 100000 - list.reduce((s, e) => s + e.amount, 0); // как в «Капитале»: все расходы по факту оплаты

describe("период расхода отдельно от даты оплаты", () => {
  it("деньги уменьшаются 5 ноября: журнал денег по дате оплаты", () => {
    const rows = filterJournal(moneyJournal({ expenses: [salary] }), nov);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-11-05", detail: "Расход за октябрь 2026" });
    expect(journalTotals(rows).balance).toBe(-30000);
    expect(filterJournal(moneyJournal({ expenses: [salary] }), oct)).toHaveLength(0);
    expect(freeCapital([salary])).toBe(70000);
  });

  it("в аналитике по периоду и в чистой прибыли расход относится к октябрю", () => {
    expect(expenseTotals(filterExpenses([salary], { ...oct, basis: "period" })).total).toBe(30000);
    expect(filterExpenses([salary], { ...nov, basis: "period" })).toHaveLength(0);
    expect(filterExpenses([salary], { ...nov, basis: "paid" })).toHaveLength(1);
    expect(ownerNetProfit({ contracts: [], withdrawals: [], expenses: [salary], getStats, ...oct }).expenses).toBe(30000);
    expect(ownerNetProfit({ contracts: [], withdrawals: [], expenses: [salary], getStats, ...nov }).expenses).toBe(0);
  });

  it("в журнале по периоду «пришло − ушло» всё равно считается по датам денег", () => {
    const journal = moneyJournal({ expenses: [salary] });
    const byPeriod = filterJournal(journal, { ...oct, basis: "period" });
    expect(journalTotals(byPeriod).expenses).toBe(30000);
    expect(journalTotals(filterJournal(journal, oct)).balance).toBe(0);
  });

  it("смена периода на сентябрь не трогает дату оплаты, сумму и деньги", () => {
    const moved = { ...salary, period: "2026-09" };
    expect(expenseToRow(moved)).toMatchObject({ id: "s1", date: "2026-11-05", period: "2026-09-01", amount: 30000 });
    expect(journalTotals(filterJournal(moneyJournal({ expenses: [moved] }), nov)).balance).toBe(-30000);
    expect(freeCapital([moved])).toBe(freeCapital([salary]));
    expect(ownerNetProfit({ contracts: [], withdrawals: [], expenses: [moved], getStats, ...oct }).expenses).toBe(0);
    expect(ownerNetProfit({ contracts: [], withdrawals: [], expenses: [moved], getStats, from: "2026-09-01", to: "2026-09-30" }).expenses).toBe(30000);
  });

  it("период сохраняется и читается обратно; старая запись без периода — месяц оплаты", () => {
    const row = expenseToRow(salary);
    expect(expenseFromRow({ ...row, period: "2026-10-01", created_at: "x" }).period).toBe("2026-10");
    expect(expenseFromRow({ id: "old", date: "2026-11-07", amount: 5, category: "Связь" }).period).toBe("2026-11");
    expect(expenseToRow({ id: "old", date: "2026-11-07", amount: 5 }).period).toBe("2026-11-01");
  });

  it("отчёт собственника и полная копия показывают период", () => {
    const r = buildFinancialReport({ contracts: [], investors: [], withdrawals: [], expenses: [salary], getStats, ...oct, asOf: "2026-11-10" });
    expect(r.expenses).toBe(30000);
    expect(buildFinancialReport({ contracts: [], investors: [], withdrawals: [], expenses: [salary], getStats, ...nov, asOf: "2026-11-30" }).expenses).toBe(0);
    const wb = buildFullExcelBackupWorkbook(XLSX, cloudSnapshot({ expenses: [expenseToRow(salary)] }));
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Расходы"])[0]).toMatchObject({ "Дата оплаты": "05.11.2026", "Период расхода": "2026-10", Сумма: 30000 });
  });

  it("можно выбрать прошлые месяцы", () => {
    const options = periodOptions("2026-11-05");
    expect(options).toEqual(expect.arrayContaining(["2026-11", "2026-10", "2025-01"]));
    expect(periodOptions("2026-11-05", "2020-03")).toContain("2020-03");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
