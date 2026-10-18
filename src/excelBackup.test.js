import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFullExcelBackupWorkbook } from "./excelBackup";

describe("ежедневная Excel-копия", () => {
  it("содержит все обязательные разделы и фактические оплаты", () => {
    const workbook = buildFullExcelBackupWorkbook(XLSX, {
      createdAt: "2026-09-11T10:00:00Z",
      contracts: [{ id: "c1", data: JSON.stringify({
        id: "c1", client_name: "Тест", phone: "+79990000000", total_price: 1000, markup: 200,
        term_months: 2, start_date: "2026-08-01", payments: { 0: { paidDate: "2026-08-02", paymentEvents: [{ date: "2026-08-02", amount: 600, comment: "Наличные" }] } },
      }) }],
      investors: [], withdrawals: [], actions: [], drafts: [], deletedReceipts: [],
    });
    expect(workbook.SheetNames).toEqual(expect.arrayContaining([
      "Сводка", "Договоры", "График платежей", "Фактические оплаты", "Вкладчики",
      "Выводы средств", "История контактов", "Журнал действий", "Черновики", "Чеки и вложения", "Корзина",
    ]));
    const payments = XLSX.utils.sheet_to_json(workbook.Sheets["Фактические оплаты"]);
    expect(payments[0]).toMatchObject({ Клиент: "Тест", Сумма: 600, Комментарий: "Наличные" });
  });
});
