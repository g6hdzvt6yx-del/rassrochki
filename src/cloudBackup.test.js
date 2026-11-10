import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildFullExcelBackupWorkbook } from "./excelBackup";
import { backupFileName, cloudSnapshot, downloadCloudBackup } from "./cloudBackup";

const contract = { id: "c1", client_name: "Иванов", phone: "+79990000000", total_price: 1000, down_payment: 0, markup: 200, term_months: 2,
  start_date: "2026-10-01", payments: { 0: { paidDate: "2026-10-02", paymentEvents: [{ date: "2026-10-02", amount: 600 }] } } };

describe("скачивание копии с сайта", () => {
  it("кладёт строки сайта и корзину в листы полной Excel-копии", () => {
    const snap = cloudSnapshot({
      contracts: [contract], investors: [{ id: "i1", name: "Вкладчик", amount: 50000 }], withdrawals: [],
      expenses: [{ id: "x1", date: "2026-11-01", amount: 30000, category: "Аренда", paid_from: "Наличные", note: "" }],
      trash: [
        { id: "t1", entity_type: "expenses", entity_id: "x0", data: { id: "x0", date: "2026-10-01", amount: 100, category: "Связь" }, deleted_at: "2026-11-02T10:00:00Z" },
        { id: "t2", entity_type: "receipts", entity_id: "r", contract_id: "c1", payment_index: "0", data: { name: "чек.jpg" }, deleted_at: "2026-11-03T10:00:00Z" },
      ],
    }, "2026-11-10T08:00:00Z");
    const wb = buildFullExcelBackupWorkbook(XLSX, snap);
    expect(wb.SheetNames).toEqual(expect.arrayContaining(["Сводка", "Договоры", "Фактические оплаты", "Расходы", "Корзина"]));
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Договоры"])[0]).toMatchObject({ Клиент: "Иванов", Цена: 1000 });
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Фактические оплаты"])[0]).toMatchObject({ Сумма: 600 });
    const expenses = XLSX.utils.sheet_to_json(wb.Sheets["Расходы"]);
    expect(expenses.map((r) => r.Статья)).toEqual(["Аренда", "Связь"]);
    const trash = XLSX.utils.sheet_to_json(wb.Sheets["Корзина"]).map((r) => r.Тип);
    expect(trash).toEqual(expect.arrayContaining(["Расход", "Чек"]));
  });

  it("без таблицы расходов копия собирается без листа «Расходы»", () => {
    const wb = buildFullExcelBackupWorkbook(XLSX, cloudSnapshot({ contracts: [contract] }));
    expect(wb.SheetNames).not.toContain("Расходы");
  });

  it("читает таблицы частями больше 1000 строк", async () => {
    const big = Array.from({ length: 1500 }, (_, i) => ({ id: `a${i}`, action_type: "create", occurred_at: "2026-11-01T00:00:00Z" }));
    const calls = [];
    const supabase = { from: (table) => ({ select: () => ({ order: () => ({ range: async (a, b) => {
      calls.push([table, a, b]);
      if (table === "action_log") return { data: big.slice(a, b + 1), error: null };
      if (table === "contracts") return { data: [contract], error: null };
      return { data: [], error: null };
    } }) }) }) };
    vi.doMock("xlsx", async () => ({ ...XLSX, writeFile: () => {} }));
    await downloadCloudBackup(supabase);
    expect(calls.filter((c) => c[0] === "action_log").length).toBe(2);
  });

  it("называет файл по дате и времени", () => {
    expect(backupFileName(new Date(2026, 10, 10, 9, 5))).toBe("Eppaz_копия_2026-11-10_09-05.xlsx");
  });
});
