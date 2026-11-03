import { formatPhoneForExcel } from "./phone";

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

export function buildDuePeriodWorkbook(XLSX, { summary, list = "", periodLabel, from, to, investorName = () => "" }) {
  const rows = duePeriodExportRows(summary, list);
  const clients = new Set(rows.map((row) => row.clientName.trim().toLocaleLowerCase("ru"))).size;
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const wb = XLSX.utils.book_new();

  const header = ["№", "ФИО клиента", "Телефон", "Товар", "Платёж №", "Срок оплаты", "По графику, ₽", "Внесено, ₽", "Осталось, ₽", "Дата оплаты", "Статус", "Источник финансирования"];
  const body = rows.map((row, i) => [
    i + 1, row.clientName, formatPhoneForExcel(row.phone), row.item, row.paymentNo, ruDate(row.dueDate),
    row.amount, row.paid, row.remaining, ruDate(row.lastPaidDate),
    STATE_LABELS[row.state] + (row.overdue ? ", просрочен" : ""), investorName(row.investorId),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([
    [`${DUE_LIST_LABELS[list || "all"]} · ${periodLabel} (${ruDate(from)} — ${ruDate(to)})`], [],
    header, ...body, [],
    ["", "Итого", `Клиентов: ${clients}`, `Платежей: ${rows.length}`, "", "", sum("amount"), sum("paid"), sum("remaining")],
  ]);
  sheet["!cols"] = [{ wch: 5 }, { wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 9 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 24 }, { wch: 24 }];
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + body.length, c: header.length - 1 } }) };
  for (let r = 3; r < 3 + body.length; r += 1) for (const c of [6, 7, 8]) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = "#,##0";
  }
  XLSX.utils.book_append_sheet(wb, sheet, "Платежи за период");

  const totals = XLSX.utils.aoa_to_sheet([
    ["Период", `${periodLabel} (${ruDate(from)} — ${ruDate(to)})`],
    ["Фильтр", DUE_LIST_LABELS[list || "all"]],
    [],
    ["Должны были оплатить, клиентов", summary.clients],
    ["Оплатили полностью, клиентов", summary.paidClients],
    ["Не оплатили или частично, клиентов", summary.unpaidClients],
    ["Платежей по графику", summary.payments],
    ["По графику, ₽", summary.scheduled],
    ["Внесено, ₽", summary.paid],
    ["Осталось, ₽", summary.remaining],
    [],
    ["Оплата учитывается на дату выгрузки, даже если внесена позже срока."],
  ]);
  totals["!cols"] = [{ wch: 36 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, totals, "Итоги");
  return { wb, rows: rows.length };
}
