import { receiptsOf } from './receipts';
import { addMonthsClamped, splitScheduleAmount } from "./finance";
import { formatPhoneForExcel } from "./phone";
import { actualPaid } from "./contractSafety";

const localDate = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
};

const localDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
};

const parse = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

const shortJson = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > 32000 ? `${text.slice(0, 31980)}…` : text;
};

const addSheet = (XLSX, workbook, name, headers, rows, widths = []) => {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  if (rows.length) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: rows.length, c: headers.length - 1 }) };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
};

const textColumns = (XLSX, sheet, columns) => {
  if (!sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  columns.forEach((column) => {
    for (let row = 1; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      cell.t = "s"; cell.v = String(cell.v ?? ""); cell.z = "@";
    }
  });
};

const rowData = (row) => ({ ...parse(row.data), __id: row.id, __deletedAt: row.deleted_at || "", __deletedBy: row.deleted_by || "" });

export function buildFullExcelBackupWorkbook(XLSX, snapshot) {
  const workbook = XLSX.utils.book_new();
  const contracts = (snapshot.contracts || []).map(rowData);
  const investors = (snapshot.investors || []).map(rowData);
  const withdrawals = (snapshot.withdrawals || []).map(rowData);
  const activeContracts = contracts.filter((item) => !item.__deletedAt);

  addSheet(XLSX, workbook, "Сводка", ["Показатель", "Значение"], [
    ["Дата создания копии", localDateTime(snapshot.createdAt)],
    ["Активных договоров", activeContracts.length],
    ["Договоров в корзине", contracts.length - activeContracts.length],
    ["Вкладчиков", investors.filter((item) => !item.__deletedAt).length],
    ["Выводов средств", withdrawals.filter((item) => !item.__deletedAt).length],
    ["Записей журнала", (snapshot.actions || []).length],
    ["Черновиков", (snapshot.drafts || []).length],
    ["Важно", "Файл является ежедневной читаемой копией данных. Полная техническая копия SQLite и вложений создаётся приложением отдельно."],
  ], [34, 90]);

  const contractSheet = addSheet(XLSX, workbook, "Договоры", [
    "ID", "Клиент", "Телефон", "Товар", "Цена", "Первоначальный взнос", "Наценка", "Наценка, %",
    "Срок, мес", "Дата первого платежа", "Источник финансирования", "Комментарий", "Поручитель", "Телефон поручителя", "Удалён",
  ], contracts.map((item) => [
    item.id || item.__id, item.client_name || item.clientName || "", formatPhoneForExcel(item.phone), item.item || "",
    +item.total_price || +item.totalPrice || 0, +item.down_payment || +item.downPayment || 0, +item.markup || 0,
    +item.markup_percent || +item.markupPercent || 0, +item.term_months || +item.termMonths || 1,
    localDate(item.start_date || item.startDate), item.investor_id || item.investorId || "Общий пул", item.comment || "",
    item.guarantor_name || item.guarantorName || "", formatPhoneForExcel(item.guarantor_phone || item.guarantorPhone),
    item.__deletedAt ? localDateTime(item.__deletedAt) : "",
  ]), [24, 25, 18, 25, 14, 18, 14, 12, 11, 18, 24, 36, 25, 18, 20]);
  textColumns(XLSX, contractSheet, [2, 13]);

  const scheduleRows = [];
  const eventRows = [];
  const contactRows = [];
  const receiptRows = [];
  contracts.forEach((contract) => {
    const payments = contract.payments || {};
    const principal = Math.max(0, (+contract.total_price || +contract.totalPrice || 0) - (+contract.down_payment || +contract.downPayment || 0));
    const term = Math.max(1, +contract.term_months || +contract.termMonths || 1);
    const amounts = splitScheduleAmount(principal + (+contract.markup || 0), term);
    amounts.forEach((scheduledAmount, index) => {
      const payment = payments[index] || {};
      const paidAmount = actualPaid(payment, scheduledAmount);
      const scheduledDate = addMonthsClamped(contract.start_date || contract.startDate, index);
      const currentDate = payment.deferredUntil || (Number.isNaN(scheduledDate.getTime()) ? "" : scheduledDate);
      const status = paidAmount >= scheduledAmount ? "Оплачен" : paidAmount > 0 ? "Частично" : new Date(currentDate) < new Date(new Date().setHours(0, 0, 0, 0)) ? "Просрочен" : "Ожидает";
      scheduleRows.push([
        contract.id || contract.__id, contract.client_name || contract.clientName || "", formatPhoneForExcel(contract.phone),
        contract.item || "", index + 1, localDate(scheduledDate), localDate(currentDate), scheduledAmount, paidAmount,
        scheduledAmount - paidAmount, status, localDate(payment.paidDate), payment.notifiedAt ? localDateTime(payment.notifiedAt) : "",
        payment.deferredUntil ? localDate(payment.deferredUntil) : "", payment.deferralReason || "", contract.__deletedAt ? "Да" : "Нет",
      ]);
      const events = Array.isArray(payment.paymentEvents) && payment.paymentEvents.length
        ? payment.paymentEvents
        : (payment.paidDate && paidAmount > 0 ? [{ date: payment.paidDate, amount: paidAmount, legacy: true }] : []);
      events.forEach((event) => eventRows.push([
        contract.id || contract.__id, contract.client_name || contract.clientName || "", formatPhoneForExcel(contract.phone),
        contract.item || "", index + 1, localDate(event.date), +event.amount || 0, event.comment || "",
        event.earlyPayoff ? "Да" : "Нет", event.createdAt ? localDateTime(event.createdAt) : "", contract.__deletedAt ? "Да" : "Нет",
      ]));
      receiptsOf(payment).forEach((receipt) => receiptRows.push([
        contract.id || contract.__id, contract.client_name || contract.clientName || "", index + 1,
        receipt.name || "", receipt.path || "", "Активный", "",
      ]));
    });
    (Array.isArray(payments.__contacts) ? payments.__contacts : []).forEach((contact) => contactRows.push([
      contract.id || contract.__id, contract.client_name || contract.clientName || "", formatPhoneForExcel(contract.phone),
      contact.type || "", localDateTime(contact.occurredAt), contact.note || "", localDate(contact.promisedDate),
      +contact.promisedAmount || 0, localDate(contact.nextContactDate), contract.__deletedAt ? "Да" : "Нет",
    ]));
  });

  const scheduleSheet = addSheet(XLSX, workbook, "График платежей", [
    "ID договора", "Клиент", "Телефон", "Товар", "№ платежа", "Дата по графику", "Дата с отсрочкой",
    "Платёж", "Оплачено", "Остаток", "Статус", "Дата оплаты", "Уведомление WhatsApp", "Отсрочка до", "Причина отсрочки", "Договор удалён",
  ], scheduleRows, [24, 25, 18, 24, 11, 17, 17, 14, 14, 14, 13, 16, 22, 16, 32, 15]);
  textColumns(XLSX, scheduleSheet, [2]);

  const eventsSheet = addSheet(XLSX, workbook, "Фактические оплаты", [
    "ID договора", "Клиент", "Телефон", "Товар", "№ платежа", "Дата оплаты", "Сумма", "Комментарий", "Досрочное погашение", "Записано", "Договор удалён",
  ], eventRows, [24, 25, 18, 24, 11, 16, 14, 40, 20, 20, 15]);
  textColumns(XLSX, eventsSheet, [2]);

  const investorSheet = addSheet(XLSX, workbook, "Вкладчики", [
    "ID", "Имя", "Сумма вложений", "Ежемесячная выплата", "Начало начислений", "Комментарий", "Удалён",
  ], investors.map((item) => [
    item.id || item.__id, item.name || "", +item.amount || 0, +item.monthly_payment || +item.monthlyPayment || 0,
    localDate(item.accrual_start_date || item.accrualStartDate), item.comment || "", item.__deletedAt ? localDateTime(item.__deletedAt) : "",
  ]), [24, 28, 18, 20, 18, 36, 20]);

  addSheet(XLSX, workbook, "Выводы средств", ["ID", "Дата", "Сумма", "Назначение", "Вкладчик", "Комментарий", "Удалён"],
    withdrawals.map((item) => [
      item.id || item.__id, localDate(item.date), +item.amount || 0, item.purpose || "", item.investor_id || item.investorId || "",
      item.note || item.comment || "", item.__deletedAt ? localDateTime(item.__deletedAt) : "",
    ]), [24, 16, 16, 24, 24, 36, 20]);

  const contactsSheet = addSheet(XLSX, workbook, "История контактов", [
    "ID договора", "Клиент", "Телефон", "Тип", "Дата и время", "Результат", "Обещанная дата", "Обещанная сумма", "Следующий контакт", "Договор удалён",
  ], contactRows, [24, 25, 18, 14, 20, 45, 18, 18, 18, 15]);
  textColumns(XLSX, contactsSheet, [2]);

  addSheet(XLSX, workbook, "Журнал действий", [
    "Дата и время", "Действие", "Тип объекта", "ID объекта", "Название", "Источник", "Результат", "Ошибка", "Было", "Стало",
  ], (snapshot.actions || []).map((item) => [
    localDateTime(item.occurred_at), item.action_type || "", item.entity_type || "", item.entity_id || "", item.entity_name || "",
    item.source || "", item.result || "", item.error_message || "", shortJson(item.before_json), shortJson(item.after_json),
  ]), [21, 24, 18, 25, 30, 16, 14, 35, 70, 70]);

  addSheet(XLSX, workbook, "Черновики", ["ID", "Тип", "Название", "Заполнено, %", "Изменён", "Данные"],
    (snapshot.drafts || []).map((item) => [
      item.id, item.draft_type || "", item.title || "", +item.completion || 0, localDateTime(item.updated_at), shortJson(item.data),
    ]), [28, 25, 30, 15, 21, 90]);

  (snapshot.deletedReceipts || []).forEach((item) => {
    const receipt = parse(item.data);
    receiptRows.push([item.contract_id, "", +item.payment_index + 1, receipt.name || "", receipt.path || item.id || "", "В корзине", localDateTime(item.deleted_at)]);
  });
  addSheet(XLSX, workbook, "Чеки и вложения", ["ID договора", "Клиент", "№ платежа", "Файл", "Локальный путь", "Статус", "Удалён"],
    receiptRows, [24, 25, 12, 35, 60, 14, 20]);

  const trashRows = [
    ...contracts.filter((item) => item.__deletedAt).map((item) => ["Договор", item.id || item.__id, item.client_name || item.clientName || "", localDateTime(item.__deletedAt), item.__deletedBy]),
    ...investors.filter((item) => item.__deletedAt).map((item) => ["Вкладчик", item.id || item.__id, item.name || "", localDateTime(item.__deletedAt), item.__deletedBy]),
    ...withdrawals.filter((item) => item.__deletedAt).map((item) => ["Вывод", item.id || item.__id, item.note || item.purpose || "", localDateTime(item.__deletedAt), item.__deletedBy]),
    ...(snapshot.deletedReceipts || []).map((item) => ["Чек", item.id, parse(item.data).name || "", localDateTime(item.deleted_at), item.deleted_by || ""]),
  ];
  addSheet(XLSX, workbook, "Корзина", ["Тип", "ID", "Название", "Удалён", "Кем удалён"], trashRows, [16, 32, 38, 21, 20]);

  return workbook;
}
