import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ')} руб.`;
const date = (value) => {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ru-RU');
};
export function contractPdfFilename(contract) {
  const name = String(contract.clientName || 'Клиент').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 80);
  return `Договор - ${name} - ${String(contract.startDate || '').slice(0, 10)}.pdf`;
}

// Embedded font keeps Cyrillic readable on the recipient's device, offline.
export function createContractPdf(contract, stats, fontBase64) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', fontBase64);
  doc.addFont('DejaVuSans.ttf', 'Contract', 'normal');
  doc.setFont('Contract');
  doc.setProperties({ title: `Договор рассрочки - ${contract.clientName || ''}`, creator: 'Рассрочки' });
  doc.setTextColor('#16332E');
  doc.setFontSize(20);
  doc.text('Договор рассрочки', 16, 22);
  doc.setFontSize(10);
  doc.text(`Дата договора: ${date(contract.startDate)}`, 16, 31);
  const styles = { font: 'Contract', fontStyle: 'normal', fontSize: 9, cellPadding: 2, overflow: 'linebreak', textColor: '#16332E' };
  autoTable(doc, {
    startY: 38, margin: { left: 16, right: 16 }, theme: 'plain', styles,
    columnStyles: { 0: { cellWidth: 62, textColor: '#52665F' } },
    body: [
      ['Клиент', contract.clientName || '-'], ['Телефон', contract.phone || '-'],
      ['Товар', contract.item || 'Не указан'],
      ['Сумма договора', money((+stats.financed || 0) + (+contract.downPayment || 0))],
      ...(+contract.downPayment > 0 ? [['Первоначальный взнос', money(contract.downPayment)]] : []),
      ['Всего оплачено', money((+stats.paidSum || 0) + (+contract.downPayment || 0))],
      ['Остаток к оплате', money(stats.remaining)],
      ...(contract.guarantorName ? [['Поручитель', contract.guarantorName],
        ...(contract.guarantorPhone ? [['Телефон поручителя', contract.guarantorPhone]] : [])] : []),
    ],
  });
  let y = doc.lastAutoTable.finalY + 10;
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFontSize(12); doc.text('График платежей', 16, y);
  autoTable(doc, {
    startY: y + 5, margin: { top: 18, bottom: 20, left: 16, right: 16 }, styles,
    headStyles: { fillColor: '#16332E', textColor: '#FFFFFF', fontStyle: 'normal' },
    alternateRowStyles: { fillColor: '#F0F4EF' }, rowPageBreak: 'avoid',
    head: [['№', 'Срок оплаты', 'Сумма', 'Оплачено', 'Остаток']],
    body: stats.rows.map((r) => [String(r.n), date(r.dueDate), money(r.amountDue), money(r.paidAmount), money(r.remainingDue)]),
    columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 32 } },
  });
  y = doc.lastAutoTable.finalY + 18;
  if (y > 260) { doc.addPage(); y = 30; }
  doc.setFontSize(9);
  doc.text('Продавец: ____________________', 16, y);
  doc.text('Клиент: ____________________', 112, y);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor('#52665F');
    doc.text('Сведения и оплаты на дату формирования: ' + date(new Date()), 16, 286);
    doc.text(`${page} / ${pages}`, 194, 286, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
