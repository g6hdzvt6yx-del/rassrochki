import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export { REPORT_GROUP_LABELS, duePeriodReportData } from "./duePeriodReportData";
import { REPORT_GROUP_LABELS } from "./duePeriodReportData";

const rub = (value) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU").replace(/\s/g, " ")} руб.`;
const num = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU").replace(/\s/g, " ");
const ruDate = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
export const clientsWord = (n) => `${n} ${plural(n, "клиент", "клиента", "клиентов")}`;

export function duePeriodReportFileName(from, to, list = "") {
  const month = from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")
    && new Date(+to.slice(0, 4), +to.slice(5, 7), 0).getDate() === +to.slice(8, 10);
  const part = list === "paid" ? "_oplatili" : list === "unpaid" ? "_ne_oplatili" : "";
  return `spravka_platezhi_${month ? from.slice(0, 7) : `${from}_${to}`}${part}.pdf`;
}

// PDF со встроенным шрифтом: кириллица читается на любом устройстве.
export function createDuePeriodReportPdf(report, { periodLabel, from, to, author = "", formatPhone = (p) => p || "", fontBase64, now = new Date() }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("DejaVuSans.ttf", fontBase64);
  doc.addFont("DejaVuSans.ttf", "Report", "normal");
  doc.setFont("Report");
  doc.setProperties({ title: `Справка о платежах — ${periodLabel}`, creator: "Eppaz" });
  const ink = "#16332E", soft = "#52665F";
  const styles = { font: "Report", fontStyle: "normal", fontSize: 9, cellPadding: 2, overflow: "linebreak", textColor: ink };
  const head = { fillColor: ink, textColor: "#FFFFFF", fontStyle: "normal" };
  const today = now.toLocaleDateString("ru-RU");

  const filtered = report.list !== "all";
  doc.setTextColor(ink); doc.setFontSize(17);
  doc.text("Справка о платежах по рассрочкам", 16, 22);
  doc.setFontSize(11);
  doc.text(`Период: ${periodLabel} (${ruDate(from)} — ${ruDate(to)})`, 16, 30);
  let y = 36;
  if (filtered) { doc.setTextColor("#7750D5"); doc.text(`Выборка: ${REPORT_GROUP_LABELS[report.list]}`, 16, y); y += 6; }
  doc.setFontSize(9); doc.setTextColor(soft);
  doc.text(`Сформирована ${today}${author ? ` · ${author}` : ""}. Оплаты учтены на дату формирования.`, 16, y);
  y += 4;

  let part = 0;
  const title = (text) => {
    y += 6;
    if (y > 250) { doc.addPage(); y = 20; }
    part += 1;
    doc.setFontSize(12); doc.setTextColor(ink); doc.text(`${part}. ${text}`, 16, y);
    y += 3;
  };
  const note = (lines) => {
    doc.setFontSize(8.5); doc.setTextColor(soft);
    lines.forEach((line) => doc.splitTextToSize(line, 178).forEach((piece) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(piece, 16, y); y += 4.3;
    }));
  };
  const totalsTable = (headRow, body, colors = {}, boldLast = false) => {
    autoTable(doc, {
      startY: y, margin: { top: 18, bottom: 20, left: 16, right: 16 }, styles: { ...styles, fontSize: 9.5, cellPadding: 2.6 }, headStyles: head,
      head: [headRow], body, rowPageBreak: "avoid",
      columnStyles: { 1: { halign: "center", cellWidth: 26 }, 2: { halign: "right", cellWidth: 34 }, 3: { halign: "right", cellWidth: 36 } },
      didParseCell: (cell) => {
        if (cell.section === "head" && cell.column.index > 0) cell.cell.styles.halign = cell.column.index === 1 ? "center" : "right";
        if (cell.section !== "body") return;
        if (colors[cell.row.index] && cell.column.index > 0) cell.cell.styles.textColor = colors[cell.row.index];
        if (boldLast && cell.row.index === body.length - 1) { cell.cell.styles.fillColor = "#E3ECE6"; cell.cell.styles.fontSize = 10; }
      },
    });
    y = doc.lastAutoTable.finalY + 5;
  };

  title("Платежи по графику за период");
  totalsTable(["Показатель", "Клиентов", "Сумма, руб.", "в т.ч. прибыль, руб."], [
    ["Должны были оплатить", String(report.due.clients), num(report.due.sum), num(report.due.profit)],
    [`Оплатили\n(полностью — ${report.paid.full}, частично — ${report.paid.partial})`, String(report.paid.clients), num(report.paid.sum), num(report.paid.profit)],
    [`Остаток к оплате\n(частично — ${report.remaining.partial}, не платили — ${report.remaining.none})`, String(report.remaining.clients), num(report.remaining.sum), num(report.remaining.profit)],
    ["Процент сбора", "", `${String(report.collectedPercent).replace(".", ",")} %`, ""],
  ], { 1: "#1F7A55", 2: "#B4443B" });
  note([
    `Платежей по графику за период: ${report.due.payments}. ${report.overdueClients ? `С просрочкой на сегодня: ${clientsWord(report.overdueClients)}.` : "Просрочек по этим платежам на сегодня нет."}`,
    "Прибыль — доля наценки в сумме платежа. Клиент с несколькими договорами считается один раз.",
  ]);

  const receipts = report.receipts;
  if (receipts) {
    title("Поступления за период — фактически получено");
    if (receipts.count) {
      totalsTable(["Вид поступления", "Платежей", "Сумма, руб.", "в т.ч. прибыль, руб."], [
        ...receipts.byKind.map((k) => [k.label, String(k.count), num(k.amount), num(k.profit)]),
        ["Всего поступлений", String(receipts.count), num(receipts.total), num(receipts.profit)],
      ], {}, true);
    } else note(["Поступлений за период нет."]);
    note([
      `Все деньги, полученные с ${ruDate(from)} по ${ruDate(to)} по дате оплаты: платежи этого периода, погашение прошлых долгов и досрочные платежи${receipts.downPayments ? `, первоначальные взносы — ${rub(receipts.downPayments)} (прибыль с них не начисляется)` : ""}.`,
      ...(filtered ? ["Учтены поступления только по договорам выборки."] : []),
    ]);
  }

  const section = (text, headRow, body, columnStyles) => {
    title(text);
    autoTable(doc, {
      startY: y + 1, margin: { top: 18, bottom: 20, left: 16, right: 16 }, styles: { ...styles, fontSize: 8.5, cellPadding: 1.8 }, headStyles: head,
      alternateRowStyles: { fillColor: "#F0F4EF" }, rowPageBreak: "avoid", head: [headRow], body, columnStyles,
      didParseCell: (cell) => {
        if (columnStyles[cell.column.index]?.halign === "right") cell.cell.styles.halign = "right";
      },
    });
    y = doc.lastAutoTable.finalY + 2;
  };
  if (report.list !== "paid" && report.debtors.length) section(`Остаток к оплате — ${clientsWord(report.debtors.length)}`,
    ["№", "Клиент", "Телефон", "По графику, руб.", "Оплачено, руб.", "Остаток, руб.", "Срок"],
    report.debtors.map((c, i) => [String(i + 1), c.name + (c.overdue ? "\nпросрочка" : ""), formatPhone(c.phone), num(c.scheduled), num(c.paid), num(c.remaining), ruDate(c.firstUnpaid)]),
    { 0: { cellWidth: 8 }, 2: { cellWidth: 34 }, 3: { cellWidth: 22, halign: "right" }, 4: { cellWidth: 22, halign: "right" }, 5: { cellWidth: 22, halign: "right" }, 6: { cellWidth: 23 } });
  if (report.list !== "unpaid" && report.paidClients.length) section(`Оплатили полностью — ${clientsWord(report.paidClients.length)}`,
    ["№", "Клиент", "Телефон", "Оплачено, руб.", "Дата оплаты"],
    report.paidClients.map((c, i) => [String(i + 1), c.name, formatPhone(c.phone), num(c.paid), ruDate(c.lastPaidDate)]),
    { 0: { cellWidth: 8 }, 2: { cellWidth: 34 }, 3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 25 } });

  y += 12;
  if (y > 265) { doc.addPage(); y = 30; }
  doc.setFontSize(9); doc.setTextColor(ink);
  doc.text("Подготовил: ____________________", 16, y);
  doc.text(`Дата: ${today}`, 140, y);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(soft);
    doc.text(`Справка о платежах · ${periodLabel}${filtered ? ` · ${REPORT_GROUP_LABELS[report.list]}` : ""}`, 16, 286);
    doc.text(`${page} / ${pages}`, 194, 286, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
