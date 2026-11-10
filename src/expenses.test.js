import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildExpensesWorkbook, expenseFromRow, expenseToRow, expenseTotals, filterExpenses, validateExpense, categoryOptions, paidFromOptions } from "./expenses";

const list = [
  { id: "a", date: "2026-11-01", amount: 30000, category: "Аренда", paidFrom: "Наличные", note: "Ноябрь" },
  { id: "b", date: "2026-11-05", amount: 0.1, category: "Банк и комиссии", paidFrom: "Сбер · 1234", note: "" },
  { id: "c", date: "2026-11-05", amount: 0.2, category: "Банк и комиссии", paidFrom: "Сбер · 1234", note: "" },
  { id: "d", date: "2026-10-20", amount: 5000, category: "Реклама", paidFrom: "Наличные", note: "Авито" },
];

describe("реестр расходов", () => {
  it("переводит строку базы туда и обратно", () => {
    const e = expenseFromRow({ id: "x", date: "2026-11-10", amount: "1500.50", category: "Аренда", paid_from: "Наличные", note: "к" });
    expect(e).toMatchObject({ amount: 1500.5, paidFrom: "Наличные" });
    expect(expenseToRow({ ...e, category: "  " })).toEqual({ id: "x", date: "2026-11-10", amount: 1500.5, category: "Прочее", paid_from: "Наличные", note: "к" });
  });

  it("фильтрует по периоду, статье и тексту и сортирует новые сверху", () => {
    expect(filterExpenses(list, { from: "2026-11-01", to: "2026-11-30" }).map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(filterExpenses(list).map((e) => e.id)).toEqual(["c", "b", "a", "d"]);
    expect(filterExpenses(list, { category: "Реклама" }).map((e) => e.id)).toEqual(["d"]);
    expect(filterExpenses(list, { search: "авито" }).map((e) => e.id)).toEqual(["d"]);
    expect(filterExpenses(list, { from: "2026-12-01", to: "2026-11-01" })).toEqual([]);
  });

  it("считает итоги без ошибок округления", () => {
    const t = expenseTotals(list);
    expect(t.total).toBe(35000.3);
    expect(t.byCategory[0]).toEqual({ category: "Аренда", amount: 30000 });
    expect(t.byCategory.find((x) => x.category === "Банк и комиссии").amount).toBe(0.3);
  });

  it("проверяет форму", () => {
    expect(validateExpense({ date: "2026-11-10", amount: "1 500,5" })).toBe("");
    expect(validateExpense({ date: "", amount: 10 })).toMatch(/дату/);
    expect(validateExpense({ date: "2026-11-10", amount: "0" })).toMatch(/больше нуля/);
  });

  it("подсказывает статьи и источники оплаты без повторов", () => {
    expect(categoryOptions([{ category: "Аренда" }, { category: "Охрана" }])).toContain("Охрана");
    expect(paidFromOptions(list, ["Сбер · 1234"]).filter((x) => x === "Сбер · 1234")).toHaveLength(1);
  });

  it("собирает Excel со списком и итогами по статьям", () => {
    const wb = buildExpensesWorkbook(XLSX, filterExpenses(list), { from: "2026-10-01", to: "2026-11-30" });
    expect(wb.SheetNames).toEqual(["Расходы", "По статьям"]);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Расходы"]);
    expect(rows[0]).toMatchObject({ Дата: "05.11.2026", Статья: "Банк и комиссии" });
    const sum = XLSX.utils.sheet_to_json(wb.Sheets["По статьям"], { header: 1 });
    expect(sum.at(-1)).toEqual(["Итого", 35000.3]);
  });
});
