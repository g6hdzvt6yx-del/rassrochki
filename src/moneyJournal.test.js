import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildJournalWorkbook, filterJournal, journalTotals, moneyJournal } from "./moneyJournal";

const contracts = [{
  id: "c1", clientName: "Иванов", item: "Телефон", totalPrice: 1000, downPayment: 200, markup: 100, termMonths: 3, startDate: "2026-11-01",
  payments: { __downPaymentDestination: { method: "cash" }, 0: { paymentEvents: [{ date: "2026-11-05", amount: 300, method: "bank", card: "Сбер 1234" }] } },
}];
const data = {
  contracts,
  expenses: [{ id: "x1", date: "2026-11-06", amount: 150, category: "Аренда", paidFrom: "Наличные", note: "" }],
  withdrawals: [{ id: "w1", date: "2026-11-07", amount: 50, purpose: "investor_payout", investorId: "i1", note: "" }, { id: "w2", date: "2026-10-01", amount: 999, purpose: "owner" }],
  investors: [{ id: "i1", name: "Пётр" }],
  purposes: { investor_payout: "Выплата вкладчику", owner: "Прибыль собственнику" },
};

describe("журнал денег", () => {
  it("собирает поступления, расходы и выводы в один список по датам", () => {
    const rows = filterJournal(moneyJournal(data), { from: "2026-11-01", to: "2026-11-30" });
    expect(rows.map((r) => [r.kind, r.date, r.amount])).toEqual([
      ["withdrawal", "2026-11-07", 50], ["expense", "2026-11-06", 150], ["in", "2026-11-05", 300], ["in", "2026-11-01", 200],
    ]);
    expect(rows[0].detail).toBe("Вывод · Пётр");
    expect(rows[2]).toMatchObject({ title: "Иванов", via: "Безнал · Сбер 1234", contractId: "c1" });
  });

  it("фильтрует только поступления и считает итог «пришло − ушло»", () => {
    const all = filterJournal(moneyJournal(data), { from: "2026-11-01", to: "2026-11-30" });
    expect(journalTotals(all)).toEqual({ incoming: 500, expenses: 150, withdrawals: 50, outgoing: 200, balance: 300 });
    expect(filterJournal(moneyJournal(data), { kind: "in" }).every((r) => r.kind === "in")).toBe(true);
    expect(filterJournal(moneyJournal(data), { search: "сбер" }).map((r) => r.amount)).toEqual([300]);
  });

  it("выгружает журнал в Excel с колонками «Пришло» и «Ушло»", () => {
    const rows = filterJournal(moneyJournal(data), { from: "2026-11-01", to: "2026-11-30" });
    const wb = buildJournalWorkbook(XLSX, rows, { from: "2026-11-01", to: "2026-11-30" });
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets["Журнал денег"], { header: 1 });
    expect(sheet[1]).toEqual(expect.arrayContaining(["07.11.2026", "Вывод", "", 50]));
    expect(sheet.at(-1)).toEqual(expect.arrayContaining(["Разница (пришло − ушло)", 300]));
  });
});

describe("дата первоначального взноса", () => {
  const base = { id: "d", clientName: "Бурана", item: "Товар", totalPrice: 28000, downPayment: 10000, markup: 8400, termMonths: 6, startDate: "2026-11-10", payments: {} };
  const downDate = (c) => moneyJournal({ contracts: [c] }).find((r) => r.detail.startsWith("Первоначальный")).date;
  it("берётся из даты составления договора", () => expect(downDate({ ...base, contractDate: "2026-10-17", createdAt: "2026-10-18T18:46:49Z" })).toBe("2026-10-17"));
  it("иначе — день внесения договора в программу, а не первый платёж", () => expect(downDate({ ...base, createdAt: "2026-10-18T12:00:00Z" })).toBe("2026-10-18"));
  it("в крайнем случае — дата первого платежа", () => expect(downDate(base)).toBe("2026-11-10"));
});
