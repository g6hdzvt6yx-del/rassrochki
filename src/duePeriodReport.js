import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

// Цифры справки для руководителя: по клиентам, без учёта выбранной плитки.
// Клиент с несколькими договорами считается один раз.
export function duePeriodReportData(summary) {
  const byClient = new Map();
  summary.rows.forEach((row) => {
    const key = row.clientName.trim().toLocaleLowerCase("ru") || `#${row.contractId}`;
    if (!byClient.has(key)) byClient.set(key, {
      name: row.clientName.trim(), phone: row.phone, scheduled: 0, paid: 0, remaining: 0,
      payments: 0, firstUnpaid: "", lastPaidDate: "", overdue: false,
    });
    const c = byClient.get(key);
    c.scheduled += row.amount; c.paid += row.paid; c.remaining += row.remaining; c.payments += 1;
    if (!c.phone && row.phone) c.phone = row.phone;
    if (row.remaining > 0 && (!c.firstUnpaid || row.dueDate < c.firstUnpaid)) c.firstUnpaid = row.dueDate;
    if (row.lastPaidDate > c.lastPaidDate) c.lastPaidDate = row.lastPaidDate;
    if (row.overdue) c.overdue = true;
  });
  const clients = [...byClient.values()];
  const full = clients.filter((c) => c.remaining <= 0);
  const partial = clients.filter((c) => c.remaining > 0 && c.paid > 0);
  const none = clients.filter((c) => c.remaining > 0 && c.paid <= 0);
  const sum = (list, key) => list.reduce((total, c) => total + c[key], 0);
  const scheduled = sum(clients, "scheduled"), paid = sum(clients, "paid"), remaining = sum(clients, "remaining");
  return {
    due: { clients: clients.length, sum: scheduled, payments: sum(clients, "payments") },
    paid: { clients: full.length + partial.length, sum: paid, full: full.length, partial: partial.length },
    remaining: { clients: partial.length + none.length, sum: remaining, partial: partial.length, none: none.length },
    overdueClients: clients.filter((c) => c.overdue).length,
    collectedPercent: scheduled > 0 ? Math.round((paid / scheduled) * 1000) / 10 : 0,
    debtors: [...partial, ...none].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "ru")),
    paidClients: full.sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}

const rub = (value) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU").replace(/\s/g, " ")} руб.`;
const num = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU").replace(/\s/g, " ");
const ruDate = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
export const clientsWord = (n) => `${n} ${plural(n, "клиент", "клиента", "клиентов")}`;

export function duePeriodReportFileName(from, to) {
  const month = from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")
    && new Date(+to.slice(0, 4), +to.slice(5, 7), 0).getDate() === +to.slice(8, 10);
  return `spravka_platezhi_${month ? from.slice(0, 7) : `${from}_${to}`}.pdf`;
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

  doc.setTextColor(ink); doc.setFontSize(17);
  doc.text("Справка о платежах по рассрочкам", 16, 22);
  doc.setFontSize(11);
  doc.text(`Период: ${periodLabel} (${ruDate(from)} — ${ruDate(to)})`, 16, 30);
  doc.setFontSize(9); doc.setTextColor(soft);
  doc.text(`Сформирована ${today}${author ? ` · ${author}` : ""}. Оплаты учтены на дату формирования.`, 16, 36);

  autoTable(doc, {
    startY: 42, margin: { left: 16, right: 16 }, styles: { ...styles, fontSize: 10, cellPadding: 3 }, headStyles: head,
    head: [["Показатель", "Клиентов", "Сумма"]],
    body: [
      ["Должны были оплатить по графику", String(report.due.clients), rub(report.due.sum)],
      [`Оплатили\n(полностью — ${report.paid.full}, частично — ${report.paid.partial})`, String(report.paid.clients), rub(report.paid.sum)],
      [`Остаток к оплате\n(частично — ${report.remaining.partial}, не платили — ${report.remaining.none})`, String(report.remaining.clients), rub(report.remaining.sum)],
      ["Процент сбора", "", `${String(report.collectedPercent).replace(".", ",")} %`],
    ],
    columnStyles: { 1: { halign: "center", cellWidth: 28 }, 2: { halign: "right", cellWidth: 46 } },
    didParseCell: (cell) => {
      if (cell.section === "head" && cell.column.index > 0) cell.cell.styles.halign = cell.column.index === 1 ? "center" : "right";
      if (cell.section !== "body") return;
      if (cell.row.index === 1 && cell.column.index > 0) cell.cell.styles.textColor = "#1F7A55";
      if (cell.row.index === 2 && cell.column.index > 0) cell.cell.styles.textColor = "#B4443B";
    },
  });

  let y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(9); doc.setTextColor(soft);
  const lines = [
    `Платежей по графику за период: ${report.due.payments}.`,
    report.overdueClients ? `С просрочкой на сегодня: ${clientsWord(report.overdueClients)}.` : "Просрочек по платежам этого периода на сегодня нет.",
    "Клиент с несколькими договорами считается один раз.",
  ];
  lines.forEach((line) => { doc.text(line, 16, y); y += 5; });

  const section = (title, headRow, body, columnStyles) => {
    y += 5;
    if (y > 255) { doc.addPage(); y = 20; }
    doc.setFontSize(12); doc.setTextColor(ink); doc.text(title, 16, y);
    if (!body.length) { doc.setFontSize(9); doc.setTextColor(soft); doc.text("Нет", 16, y + 6); y += 10; return; }
    autoTable(doc, {
      startY: y + 4, margin: { top: 18, bottom: 20, left: 16, right: 16 }, styles: { ...styles, fontSize: 8.5, cellPadding: 1.8 }, headStyles: head,
      alternateRowStyles: { fillColor: "#F0F4EF" }, rowPageBreak: "avoid", head: [headRow], body, columnStyles,
      didParseCell: (cell) => {
        if (columnStyles[cell.column.index]?.halign === "right") cell.cell.styles.halign = "right";
      },
    });
    y = doc.lastAutoTable.finalY + 4;
  };
  section(`Остаток к оплате — ${clientsWord(report.debtors.length)}`,
    ["№", "Клиент", "Телефон", "По графику, руб.", "Оплачено, руб.", "Остаток, руб.", "Срок"],
    report.debtors.map((c, i) => [String(i + 1), c.name + (c.overdue ? "\nпросрочка" : ""), formatPhone(c.phone), num(c.scheduled), num(c.paid), num(c.remaining), ruDate(c.firstUnpaid)]),
    { 0: { cellWidth: 8 }, 2: { cellWidth: 34 }, 3: { cellWidth: 22, halign: "right" }, 4: { cellWidth: 22, halign: "right" }, 5: { cellWidth: 22, halign: "right" }, 6: { cellWidth: 23 } });
  section(`Оплатили полностью — ${clientsWord(report.paidClients.length)}`,
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
    doc.text(`Справка о платежах · ${periodLabel}`, 16, 286);
    doc.text(`${page} / ${pages}`, 194, 286, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
