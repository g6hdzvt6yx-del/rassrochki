import { formatPhoneForExcel } from "./phone";
import { duePeriodReportData } from "./duePeriodReportData";

export const DUE_LIST_LABELS = { all: "Должны были оплатить", paid: "Оплатили полностью", unpaid: "Не оплатили или частично" };
const STATE_LABELS = { paid: "Оплачен", partial: "Оплачен частично", unpaid: "Не оплачен" };
const ruDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

// Строки выгрузки: при выбранной плитке берутся только договоры этой группы, иначе — все.
export function duePeriodExportRows(summary, list = "") {
  const ids = list && summary.contractIds[list];
  return ids ? summary.rows.filter((row) => ids.has(row.contractId)) : summary.rows;
}

// Имя латиницей: так файл сохраняется с этим именем в любом браузере.
export function duePeriodFileName(from, to, list = "") {
  const month = from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01") && new Date(+to.slice(0, 4), +to.slice(5, 7), 0).getDate() === +to.slice(8, 10);
  const period = month ? from.slice(0, 7) : `${from}_${to}`;
  const part = list === "paid" ? "_oplatili" : list === "unpaid" ? "_ne_oplatili" : "";
  return `dolzhny_oplatit_${period}${part}.xlsx`;
}

export function buildDuePeriodWorkbook(XLSX, { summary, list = "", periodLabel, from, to, investorName = () => "", receipts = null }) {
  const rows = duePeriodExportRows(summary, list);
  const clients = new Set(rows.map((row) => row.clientName.trim().toLocaleLowerCase("ru"))).size;
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const wb = XLSX.utils.book_new();
  const report = duePeriodReportData(summary, { list, receipts });
  const money = (sheet, cells) => cells.forEach(([r, c]) => { const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === "number") cell.z = "#,##0"; });

  const header = ["№", "ФИО клиента", "Телефон", "Товар", "Платёж №", "Срок оплаты", "По графику, ₽", "Внесено, ₽", "в т.ч. прибыль, ₽", "Осталось, ₽", "Дата оплаты", "Статус", "Источник финансирования"];
  const body = rows.map((row, i) => [
    i + 1, row.clientName, formatPhoneForExcel(row.phone), row.item, row.paymentNo, ruDate(row.dueDate),
    row.amount, row.paid, Math.round(row.paid * (row.profitShare || 0)), row.remaining, ruDate(row.lastPaidDate),
    STATE_LABELS[row.state] + (row.overdue ? ", просрочен" : ""), investorName(row.investorId),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([
    [`${DUE_LIST_LABELS[list || "all"]} · ${periodLabel} (${ruDate(from)} — ${ruDate(to)})`], [],
    header, ...body, [],
    ["", "Итого", `Клиентов: ${clients}`, `Платежей: ${rows.length}`, "", "", sum("amount"), sum("paid"), report.paid.profit, sum("remaining")],
  ]);
  sheet["!cols"] = [{ wch: 5 }, { wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 9 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 24 }, { wch: 24 }];
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + body.length, c: header.length - 1 } }) };
  for (let r = 3; r <= 4 + body.length; r += 1) money(sheet, [[r, 6], [r, 7], [r, 8], [r, 9]]);
  XLSX.utils.book_append_sheet(wb, sheet, "Платежи за период");

  const percent = `${String(report.collectedPercent).replace(".", ",")} %`;
  const totalsRows = [
    ["Период", `${periodLabel} (${ruDate(from)} — ${ruDate(to)})`],
    ["Выборка", DUE_LIST_LABELS[list || "all"]],
    [],
    ["Платежи по графику за период", "Клиентов", "Сумма, ₽", "в т.ч. прибыль, ₽"],
    ["Должны были оплатить", report.due.clients, report.due.sum, report.due.profit],
    [`Оплатили (полностью — ${report.paid.full}, частично — ${report.paid.partial})`, report.paid.clients, report.paid.sum, report.paid.profit],
    [`Остаток к оплате (частично — ${report.remaining.partial}, не платили — ${report.remaining.none})`, report.remaining.clients, report.remaining.sum, report.remaining.profit],
    ["Процент сбора", "", percent],
    ["Платежей по графику", report.due.payments],
  ];
  if (receipts) {
    totalsRows.push([], ["Поступления за период (фактически получено)", "Платежей", "Сумма, ₽", "в т.ч. прибыль, ₽"],
      ...receipts.byKind.map((k) => [k.label, k.count, k.amount, k.profit]),
      ["Всего поступлений", receipts.count, receipts.total, receipts.profit]);
    if (receipts.downPayments) totalsRows.push(["в т.ч. первоначальные взносы (без прибыли)", "", receipts.downPayments]);
  }
  totalsRows.push([], ["Оплата учитывается на дату выгрузки, даже если внесена позже срока. Прибыль — доля наценки в сумме платежа."]);
  if (list && list !== "all") totalsRows.push(["Все цифры — только по договорам выборки."]);
  const totals = XLSX.utils.aoa_to_sheet(totalsRows);
  totals["!cols"] = [{ wch: 52 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
  totalsRows.forEach((_, r) => money(totals, [[r, 2], [r, 3]]));
  XLSX.utils.book_append_sheet(wb, totals, "Итоги");

  if (receipts) {
    const recBody = receipts.rows.map((e, i) => [i + 1, ruDate(e.date), e.client || "", e.item || "", e.purpose || "", e.kind, e.amount, Math.round(e.profit), e.comment || ""]);
    const rec = XLSX.utils.aoa_to_sheet([
      [`Поступления · ${periodLabel} (${ruDate(from)} — ${ruDate(to)})${list && list !== "all" ? ` · ${DUE_LIST_LABELS[list]}` : ""}`], [],
      ["№", "Дата", "Клиент", "Товар", "Назначение", "Вид поступления", "Сумма, ₽", "в т.ч. прибыль, ₽", "Комментарий"],
      ...recBody, [],
      ["", "Итого", "", "", "", `Платежей: ${receipts.count}`, receipts.total, receipts.profit],
    ]);
    rec["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 26 }, { wch: 13 }, { wch: 16 }, { wch: 28 }];
    if (recBody.length) rec["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + recBody.length, c: 8 } }) };
    for (let r = 3; r <= 4 + recBody.length; r += 1) money(rec, [[r, 6], [r, 7]]);
    XLSX.utils.book_append_sheet(wb, rec, "Поступления");
  }
  return { wb, rows: rows.length };
}
