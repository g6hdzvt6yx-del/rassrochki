import ContractTable from "./ContractTable";
import {overdueDays,daysLabel,staleNotification,matchesWorkView} from "./contractWorkbench";
import CashDesk, { PaymentDestination } from "./CashDesk";
import { cashCards, paymentDestination } from "./cash";
import { expectedPayments, dateInPeriod } from "./expectedPayments";
import Directories from "./Directories.jsx";
import WebSyncStatus from "./WebSyncStatus";
import { saveDirectoryClient } from "./directories";
import { waReminderLink } from "./whatsapp";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutGrid, ScrollText, Plus, Phone, Wallet, Users, AlertTriangle,
  CheckCircle2, Clock, ChevronLeft, X, Check, Undo2, CalendarDays,
  Landmark, TrendingUp, Trash2, Paperclip, FileText, ChevronDown,
  Upload, Download, LogOut, Search, Pencil, MessageCircle, Printer,
  Database, RotateCcw, History,
} from "lucide-react";
import { supabase, supabaseConfigured, isDesktopApp, localData, setActionSource, suppressNextActionLog } from "./dataClient";
import { addMonthsClamped, investorProfitBreakdown, profitComparisonByMonth, scheduledProfitSummary, receivedSummary, splitReceived, splitScheduleAmount } from "./finance";
import { formatPhone as fmtPhone, formatPhoneForExcel, normalizePhone } from "./phone";
import { allocateContractPayment, editPaymentEvent, deletePaymentEvent } from "./payments";
import { actualPaid, prepareContractEdit, draftContractId } from "./contractSafety";
import { flushLocalTasks } from "./localTasks";
import DateCalendar from "./DateCalendar";
import ClientCard from "./ClientCard";
import FinancialReport from "./FinancialReport.jsx";
import { changeDeferral } from "./deferrals";
import { clientContacts } from "./contacts";
import {useCallLogs} from "./useCallLogs";
import {callResults, latestCallResults, matchesCallResultFilter} from "./access";
import DataPanelBoundary from "./DataPanelBoundary";

const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;
const DataCenter = React.lazy(() => import("./DataCenter"));
const showAppMessage = (message, tone = "error") => window.dispatchEvent(new CustomEvent("rassrochki-message", { detail: { message, tone } }));

/* ------------------------------------------------------------------ */
/*  Утилиты                                                            */
/* ------------------------------------------------------------------ */

const money = (n) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";

const paymentWord = (count) => {
  const value = Math.abs(count) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return "платежей";
  if (last === 1) return "платёж";
  if (last >= 2 && last <= 4) return "платежа";
  return "платежей";
};

const fmtDate = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));

const openExternalUrl = async (url) => {
  try {
    if (isDesktopApp) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return true;
  } catch (error) {
    showAppMessage(`Не удалось открыть ссылку: ${error?.message || error}`);
    return false;
  }
};

const fmtDateTime = (iso) => iso ? new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso)) : "";

const localDateTimeInput = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const CONTACT_TYPES = {
  call: "Звонок", whatsapp: "WhatsApp", meeting: "Встреча", other: "Другое",
};

const toIsoDate = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

const addMonths = addMonthsClamped;

// разбиваем сумму на равные части, остаток кладём в последний платёж
const splitAmount = splitScheduleAmount;

const buildSchedule = (c) => {
  const financed = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0) + (+c.markup || 0));
  const amounts = splitAmount(financed, Math.max(1, +c.termMonths || 1));
  const today = startOfToday();
  return amounts.map((amt, i) => {
    const rec = c.payments && c.payments[i];
    const scheduledDue = addMonths(c.startDate, i);
    const deferredUntil = rec?.deferredUntil || "";
    const deferralHistory = Array.isArray(rec?.deferralHistory) ? rec.deferralHistory : [];
    const deferredDate = deferredUntil ? new Date(`${deferredUntil}T00:00:00`) : null;
    const due = deferredDate && !Number.isNaN(deferredDate.getTime()) ? deferredDate : scheduledDue;
    const paidAmount = actualPaid(rec, amt);
    const hasPay = paidAmount > 0 || !!rec?.paidDate;
    const paid = hasPay && (amt === 0 || paidAmount >= amt);
    const partial = hasPay && !paid && paidAmount > 0;
    const paymentEvents = Array.isArray(rec?.paymentEvents) && rec.paymentEvents.length
      ? rec.paymentEvents.filter((event) => event?.date && +event.amount > 0)
      : (hasPay && paidAmount > 0 ? [{ date: rec.paidDate, amount: paidAmount, legacy: true }] : []);
    let status = "upcoming";
    if (paid) status = "paid";
    else if (due < today) status = "overdue";
    else if (partial) status = "partial";
    else if ((due - today) / 86400000 <= 7) status = "due";
    return {
      n: i + 1, index: i, dueDate: due, scheduledDueDate: scheduledDue, amountDue: amt,
      paid, partial, paidAmount, remainingDue: Math.max(0, amt - paidAmount),
      paidDate: hasPay ? rec.paidDate : null, receipt: rec ? rec.receipt : null,
      paymentEvents,
      notifiedAt: rec ? rec.notifiedAt : null, deferredUntil,
      deferralReason: rec?.deferralReason || "", deferralHistory, status,
    };
  });
};

const contractStats = (c) => {
  const rows = buildSchedule(c);
  const financed = rows.reduce((s, r) => s + r.amountDue, 0);
  const paidSum = rows.reduce((s, r) => s + r.paidAmount, 0);
  const overdueSum = rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.remainingDue, 0);
  const next = rows.find((r) => !r.paid) || null;
  const deferrals = rows.filter((r) => !r.paid && r.deferredUntil);
  const done = rows.every((r) => r.paid);
  return { rows, financed, paidSum, remaining: financed - paidSum, overdueSum, next, deferrals, done };
};

/* ------------------------------------------------------------------ */
/*  Вкладчики / капитал                                                */
/* ------------------------------------------------------------------ */

const WITHDRAWAL_PURPOSES = {
  owner: "Прибыль собственнику",
  investor_payout: "Выплата вкладчику",
  restock: "Закупка товара",
  other: "Прочее",
};

const investorAccrual = (investor, withdrawals, today = startOfToday()) => {
  const monthly = Math.max(0, +investor.monthlyPayment || 0);
  const start = investor.accrualStartDate ? new Date(`${investor.accrualStartDate}T00:00:00`) : null;
  let monthsAccrued = 0;
  let nextDue = start;
  if (monthly && start && !Number.isNaN(start.getTime())) {
    while (nextDue <= today && monthsAccrued < 1200) {
      monthsAccrued += 1;
      nextDue = addMonths(investor.accrualStartDate, monthsAccrued);
    }
  }
  const accrued = monthly * monthsAccrued;
  const paid = withdrawals.filter((w) => w.investorId === investor.id && w.purpose === "investor_payout")
    .reduce((sum, w) => sum + (+w.amount || 0), 0);
  return { monthly, monthsAccrued, accrued, paid, payable: Math.max(0, accrued - paid), nextDue };
};

// сколько из наценки (прибыли) уже получено, а сколько ещё в графике платежей
const contractCapital = (c) => {
  const principal = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0));
  const markup = Math.max(0, +c.markup || 0);
  const financed = principal + markup;
  const { paidSum } = contractStats(c);
  const split = splitReceived(paidSum, principal, markup);
  return { principal, markup, principalReturned: split.principalReturned, profitRealized: split.profitReceived };
};

/* ------------------------------------------------------------------ */
/*  Supabase: перевод строк БД <-> объекты приложения                  */
/* ------------------------------------------------------------------ */

const contractFromRow = (r) => ({
  id: r.id, clientName: r.client_name, phone: r.phone || "", item: r.item || "",
  totalPrice: Number(r.total_price) || 0, downPayment: Number(r.down_payment) || 0,
  markup: Number(r.markup) || 0, markupPercent: Number(r.markup_percent) || 0,
  termMonths: Number(r.term_months) || 1, startDate: r.start_date,
  investorId: r.investor_id || "", payments: r.payments || {}, comment: r.comment || "",
  guarantorName: r.guarantor_name || "", guarantorPhone: r.guarantor_phone || "",
});

const contractToRow = (c) => ({
  id: c.id, client_name: c.clientName, phone: c.phone || "", item: c.item || "",
  total_price: c.totalPrice, down_payment: c.downPayment || 0,
  markup: c.markup || 0, markup_percent: c.markupPercent || 0,
  term_months: c.termMonths, start_date: c.startDate,
  investor_id: c.investorId || "", payments: c.payments || {}, comment: c.comment || "",
  guarantor_name: c.guarantorName || "", guarantor_phone: c.guarantorPhone || "",
});

const investorFromRow = (r) => ({
  id: r.id, name: r.name, amount: Number(r.amount) || 0,
  monthlyPayment: Number(r.monthly_payment ?? r.monthlyPayment) || 0,
  accrualStartDate: r.accrual_start_date ?? r.accrualStartDate ?? "",
});
const investorToRow = (i) => ({
  id: i.id, name: i.name, amount: i.amount,
  monthly_payment: +i.monthlyPayment || 0, accrual_start_date: i.accrualStartDate || null,
});

const withdrawalFromRow = (r) => ({
  id: r.id, amount: Number(r.amount) || 0, date: r.date, investorId: r.investor_id || "",
  purpose: r.purpose || "other", note: r.note || "",
});
const withdrawalToRow = (w) => ({
  id: w.id, amount: w.amount, date: w.date, investor_id: w.investorId || "",
  purpose: w.purpose || "other", note: w.note || "",
});

/* ------------------------------------------------------------------ */
/*  Импорт из Excel                                                    */
/* ------------------------------------------------------------------ */

const excelDateToIso = (v, XLSX) => {
  if (v instanceof Date && !isNaN(v)) {
    // локальные компоненты даты, а не toISOString() (UTC) — иначе для часовых
    // поясов восточнее UTC дата сдвигается на день назад
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const dm = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (dm) return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  return null;
};

const findSheet = (wb, names) => {
  const key = wb.SheetNames.find((n) => names.includes(n.trim().toLowerCase()));
  return key ? wb.Sheets[key] : null;
};

// индекс договоров по "имя|товар" и по одному имени — для сопоставления строк платежей
const buildContractIndex = (contracts) => {
  const byKey = new Map();
  const byName = new Map();
  contracts.forEach((c) => {
    const name = (c.clientName || "").trim().toLowerCase();
    const item = (c.item || "").trim().toLowerCase();
    byKey.set(`${name}|${item}`, c);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(c);
  });
  return { byKey, byName };
};

const findContract = (index, name, item) => {
  const n = name.trim().toLowerCase();
  const it = (item || "").trim().toLowerCase();
  if (it) {
    const exact = index.byKey.get(`${n}|${it}`);
    if (exact) return { contract: exact, ambiguous: false };
  }
  const list = index.byName.get(n) || [];
  if (list.length === 1) return { contract: list[0], ambiguous: false };
  if (list.length > 1) return { contract: list[0], ambiguous: true };
  return { contract: null, ambiguous: false };
};

const parseImportWorkbook = async (file, existingInvestors, existingContracts) => {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const investorsSheet = findSheet(wb, ["вкладчики", "investors"]);
  const contractsSheet = findSheet(wb, ["договоры", "contracts"]);
  const paymentsSheet = findSheet(wb, ["платежи", "payments"]);

  const newInvestors = [];
  const investorByName = new Map(existingInvestors.map((i) => [i.name.trim().toLowerCase(), i]));
  const errors = [];

  if (investorsSheet) {
    XLSX.utils.sheet_to_json(investorsSheet, { defval: "" }).forEach((row, i) => {
      const name = String(row["Имя вкладчика"] || row["Имя"] || "").trim();
      const amount = +row["Сумма вклада"] || +row["Сумма"] || 0;
      if (!name && !amount) return;
      if (!name || amount <= 0) { errors.push(`Вкладчики, строка ${i + 2}: не заполнено имя или сумма`); return; }
      if (investorByName.has(name.toLowerCase())) return;
      const inv = { id: "i" + Date.now() + Math.random().toString(36).slice(2, 7), name, amount };
      newInvestors.push(inv);
      investorByName.set(name.toLowerCase(), inv);
    });
  }

  const newContracts = [];
  if (contractsSheet) {
    // ключ дубликата: имя + товар + дата 1-го платежа (нормализованные)
    const dupKey = (name, item, startDate) =>
      `${(name || "").trim().toLowerCase()}|${(item || "").trim().toLowerCase()}|${startDate}`;
    const seenKeys = new Set(existingContracts.map((c) => dupKey(c.clientName, c.item, c.startDate)));
    XLSX.utils.sheet_to_json(contractsSheet, { defval: "" }).forEach((row, i) => {
      const rowNum = i + 2;
      const clientName = String(row["ФИО клиента"] || "").trim();
      if (!clientName) return;
      const item = String(row["Товар"] || "").trim();
      const totalPrice = +row["Цена товара"] || 0;
      const termMonths = Math.max(1, +row["Срок, мес"] || 1);
      if (!totalPrice || !row["Срок, мес"]) {
        errors.push(`Договоры, строка ${rowNum}: не указана цена и/или срок — договор добавлен с неполными данными`);
      }
      const downPayment = +row["Первоначальный взнос"] || 0;
      const principal = Math.max(0, totalPrice - downPayment);
      let markup = +row["Наценка, ₽"] || 0;
      let markupPercent = +row["Наценка, %"] || 0;
      if (!markup && markupPercent) markup = Math.round((principal * markupPercent) / 100);
      else if (!markupPercent && markup && principal > 0) markupPercent = Math.round((markup / principal) * 1000) / 10;

      const startDate = excelDateToIso(row["Дата 1-го платежа"], XLSX) || new Date().toISOString().slice(0, 10);

      // пропускаем дубли — как с уже существующими договорами, так и между строками файла
      const key = dupKey(clientName, item, startDate);
      if (seenKeys.has(key)) {
        errors.push(`Договоры, строка ${rowNum}: договор «${clientName}» / «${item}» от ${fmtDate(startDate)} уже существует — пропущено`);
        return;
      }
      seenKeys.add(key);

      const sourceName = String(row["Источник финансирования"] || "").trim();
      const investor = sourceName && sourceName.toLowerCase() !== "общий пул"
        ? investorByName.get(sourceName.toLowerCase())
        : null;
      if (sourceName && sourceName.toLowerCase() !== "общий пул" && !investor) {
        errors.push(`Договоры, строка ${rowNum}: вкладчик «${sourceName}» не найден — договор добавлен в общий пул`);
      }

      const guarantorName = String(row["Поручитель, ФИО"] || "").trim();
      const guarantorPhone = String(row["Поручитель, телефон"] || "").trim();
      if (!guarantorName || !guarantorPhone) {
        errors.push(`Договоры, строка ${rowNum}: не указан поручитель — договор добавлен, дозаполните на сайте`);
      }

      newContracts.push({
        id: "c" + Date.now() + Math.random().toString(36).slice(2, 7),
        clientName, phone: fmtPhone(String(row["Телефон"] || "").trim()), item,
        totalPrice, downPayment, markup, markupPercent, termMonths, startDate,
        investorId: investor ? investor.id : "", comment: String(row["Комментарий"] || "").trim(),
        guarantorName, guarantorPhone: fmtPhone(guarantorPhone), payments: {},
      });
    });
  }

  const paymentUpdates = [];
  if (paymentsSheet) {
    const index = buildContractIndex([...existingContracts, ...newContracts]);
    XLSX.utils.sheet_to_json(paymentsSheet, { defval: "" }).forEach((row, i) => {
      const rowNum = i + 2;
      const clientName = String(row["ФИО клиента"] || "").trim();
      const item = String(row["Товар (если у клиента >1 договора)"] || row["Товар"] || "").trim();
      const paymentNo = Math.round(+row["№ платежа"] || 0);
      const paidDate = excelDateToIso(row["Дата фактической оплаты"], XLSX);
      if (!clientName && !paymentNo && !paidDate) return;
      if (!clientName || paymentNo <= 0 || !paidDate) {
        errors.push(`Платежи, строка ${rowNum}: не заполнены обязательные поля (ФИО, № платежа, дата оплаты)`);
        return;
      }
      const { contract, ambiguous } = findContract(index, clientName, item);
      if (!contract) {
        errors.push(`Платежи, строка ${rowNum}: договор клиента «${clientName}» не найден`);
        return;
      }
      if (ambiguous) {
        errors.push(`Платежи, строка ${rowNum}: у клиента «${clientName}» несколько договоров — платёж применён к первому найденному, уточните колонку «Товар»`);
      }
      if (paymentNo > contract.termMonths) {
        errors.push(`Платежи, строка ${rowNum}: № платежа ${paymentNo} больше срока договора (${contract.termMonths} мес.) — пропущено`);
        return;
      }
      const idx = paymentNo - 1;
      if (newContracts.includes(contract)) {
        contract.payments[idx] = { ...(contract.payments[idx] || {}), paidDate };
      } else {
        paymentUpdates.push({ contractId: contract.id, index: idx, paidDate });
      }
    });
  }

  if (!investorsSheet && !contractsSheet && !paymentsSheet) {
    errors.push("В файле не найдены вкладки «Вкладчики», «Договоры» или «Платежи» — используйте шаблон");
  }

  return { newInvestors, newContracts, paymentUpdates, errors };
};

/* ------------------------------------------------------------------ */
/*  Экспорт в Excel — зеркало формата импорта                          */
/* ------------------------------------------------------------------ */

const keepExcelColumnsAsText = (XLSX, sheet, columnIndexes) => {
  if (!sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  columnIndexes.forEach((column) => {
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      if (!cell) continue;
      cell.t = "s";
      cell.v = String(cell.v ?? "");
      cell.z = "@";
    }
  });
};

const buildExportWorkbook = (XLSX, contracts, investors) => {
  const wb = XLSX.utils.book_new();
  const investorName = (id) => (id ? investors.find((i) => i.id === id)?.name || "" : "");

  const invSheet = XLSX.utils.aoa_to_sheet([
    ["Имя вкладчика", "Сумма вклада"],
    ...investors.map((i) => [i.name, i.amount]),
  ]);
  invSheet["!cols"] = [{ wch: 28 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, invSheet, "Вкладчики");

  const contractsSheet = XLSX.utils.aoa_to_sheet([
    ["ФИО клиента", "Телефон", "Товар", "Цена товара", "Первоначальный взнос",
     "Наценка, %", "Наценка, ₽", "Срок, мес", "Дата 1-го платежа",
     "Источник финансирования", "Комментарий", "Поручитель, ФИО", "Поручитель, телефон"],
    ...contracts.map((c) => [
      c.clientName, formatPhoneForExcel(c.phone), c.item || "", c.totalPrice || 0, c.downPayment || 0,
      c.markupPercent || 0, c.markup || 0, c.termMonths || 1, fmtDate(c.startDate),
      investorName(c.investorId), c.comment || "", c.guarantorName || "", formatPhoneForExcel(c.guarantorPhone),
    ]),
  ]);
  contractsSheet["!cols"] = [
    { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 13 }, { wch: 16 },
    { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 15 }, { wch: 24 }, { wch: 28 }, { wch: 24 }, { wch: 18 },
  ];
  keepExcelColumnsAsText(XLSX, contractsSheet, [1, 12]);
  XLSX.utils.book_append_sheet(wb, contractsSheet, "Договоры");

  const paymentRows = [];
  contracts.forEach((c) => {
    Object.entries(c.payments || {}).forEach(([idx, rec]) => {
      if (rec && rec.paidDate) {
        paymentRows.push([c.clientName, c.item || "", Number(idx) + 1, fmtDate(rec.paidDate)]);
      }
    });
  });
  const paySheet = XLSX.utils.aoa_to_sheet([
    ["ФИО клиента", "Товар (если у клиента >1 договора)", "№ платежа", "Дата фактической оплаты"],
    ...paymentRows,
  ]);
  paySheet["!cols"] = [{ wch: 24 }, { wch: 30 }, { wch: 11 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, paySheet, "Платежи");

  return wb;
};

const buildFilteredContractsWorkbook = (XLSX, contracts, investors) => {
  const wb = XLSX.utils.book_new();
  const investorName = (id) => id ? investors.find((item) => item.id === id)?.name || "Не найден" : "Общий пул";
  const statusName = (stats) => stats.done ? "Закрыт" : stats.overdueSum > 0 ? "Просрочка" : "Активный";
  const summaryRows = contracts.map((contract) => {
    const stats = contractStats(contract);
    const next = stats.next;
    return [
      contract.clientName, formatPhoneForExcel(contract.phone), contract.item || "", statusName(stats),
      stats.remaining, stats.overdueSum, stats.rows.filter((row) => row.status === "overdue").length,
      next ? fmtDate(next.dueDate) : "", next ? next.remainingDue : 0,
      stats.deferrals.length ? fmtDate(stats.deferrals[0].dueDate) : "",
      investorName(contract.investorId), contract.comment || "",
    ];
  });
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["ФИО клиента", "Телефон", "Товар", "Статус", "Остаток, ₽", "Просрочка, ₽",
      "Просроченных платежей", "Ближайшая дата", "Ближайший платёж, ₽", "Отсрочка до",
      "Источник финансирования", "Комментарий"],
    ...summaryRows,
  ]);
  summarySheet["!cols"] = [
    { wch: 25 }, { wch: 18 }, { wch: 24 }, { wch: 13 }, { wch: 14 }, { wch: 14 },
    { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 30 },
  ];
  keepExcelColumnsAsText(XLSX, summarySheet, [1]);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Отфильтрованные договоры");

  const overdueRows = [];
  contracts.forEach((contract) => {
    contractStats(contract).rows.filter((row) => row.status === "overdue").forEach((row) => overdueRows.push([
      contract.clientName, formatPhoneForExcel(contract.phone), contract.item || "", row.n,
      fmtDate(row.scheduledDueDate), fmtDate(row.dueDate), row.amountDue, row.paidAmount,
      row.remainingDue, row.notifiedAt ? fmtDateTime(row.notifiedAt) : "",
      row.deferralHistory?.length || (row.deferredUntil ? 1 : 0), row.deferralReason || "",
    ]));
  });
  const overdueSheet = XLSX.utils.aoa_to_sheet([
    ["ФИО клиента", "Телефон", "Товар", "№ платежа", "Дата по графику", "Текущая дата",
      "Платёж, ₽", "Оплачено, ₽", "Просрочено, ₽", "Уведомлён WhatsApp", "Количество отсрочек", "Причина отсрочки"],
    ...overdueRows,
  ]);
  overdueSheet["!cols"] = [
    { wch: 25 }, { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 20 }, { wch: 28 },
  ];
  keepExcelColumnsAsText(XLSX, overdueSheet, [1]);
  XLSX.utils.book_append_sheet(wb, overdueSheet, "Просроченные платежи");
  return wb;
};

/* ------------------------------------------------------------------ */
/*  Мелкие компоненты                                                  */
/* ------------------------------------------------------------------ */

const STATUS = {
  paid: { label: "Оплачен", cls: "b-emerald" },
  partial: { label: "Частично", cls: "b-amber" },
  overdue: { label: "Просрочен", cls: "b-clay" },
  due: { label: "Скоро", cls: "b-amber" },
  upcoming: { label: "Ожидает", cls: "b-line" },
  active: { label: "Активный", cls: "b-line" },
  done: { label: "Закрыт", cls: "b-emerald" },
};

const Badge = ({ s }) => {
  const st = STATUS[s] || STATUS.upcoming;
  return <span className={`badge ${st.cls}`}>{st.label}</span>;
};

// «Лента долга» — фирменный элемент: полоса, поделённая на оплачено / просрочено / остаток
const Ribbon = ({ paid, overdue, remaining }) => {
  const total = Math.max(1, paid + remaining);
  const p = (paid / total) * 100;
  const o = (overdue / total) * 100;
  const r = 100 - p - o;
  return (
    <div className="ribbon" title="Оплачено / Просрочено / Остаток">
      <span style={{ width: `${p}%` }} className="seg s-paid" />
      <span style={{ width: `${o}%` }} className="seg s-over" />
      <span style={{ width: `${r}%` }} className="seg s-rem" />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Приложение                                                         */
/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = проверяем, null = не вошли, объект = вошли
  const {logs:operatorLogs,error:operatorLogsError}=useCallLogs(!isDesktopApp ? session?.user?.id : null);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [contracts, setContracts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [tab, setTab] = useState("dashboard");
  const [openId, setOpenId] = useState(null);
  const [quickPayId, setQuickPayId] = useState(null);
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [workView, setWorkView] = useState("");
  const [listMode, setListMode] = useState("cards");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [reminderQueue, setReminderQueue] = useState(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const toggleSelected = id => setSelectedIds(prev => { const next=new Set(prev); next.has(id)?next.delete(id):next.add(id); return next; });
  const openQuickPay = id => { setQuickPayId(id); setOpenId(id); };
  useEffect(() => { if (!openId) setQuickPayId(null); }, [openId]);
  const [adding, setAdding] = useState(false);

  const [investors, setInvestors] = useState([]);
  const [addingInvestor, setAddingInvestor] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState(null);

  const [withdrawals, setWithdrawals] = useState([]);
  const [addingWithdrawal, setAddingWithdrawal] = useState(false);

  const [sectionModal, setSectionModal] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [editingContract, setEditingContract] = useState(null);
  const [dataCenterOpen, setDataCenterOpen] = useState(false);
  const [draftToContinue, setDraftToContinue] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [receivedOpen, setReceivedOpen] = useState(false);
  const [receivedView, setReceivedView] = useState("received");
  const [profitGroupOpen, setProfitGroupOpen] = useState(null);
  const confirmResolver = useRef(null);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [backupError, setBackupError] = useState("");
  const [saveState, setSaveState] = useState({ pending: 0, lastSavedAt: null, error: '' });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [investorFilter, setInvestorFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [deferralFilter, setDeferralFilter] = useState("all");
  const [callResultFilter, setCallResultFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created");
  const [dailyDate, setDailyDate] = useState(() => toIsoDate(new Date()));
  const [dailyRange, setDailyRange] = useState(false);
  const [dailyTo, setDailyTo] = useState(() => toIsoDate(new Date()));
  const dailyEnd = dailyRange ? dailyTo : dailyDate;
  const dailyError = !dailyDate || !dailyEnd ? "Укажите даты периода." : dailyDate > dailyEnd ? "Начало периода не может быть позже окончания." : "";
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [appMessage, setAppMessage] = useState(null);

  useEffect(() => {
    let timer;
    const listener = (event) => {
      setAppMessage(event.detail);
      clearTimeout(timer);
      timer = setTimeout(() => setAppMessage(null), 6000);
    };
    window.addEventListener("rassrochki-message", listener);
    return () => { clearTimeout(timer); window.removeEventListener("rassrochki-message", listener); };
  }, []);

  const requestConfirm = (options) => new Promise((resolve) => {
    confirmResolver.current = resolve;
    setConfirmDialog(options);
  });
  const finishConfirm = (value) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmDialog(null);
  };

  // сессия входа
  useEffect(() => {
    if (!supabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const logout = () => supabase.auth.signOut();

  // стабильный идентификатор пользователя — не меняется при обновлении токена
  // (session — новый объект при каждом TOKEN_REFRESHED, из-за чего эффект ниже
  // не должен зависеть от него напрямую, иначе форма посреди заполнения сбросится)
  const userId = session?.user?.id || null;

  // загрузка договоров, вкладчиков и выводов из Supabase
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoaded(false);
    setLoadError("");
    (async () => {
      const [contractsRes, investorsRes, withdrawalsRes] = await Promise.all([
        supabase.from("contracts").select("*").order("created_at", { ascending: false }),
        supabase.from("investors").select("*").order("created_at", { ascending: false }),
        supabase.from("withdrawals").select("*").order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const err = contractsRes.error || investorsRes.error || withdrawalsRes.error;
      if (err) {
        setLoadError(err.message || "Не удалось загрузить данные");
        return;
      }
      setContracts((contractsRes.data || []).map(contractFromRow));
      setInvestors((investorsRes.data || []).map(investorFromRow));
      setWithdrawals((withdrawalsRes.data || []).map(withdrawalFromRow));
      setStorageError(""); // данные заново синхронизированы с БД — снимаем флаг ошибки
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, reloadTick]);

  useEffect(() => {
    if (!isDesktopApp || !userId) return;
    let running = false, disposed = false;
    const check = async () => {
      if (running || disposed) return;
      running = true;
      const errors = [];
      for (const task of ['ensureDailyBackup', 'ensureDailyExcelBackup']) {
        try { await localData[task](); } catch (error) { errors.push(error.message || String(error)); }
      }
      try { const at = await localData.backupStatus(); if (!disposed) setLastBackupAt(at); }
      catch (error) { errors.push(error.message || String(error)); }
      if (!disposed) setBackupError(errors.join('; '));
      running = false;
    };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [userId]);

  useEffect(() => {
    if (!isDesktopApp) return;
    const saved = (event) => setSaveState(event.detail);
    const backedUp = (event) => { setLastBackupAt(event.detail.at); setBackupError(''); };
    window.addEventListener('rassrochki-storage', saved);
    window.addEventListener('rassrochki-backup', backedUp);
    let disposed = false, unlisten, closePending = false;
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      const off = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closePending) return;
        closePending = true;
        try { await flushLocalTasks(); await appWindow.destroy(); }
        catch (error) { closePending = false; showAppMessage(`Не удалось закрыть приложение: ${error.message || error}`); }
      });
      if (disposed) off(); else unlisten = off;
    }).catch((error) => setBackupError(error.message || String(error)));
    import('@tauri-apps/plugin-fs').then(async ({ exists, readTextFile }) => {
      const { BaseDirectory } = await import('@tauri-apps/api/path');
      if (await exists('restore-error.txt', { baseDir: BaseDirectory.AppData })) {
        const error = await readTextFile('restore-error.txt', { baseDir: BaseDirectory.AppData });
        if (!disposed) setStorageError(`Восстановление не завершено: ${error}`);
      }
    }).catch((error) => { if (!disposed) setBackupError(error.message || String(error)); });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('rassrochki-storage', saved); window.removeEventListener('rassrochki-backup', backedUp); };
  }, []);

  const totals = useMemo(() => {
    let financed = 0, paid = 0, overdue = 0, remaining = 0, debtors = 0, active = 0;
    const upcoming = [];
    contracts.forEach((c) => {
      const st = contractStats(c);
      financed += st.financed; paid += st.paidSum; overdue += st.overdueSum; remaining += st.remaining;
      if (st.overdueSum > 0) debtors += 1;
      if (!st.done) active += 1;
      const overdueRows = st.rows.filter((r) => r.status === "overdue");
      st.rows.filter((r) => !r.paid).forEach((r) => upcoming.push({ ...r, client: c.clientName, phone: c.phone, item: c.item, cid: c.id, overdueRows }));
    });
    upcoming.sort((a, b) => a.dueDate - b.dueDate);
    return { financed, paid, overdue, remaining, debtors, active, upcoming };
  }, [contracts]);
  const visibleUpcoming = showAllUpcoming ? totals.upcoming : totals.upcoming.slice(0, 8);

  const capital = useMemo(() => {
    let principalTotal = 0, principalReturned = 0, profitRealized = 0, profitTotal = 0;
    const perInvestor = {};
    const profitByInvestor = {};
    contracts.forEach((c) => {
      const cc = contractCapital(c);
      principalTotal += cc.principal;
      principalReturned += cc.principalReturned;
      profitRealized += cc.profitRealized;
      profitTotal += cc.markup;
      const key = c.investorId || "";
      perInvestor[key] = (perInvestor[key] || 0) + (cc.principal - cc.principalReturned);
      if (!profitByInvestor[key]) profitByInvestor[key] = { realized: 0, expected: 0 };
      profitByInvestor[key].realized += cc.profitRealized;
      profitByInvestor[key].expected += cc.markup - cc.profitRealized;
    });
    const invested = investors.reduce((s, i) => s + (+i.amount || 0), 0);
    const deployed = principalTotal - principalReturned;

    const withdrawnByInvestor = {};
    let withdrawnTotal = 0;
    withdrawals.forEach((w) => {
      const key = w.investorId || "";
      const amt = +w.amount || 0;
      withdrawnByInvestor[key] = (withdrawnByInvestor[key] || 0) + amt;
      withdrawnTotal += amt;
    });

    return {
      invested, deployed, free: invested - deployed - withdrawnTotal,
      profitRealized, profitExpected: profitTotal - profitRealized, profitTotal,
      perInvestor, profitByInvestor, withdrawnByInvestor, withdrawnTotal,
    };
  }, [contracts, investors, withdrawals]);

  const received = useMemo(() => receivedSummary(contracts, contractStats), [contracts]);
  const dailyPayments = useMemo(() => expectedPayments(contracts, contractStats, dailyDate, dailyEnd), [contracts, dailyDate, dailyEnd]);
  const dailyContacts = useMemo(() => {
    const rows = [];
    contracts.forEach((contract) => {
      const contacts = Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : [];
      contacts.forEach((contact) => {
        const promised = dateInPeriod(contact.promisedDate, dailyDate, dailyEnd);
        const nextContact = dateInPeriod(contact.nextContactDate, dailyDate, dailyEnd);
        if (!promised && !nextContact) return;
        rows.push({
          id: contact.id, contractId: contract.id, clientName: contract.clientName,
          phone: contract.phone || "", item: contract.item || "", note: contact.note || "",
          promised, nextContact, promisedDate: contact.promisedDate, nextContactDate: contact.nextContactDate, promisedAmount: +contact.promisedAmount || 0,
        });
      });
    });
    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName, "ru"));
  }, [contracts, dailyDate, dailyEnd]);
  const investorProfits = useMemo(
    () => investorProfitBreakdown(contracts, investors, withdrawals, contractStats),
    [contracts, investors, withdrawals]
  );

  // откат оптимистичного обновления при ошибке сохранения
  const rollback = (msg, ...restorers) => {
    restorers.forEach((fn) => fn());
    // не затираем ранее возникшую ошибку — флаг держится до явной перезагрузки
    setStorageError((prev) => prev || msg);
    showAppMessage(`Не удалось сохранить: ${msg}. Изменения отменены`);
  };

  const addInvestor = async (data) => {
    const prevInvestors = investors;
    const inv = { ...data, id: "i" + Date.now() };
    setInvestors((prev) => [inv, ...prev]);
    setAddingInvestor(false);
    const { error } = await supabase.from("investors").insert(investorToRow(inv));
    if (error) return rollback(error.message, () => setInvestors(prevInvestors));
  };

  const updateInvestor = async (data) => {
    const previous = investors;
    const updated = { ...editingInvestor, ...data };
    setInvestors((items) => items.map((item) => item.id === updated.id ? updated : item));
    setEditingInvestor(null);
    const { error } = await supabase.from("investors").update(investorToRow(updated)).eq("id", updated.id);
    if (error) return rollback(error.message, () => setInvestors(previous));
  };

  const payInvestorAccrual = async (investor, amount) => {
    await addWithdrawal({
      amount, date: new Date().toISOString().slice(0, 10), investorId: investor.id,
      purpose: "investor_payout", note: `Ежемесячное начисление вкладчику ${investor.name}`,
    });
  };

  const removeInvestor = async (id) => {
    const inv = investors.find((i) => i.id === id);
    const linked = contracts.filter((c) => c.investorId === id).length;
    const msg = linked > 0
      ? `Удалить вкладчика «${inv?.name || ""}»? С ним связано договоров: ${linked}. Договоры останутся, но потеряют привязку к источнику финансирования.`
      : `Удалить вкладчика «${inv?.name || ""}»?`;
    if (!await requestConfirm({ title: "Переместить вкладчика в корзину?", message: msg, confirmLabel: "Переместить в корзину" })) return;
    const prevInvestors = investors;
    setInvestors((prev) => prev.filter((i) => i.id !== id));
    const { error } = await supabase.from("investors").delete().eq("id", id);
    if (error) return rollback(error.message, () => setInvestors(prevInvestors));
  };

  const addWithdrawal = async (data) => {
    const prevWithdrawals = withdrawals;
    const w = { ...data, id: "w" + Date.now() };
    setWithdrawals((prev) => [w, ...prev]);
    setAddingWithdrawal(false);
    const { error } = await supabase.from("withdrawals").insert(withdrawalToRow(w));
    if (error) return rollback(error.message, () => setWithdrawals(prevWithdrawals));
  };

  const removeWithdrawal = async (id) => {
    const w = withdrawals.find((x) => x.id === id);
    if (!await requestConfirm({ title: "Переместить вывод в корзину?", message: `Вывод ${money(w?.amount || 0)} от ${w ? fmtDate(w.date) : ""} можно будет восстановить.`, confirmLabel: "Переместить в корзину" })) return;
    const prevWithdrawals = withdrawals;
    setWithdrawals((prev) => prev.filter((x) => x.id !== id));
    const { error } = await supabase.from("withdrawals").delete().eq("id", id);
    if (error) return rollback(error.message, () => setWithdrawals(prevWithdrawals));
  };

  const importData = async (newInvestors, newContracts, paymentUpdates) => {
    const prevInvestors = investors;
    const prevContracts = contracts;
    let failMsg = "";
    if (isDesktopApp) await localData.createBackup("Перед импортом Excel");
    if (isDesktopApp) {
      const merged = new Map();
      (paymentUpdates || []).forEach((update) => {
        const base = merged.get(update.contractId) || { ...(contracts.find((contract) => contract.id === update.contractId)?.payments || {}) };
        base[update.index] = { ...(base[update.index] || {}), paidDate: update.paidDate };
        merged.set(update.contractId, base);
      });
      try {
        await localData.importBatch(
          newInvestors.map(investorToRow),
          newContracts.map(contractToRow),
          [...merged.entries()].map(([id, payments]) => ({ id, payments })),
          `Договоров: ${newContracts.length}, вкладчиков: ${newInvestors.length}`
        );
      } catch (error) {
        rollback(error?.message || String(error)); return false;
      }
      if (newInvestors.length) setInvestors((previous) => [...newInvestors, ...previous]);
      setContracts((previous) => {
        const withNew = newContracts.length ? [...newContracts, ...previous] : previous;
        return withNew.map((contract) => merged.has(contract.id) ? { ...contract, payments: merged.get(contract.id) } : contract);
      });
      return true;
    }
    setActionSource("Импорт Excel");
    if (newInvestors.length) {
      setInvestors((prev) => [...newInvestors, ...prev]);
      const { error } = await supabase.from("investors").insert(newInvestors.map(investorToRow));
      if (error) failMsg = error.message;
    }
    if (!failMsg && newContracts.length) {
      setContracts((prev) => [...newContracts, ...prev]);
      const { error } = await supabase.from("contracts").insert(newContracts.map(contractToRow));
      if (error) failMsg = error.message;
    }
    if (!failMsg && paymentUpdates && paymentUpdates.length) {
      const merged = new Map();
      paymentUpdates.forEach((u) => {
        const base = merged.get(u.contractId) || { ...(contracts.find((c) => c.id === u.contractId)?.payments || {}) };
        base[u.index] = { ...(base[u.index] || {}), paidDate: u.paidDate };
        merged.set(u.contractId, base);
      });
      setContracts((prev) => prev.map((c) => (merged.has(c.id) ? { ...c, payments: merged.get(c.id) } : c)));
      const results = await Promise.all(
        [...merged.entries()].map(([id, payments]) => supabase.from("contracts").update({ payments }).eq("id", id))
      );
      const firstErr = results.find((r) => r.error);
      if (firstErr) failMsg = firstErr.error.message;
    }
    setActionSource("Mac");
    if (failMsg) { rollback(failMsg, () => setInvestors(prevInvestors), () => setContracts(prevContracts)); return false; }
    await localData.log({ actionType: "import", entityType: "import", entityName: `Договоров: ${newContracts.length}, вкладчиков: ${newInvestors.length}`, source: "Импорт Excel" });
    return true;
  };

  const togglePay = async (cid, idx, paidDate) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const cur = payments[idx];
    if (cur && cur.paidDate) {
      const { paidDate: _paidDate, paidAmount: _paidAmount, paymentEvents: _paymentEvents, ...metadata } = cur;
      if (Object.keys(metadata).length) payments[idx] = metadata;
      else delete payments[idx];
    } else {
      const date = paidDate || toIsoDate(new Date());
      const row = buildSchedule(c).find((item) => item.index === idx);
      payments[idx] = { ...(cur || {}), paidDate: date, paymentEvents: row ? [{ date, amount: row.remainingDue, createdAt: new Date().toISOString() }] : [] };
    }
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({ actionType: cur?.paidDate ? "cancel_payment" : "create_payment", entityType: "payments", entityId: `${cid}:${idx}`, entityName: c.clientName, contractId: cid, before: cur || null, after: payments[idx] || null });
  };

  const notifyPayment = async (cid, idx, url) => {
    if (!await openExternalUrl(url)) return;
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    if (!await requestConfirm({
      title: "Сообщение отправлено?",
      message: `WhatsApp открыт для клиента «${c.clientName}». Отметьте уведомление только если сообщение действительно было отправлено.`,
      confirmLabel: "Да, сообщение отправлено",
      danger: false,
    })) return;
    const payments = { ...(c.payments || {}) };
    const before = payments[idx] || null;
    const notifiedAt = new Date().toISOString();
    payments[idx] = { ...(before || {}), notifiedAt };
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({
      actionType: "whatsapp_notification", entityType: "payments", entityId: `${cid}:${idx}`,
      entityName: c.clientName, contractId: cid, before, after: payments[idx],
    });
    return true;
  };

  const undoPaymentNotification = async (cid, idx) => {
    const c = contracts.find((x) => x.id === cid);
    const before = c?.payments?.[idx];
    if (!c || !before?.notifiedAt) return;
    const row = buildSchedule(c).find((item) => item.index === idx);
    if (!await requestConfirm({
      title: "Отменить отметку об уведомлении?",
      message: `${c.clientName}, платёж №${idx + 1}${row ? ` от ${fmtDate(row.dueDate)}` : ""}. Будет удалена только отметка «Уведомлён», само сообщение в WhatsApp удалить невозможно.`,
      confirmLabel: "Отменить отметку",
      danger: false,
    })) return;
    const payments = { ...(c.payments || {}) };
    const { notifiedAt: _notifiedAt, ...after } = before;
    if (Object.keys(after).length) payments[idx] = after;
    else delete payments[idx];
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({
      actionType: "cancel_whatsapp_notification", entityType: "payments", entityId: `${cid}:${idx}`,
      entityName: c.clientName, contractId: cid, before, after: payments[idx] || null,
    });
  };

  const deferPayment = async (cid, idx, deferredUntil, deferralReason = "", mode = "add") => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return false;
    const payments = { ...(c.payments || {}) };
    const before = payments[idx] || null;
    const row = buildSchedule(c).find((item) => item.index === idx);
    if (!row || row.paid) { showAppMessage("Отсрочку можно изменить только у неоплаченного платежа"); return false; }
    if (mode === 'cancel' && !await requestConfirm({
      title: "Отменить последнюю отсрочку?",
      message: `${c.clientName}, платёж №${row.n}. Дата вернётся на ${fmtDate(row.deferralHistory.at(-2)?.toDate || row.scheduledDueDate)}. Если эта дата уже прошла, неоплаченный платёж снова станет просроченным.`,
      confirmLabel: "Отменить отсрочку",
    })) return false;
    let next;
    try { next = changeDeferral(before || {}, toIsoDate(row.scheduledDueDate), { mode, date: deferredUntil, reason: deferralReason }); }
    catch (error) { showAppMessage(error.message); return false; }
    if (Object.keys(next).length) payments[idx] = next;
    else delete payments[idx];
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) { rollback(error.message); return false; }
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    try { await localData.log({
      actionType: mode === 'cancel' ? 'cancel_deferral' : mode === 'edit' ? 'edit_deferral' : 'defer_payment', entityType: "payments",
      entityId: `${cid}:${idx}`, entityName: c.clientName, contractId: cid, before, after: payments[idx] || null,
    }); } catch (logError) { showAppMessage(`Отсрочка сохранена, но журнал не записан: ${logError.message || logError}`); return true; }
    showAppMessage(mode === 'cancel' ? 'Последняя отсрочка отменена' : 'Отсрочка сохранена', 'success');
    return true;
  };

  const cards = cashCards(contracts);
  const addCashCard = async name => {
    const c = contracts[0];
    if (!c) throw new Error('Сначала создайте договор. Карту также можно указать при первой оплате.');
    if (cards.includes(name)) return;
    const payments = {...c.payments, __cashCards: [...new Set([...(c.payments?.__cashCards || []), name])]};
    const {error} = await supabase.from('contracts').update({payments}).eq('id',c.id);
    if (error) throw new Error(error.message);
    setContracts(prev=>prev.map(x=>x.id===c.id?{...x,payments}:x));
  };

  // Одно поступление закрывает старые просрочки, затем выбранный и следующие платежи.
  const payPayment = async (cid, idx, paidDate, amount, comment = "", destination = {}) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const date = paidDate || toIsoDate(new Date());
    const result = allocateContractPayment({
      payments: c.payments || {}, rows: buildSchedule(c), selectedIndex: idx,
      amount, date, createdAt: new Date().toISOString(), comment, destination: paymentDestination(destination.method, destination.card),
    });
    if (!result.allocations.length) return false;
    const { payments } = result;
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) {
      rollback(error.message, () => setContracts(prevContracts));
      return false;
    }
    for (const allocation of result.allocations) {
      await localData.log({
        actionType: allocation.full ? "full_payment" : "partial_payment",
        entityType: "payments", entityId: `${cid}:${allocation.index}`,
        entityName: c.clientName, contractId: cid, before: allocation.before,
        after: allocation.after,
      });
    }
    if (result.remainder > 0) {
      showAppMessage(`В договоре осталось к оплате только ${money(result.appliedAmount)}. Лишние ${money(result.remainder)} не внесены.`, "warning");
    }
    return true;
  };

  const deletePaidPayment = async (cid, idx, eventIndex, expectedRecord) => {
    const c = contracts.find(x=>x.id===cid);
    if (!c) throw new Error('Договор не найден');
    const row = buildSchedule(c).find(r=>r.index===idx);
    const payments = deletePaymentEvent({payments:c.payments,row,eventIndex,expectedRecord});
    const event = row.paymentEvents[eventIndex];
    if (!await requestConfirm({title:'Удалить это поступление?',message:`Будет удалено только поступление ${money(event.amount)} от ${fmtDate(event.date)}. Остальные оплаты сохранятся. Остаток долга и касса пересчитаются.`,confirmLabel:'Удалить поступление',danger:true})) return false;
    const {error} = await supabase.from('contracts').update({payments}).eq('id',cid);
    if (error) throw new Error(error.message);
    setContracts(prev=>prev.map(x=>x.id===cid?{...x,payments}:x));
    try { await localData.log({actionType:'delete_payment_event',entityType:'payments',entityId:`${cid}:${idx}`,contractId:cid,entityName:c.clientName,before:expectedRecord,after:payments[idx] || null}); }
    catch(error) { showAppMessage(`Поступление удалено, но журнал не записан: ${error.message}`); }
    return true;
  };

  const editPaidPayment = async (cid, idx, eventIndex, expectedRecord, values) => {
    const c = contracts.find(x=>x.id===cid);
    if (!c) throw new Error('Договор не найден');
    const row = buildSchedule(c).find(r=>r.index===idx);
    const payments = editPaymentEvent({payments:c.payments,row,eventIndex,expectedRecord,...values});
    const {error} = await supabase.from('contracts').update({payments}).eq('id',cid);
    if (error) throw new Error(error.message);
    setContracts(prev=>prev.map(x=>x.id===cid?{...x,payments}:x));
    try { await localData.log({actionType:'edit_payment',entityType:'payments',entityId:`${cid}:${idx}`,contractId:cid,entityName:c.clientName,before:expectedRecord,after:payments[idx]}); }
    catch(error) { showAppMessage(`Платёж сохранён, но журнал не записан: ${error.message}`); }
    return true;
  };

  const updatePaidDate = async (cid, idx, paidDate) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const cur = payments[idx];
    if (!cur || !cur.paidDate) return;
    const row = buildSchedule(c).find((item) => item.index === idx);
    const events = Array.isArray(cur.paymentEvents) && cur.paymentEvents.length
      ? [...cur.paymentEvents]
      : (row?.paidAmount > 0 ? [{ date: cur.paidDate, amount: row.paidAmount, legacy: true }] : []);
    if (events.length) events[events.length - 1] = { ...events[events.length - 1], date: paidDate };
    payments[idx] = { ...cur, paidDate, paymentEvents: events };
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({ actionType: "change_payment_date", entityType: "payments", entityId: `${cid}:${idx}`, entityName: c.clientName, contractId: cid, before: cur, after: payments[idx] });
  };

  const attachReceipt = async (cid, idx, file) => {
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    const safeExt = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : "";
    const path = `${cid}/${idx}-${Date.now()}${safeExt}`;
    const { error: uploadError } = await supabase.storage.from("receipts").upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) { setStorageError((prev) => prev || uploadError.message); showAppMessage(`Не удалось загрузить чек: ${uploadError.message}`); return; }
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const receipt = { name: file.name, type: file.type, path };
    const payments = { ...(c.payments || {}) };
    payments[idx] = { ...(payments[idx] || {}), receipt };
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) {
      // update не прошёл — файл в Storage остался бы бесхозным, удаляем его
      await supabase.storage.from("receipts").remove([path]);
      return rollback(error.message, () => setContracts(prevContracts));
    }
    await localData.log({ actionType: "attach_receipt", entityType: "receipts", entityId: path, entityName: file.name, contractId: cid, after: receipt });
  };

  const earlyPayoff = async (cid) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const unpaidRows = buildSchedule(c).filter((row) => !row.paid);
    if (!unpaidRows.length) return;
    const payoffTotal = unpaidRows.reduce((sum, row) => sum + row.remainingDue, 0);
    const today = new Date().toISOString().slice(0, 10);
    if (!await requestConfirm({
      title: "Подтвердить досрочное погашение?",
      message: `Клиент «${c.clientName}». Будут отмечены оплаченными ${unpaidRows.length} платежей на общую сумму ${money(payoffTotal)} датой ${fmtDate(today)}. После подтверждения договор будет закрыт.`,
      confirmLabel: "Погасить досрочно",
      danger: false,
    })) return;
    const payments = { ...(c.payments || {}) };
    unpaidRows.forEach((r) => {
      const { paidAmount: _pa, ...rest } = payments[r.index] || {};
      const previousEvents = Array.isArray(rest.paymentEvents) && rest.paymentEvents.length
        ? [...rest.paymentEvents]
        : r.paymentEvents;
      payments[r.index] = {
        ...rest, paidDate: today,
        paymentEvents: [...previousEvents, { date: today, amount: r.remainingDue, createdAt: new Date().toISOString(), earlyPayoff: true }],
      };
    });
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({
      actionType: "early_payoff", entityType: "contracts", entityId: cid, entityName: c.clientName, contractId: cid,
      before: { status: "active", remaining: payoffTotal, paymentNumbers: unpaidRows.map((row) => row.n) },
      after: { status: "paid", paidDate: today, totalAmount: payoffTotal, paymentNumbers: unpaidRows.map((row) => row.n) },
    });
  };

  const removeReceipt = async (cid, idx) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const cur = payments[idx];
    if (!cur) return;
    const { receipt, ...rest } = cur;
    if (Object.keys(rest).length === 0) delete payments[idx];
    else payments[idx] = rest;
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    // сначала убираем ссылку в БД; файл удаляем только после успешного update
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    if (receipt && receipt.path) {
      if (isDesktopApp) await localData.trashReceipt(receipt, cid, idx);
      else await supabase.storage.from("receipts").remove([receipt.path]);
    }
  };

  const addContract = async (data) => {
    const { newContractId, ...fields } = data;
    const initialDestination = +data.downPayment > 0 ? paymentDestination(data.downPaymentMethod,data.downPaymentCard) : null;
    const c = { ...fields, id: newContractId || `c${crypto.randomUUID()}`, payments: initialDestination ? {__downPaymentDestination:initialDestination} : {} };
    const { error } = isDesktopApp ? await localData.saveContract(contractToRow(c), true)
      : await supabase.from("contracts").insert(contractToRow(c));
    if (error) { rollback(error.message); return false; }
    setContracts((prev) => [c, ...prev.filter((item) => item.id !== c.id)]);
    return true;
  };

  const updateContract = async (data, contractId = editingContract?.id) => {
    const original = contracts.find((contract) => contract.id === contractId);
    if (!original) { showAppMessage("Исходный договор не найден. Черновик сохранён."); return false; }
    let updated;
    try { updated = prepareContractEdit(original, data);
      if (+data.downPayment > 0 && data.downPaymentMethod) updated.payments.__downPaymentDestination = paymentDestination(data.downPaymentMethod,data.downPaymentCard);
    }
    catch (error) { showAppMessage(error.message); return false; }
    const cid = original.id;
    if (isDesktopApp) await localData.createBackup("Перед изменением договора");
    const { error } = isDesktopApp ? await localData.saveContract(contractToRow(updated), false)
      : await supabase.from("contracts").update(contractToRow(updated)).eq("id", cid);
    if (error) { rollback(error.message); return false; }
    setContracts((prev) => prev.map((c) => (c.id === cid ? updated : c)));
    return true;
  };

  const updateDirectoryClient = async (ids, values) => {
    const patch = await saveDirectoryClient(supabase, ids, values);
    setContracts(prev => prev.map(c => ids.includes(c.id) ? {...c, ...patch} : c));
  };

  const updateComment = async (cid, comment) => {
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, comment } : x)));
    const { error } = await supabase.from("contracts").update({ comment }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
  };

  const addContact = async (cid, contact) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return false;
    const payments = { ...(c.payments || {}) };
    const contacts = Array.isArray(payments.__contacts) ? payments.__contacts : [];
    payments.__contacts = [contact, ...contacts];
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) { rollback(error.message, () => setContracts(prevContracts)); return false; }
    await localData.log({
      actionType: "create_contact", entityType: "contacts", entityId: contact.id,
      entityName: c.clientName, contractId: cid, after: contact,
    });
    return true;
  };

  const deleteContact = async (cid, contactId) => {
    const c = contracts.find((x) => x.id === cid);
    const contacts = Array.isArray(c?.payments?.__contacts) ? c.payments.__contacts : [];
    const contact = contacts.find((item) => item.id === contactId);
    if (!c || !contact) return;
    if (!await requestConfirm({
      title: "Удалить запись о контакте?",
      message: `${contact.resultLabel || CONTACT_TYPES[contact.type] || "Контакт"}{contact.readOnly ? " · Оператор" : ""} с ${c.clientName} от ${fmtDateTime(contact.occurredAt)}. Запись будет удалена из истории, а удаление сохранится в журнале действий.`,
      confirmLabel: "Удалить запись",
    })) return;
    const payments = { ...(c.payments || {}), __contacts: contacts.filter((item) => item.id !== contactId) };
    const prevContracts = contracts;
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    suppressNextActionLog();
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
    await localData.log({
      actionType: "delete_contact", entityType: "contacts", entityId: contact.id,
      entityName: c.clientName, contractId: cid, before: contact,
    });
  };

  const deleteContract = async (cid) => {
    if (!await requestConfirm({
      title: "Переместить договор в корзину?",
      message: "Договор исчезнет из расчётов, но платежи, комментарии и чеки сохранятся и смогут быть восстановлены.",
      confirmLabel: "Переместить в корзину",
    })) return;
    const c = contracts.find((x) => x.id === cid);
    const prevContracts = contracts;
    setContracts((prev) => prev.filter((x) => x.id !== cid));
    setOpenId(null);
    // локальное хранилище выполняет мягкое удаление; файлы чеков остаются на Mac
    const { error } = await supabase.from("contracts").delete().eq("id", cid);
    if (error) return rollback(error.message, () => setContracts(prevContracts));
  };

  const open = contracts.find((c) => c.id === openId) || null;
  const openClientContacts = useMemo(() => clientContacts(contracts, open, operatorLogs), [contracts, open, operatorLogs]);
  const expandedClientContacts = useMemo(() => clientContacts(contracts, contracts.find((c) => c.id === expandedId), operatorLogs), [contracts, expandedId, operatorLogs]);

  const sectionTitles = {
    remaining: "Остаток к получению — по договорам",
    financed: "Выдано в рассрочку — по договорам",
    active: "Активные договоры",
    debtors: "Должники (просрочка)",
    profit: "Общая прибыль — по договорам",
    profitRealized: "Полученная прибыль — по договорам",
  };

  const sectionRows = useMemo(() => {
    if (!sectionModal) return [];
    return contracts
      .map((c) => ({ c, st: contractStats(c) }))
      .filter(({ st }) => {
        if (sectionModal === "active") return !st.done;
        if (sectionModal === "debtors") return st.overdueSum > 0;
        return true;
      })
      .map(({ c, st }) => ({
        id: c.id,
        name: c.clientName,
        item: c.item,
        amount: sectionModal === "financed" ? st.financed
          : sectionModal === "debtors" ? st.overdueSum
          : sectionModal === "profit" ? Math.max(0, +c.markup || 0)
          : sectionModal === "profitRealized" ? contractCapital(c).profitRealized
          : st.remaining,
        badge: st.done ? "done" : st.overdueSum ? "overdue" : "active",
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [sectionModal, contracts]);

  const clientOptions = useMemo(() => {
    const unique = new Map();
    contracts.forEach((contract) => {
      const phoneKey = normalizePhone(contract.phone);
      const key = phoneKey || `name:${contract.clientName.trim().toLocaleLowerCase("ru")}`;
      if (!key) return;
      if (!unique.has(key)) unique.set(key, { key, name: contract.clientName, phone: contract.phone || "", contractCount: 0, contractIds: [] });
      unique.get(key).contractCount += 1;
      unique.get(key).contractIds.push(contract.id);
    });
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [contracts]);

  const productOptions = useMemo(() => {
    const unique = new Map();
    contracts.forEach((contract) => {
      const name = String(contract.item || "").trim().replace(/\s+/g, " ");
      const key = name.toLocaleLowerCase("ru");
      if (key && !unique.has(key)) unique.set(key, { key, name });
    });
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [contracts]);

  const matchesSearch = (contract, rawQuery) => {
    const query = rawQuery.trim().toLocaleLowerCase("ru");
    if (!query) return true;
    const contacts = Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : [];
    const investorName = contract.investorId
      ? (investors.find((investor) => investor.id === contract.investorId)?.name || "")
      : "Общий пул";
    const text = [
      contract.clientName, contract.phone, contract.item, contract.comment,
      contract.guarantorName, contract.guarantorPhone, investorName,
      ...contacts.flatMap((contact) => [contact.note, CONTACT_TYPES[contact.type], contact.promisedDate, contact.nextContactDate]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    if (text.includes(query)) return true;
    const queryDigits = query.replace(/\D/g, "");
    if (queryDigits.length < 3) return false;
    return `${contract.phone || ""} ${contract.guarantorPhone || ""}`.replace(/\D/g, "").includes(queryDigits);
  };

  const latestOperatorResults = useMemo(() => latestCallResults(operatorLogs), [operatorLogs]);

  const matchesContactFilters = (contract) => {
    if (!matchesCallResultFilter(callResultFilter, latestOperatorResults[contract.id])) return false;
    const contacts = clientContacts(contracts, contract, operatorLogs);
    if (!matchesWorkView(workView, contractStats(contract), contacts, contract.payments)) return false;
    if (contactFilter === "has" && contacts.length === 0) return false;
    if (contactFilter === "none" && contacts.length > 0) return false;
    if (notificationFilter !== "all") {
      const next = contractStats(contract).next;
      if (!next) return false;
      if (notificationFilter === "notified" && !next.notifiedAt) return false;
      if (notificationFilter === "unnotified" && next.notifiedAt) return false;
      if (notificationFilter === "stale" && !staleNotification(contract.payments)) return false;
    }
    if (deferralFilter !== "all") {
      const deferrals = contractStats(contract).deferrals;
      const today = startOfToday();
      const hasActive = deferrals.some((payment) => payment.dueDate >= today);
      const hasExpired = deferrals.some((payment) => payment.dueDate < today);
      if (deferralFilter === "active" && !hasActive) return false;
      if (deferralFilter === "expired" && !hasExpired) return false;
      if (deferralFilter === "none" && deferrals.length > 0) return false;
    }
    return true;
  };

  const filterCounts = useMemo(() => {
    const result = { all: 0, active: 0, overdue: 0, done: 0 };
    contracts.forEach((contract) => {
      if (investorFilter !== "all" && (contract.investorId || "") !== investorFilter) return;
      if (!matchesSearch(contract, search) || !matchesContactFilters(contract)) return;
      const stats = contractStats(contract);
      const status = stats.done ? "done" : stats.overdueSum ? "overdue" : "active";
      result.all += 1;
      result[status] += 1;
    });
    return result;
  }, [contracts, search, investorFilter, contactFilter, notificationFilter, deferralFilter, callResultFilter, investors, workView, operatorLogs, latestOperatorResults]);

  const filteredContracts = useMemo(() => {
    const list = contracts.filter((c) => {
      if (statusFilter !== "all") {
        const st = contractStats(c);
        const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
        if (badge !== statusFilter) return false;
      }
      if (investorFilter !== "all" && (c.investorId || "") !== investorFilter) return false;
      if (!matchesContactFilters(c)) return false;
      return matchesSearch(c, search);
    });

    if (sortBy === "name") {
      return [...list].sort((a, b) => a.clientName.localeCompare(b.clientName, "ru"));
    }
    if (sortBy === "dueDate") {
      return [...list].sort((a, b) => {
        const na = contractStats(a).next, nb = contractStats(b).next;
        return (na ? na.dueDate.getTime() : Infinity) - (nb ? nb.dueDate.getTime() : Infinity);
      });
    }
    if (sortBy === "remaining") {
      return [...list].sort((a, b) => contractStats(b).remaining - contractStats(a).remaining);
    }
    return list; // "created" — уже отсортировано по дате создания (новые сверху)
  }, [contracts, search, statusFilter, investorFilter, contactFilter, notificationFilter, deferralFilter, callResultFilter, sortBy, investors, workView, operatorLogs, latestOperatorResults]);

  const filteredSummary = useMemo(() => filteredContracts.reduce((summary, contract) => {
    const stats = contractStats(contract);
    const capital = contractCapital(contract);
    summary.financed += stats.financed;
    summary.remaining += stats.remaining;
    summary.overdue += stats.overdueSum;
    summary.profitReceived += capital.profitRealized;
    summary.profitExpected += Math.max(0, capital.markup - capital.profitRealized);
    return summary;
  }, { financed: 0, remaining: 0, overdue: 0, profitReceived: 0, profitExpected: 0 }), [filteredContracts]);

  const visibleSelected = filteredContracts.filter(c => selectedIds.has(c.id));
  const reminderFor = c => { const st=contractStats(c); return st.next ? waReminderLink(c.phone,c.clientName,c.item,st.next.remainingDue,st.next.dueDate,st.next.status,st.rows) : null; };
  const beginReminders = () => setReminderQueue(visibleSelected.filter(c=>reminderFor(c)).map(c=>c.id));
  const queueContract = contracts.find(c=>c.id===reminderQueue?.[0]);
  const queueUrl = queueContract && reminderFor(queueContract);
  const exportFilteredContracts = async () => {
    const XLSX = await import("xlsx");
    const names = { all: "vse", active: "aktivnye", overdue: "prosrochka", done: "zakrytye" };
    const fileName = `rassrochki_${names[statusFilter] || "spisok"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(buildFilteredContractsWorkbook(XLSX, filteredContracts, investors), fileName);
    await localData.log({
      actionType: "export_excel", entityType: "export", entityName: fileName,
      after: { statusFilter, investorFilter, contactFilter, notificationFilter, deferralFilter, callResultFilter, search, contracts: filteredContracts.length },
    });
  };

  // помесячная аналитика: 6 месяцев факта (включая текущий) и 6 месяцев ожиданий
  const monthlyStats = useMemo(() => {
    const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const acc = new Map();
    const get = (k) => {
      if (!acc.has(k)) acc.set(k, { received: 0, receivedProfit: 0, expected: 0, expectedProfit: 0 });
      return acc.get(k);
    };
    contracts.forEach((c) => {
      const st = contractStats(c);
      const profitFrac = st.financed > 0 ? Math.max(0, +c.markup || 0) / st.financed : 0;
      st.rows.forEach((r) => {
        r.paymentEvents.forEach((event) => {
          const m = get(keyOf(new Date(`${event.date}T00:00:00`)));
          m.received += +event.amount || 0;
          m.receivedProfit += (+event.amount || 0) * profitFrac;
        });
        if (!r.paid && r.remainingDue > 0) {
          const m = get(keyOf(r.dueDate));
          m.expected += r.remainingDue;
          m.expectedProfit += r.remainingDue * profitFrac;
        }
      });
    });
    const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const now = new Date();
    const mk = (offset) => {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const k = keyOf(d);
      return {
        key: k, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        ...(acc.get(k) || { received: 0, receivedProfit: 0, expected: 0, expectedProfit: 0 }),
      };
    };
    const past = [-5, -4, -3, -2, -1, 0].map(mk);
    const future = [0, 1, 2, 3, 4, 5].map(mk);
    const maxPast = Math.max(1, ...past.map((m) => m.received));
    const maxFuture = Math.max(1, ...future.map((m) => m.expected));
    return { past, future, maxPast, maxFuture };
  }, [contracts]);

  // группировка договоров по клиенту (по имени), с сохранением порядка сортировки
  const groupedContracts = useMemo(() => {
    const map = new Map();
    const order = [];
    filteredContracts.forEach((c) => {
      const key = c.clientName.trim().toLowerCase();
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(c);
    });
    return order.map((key) => {
      const list = map.get(key);
      let remaining = 0, overdue = 0;
      list.forEach((c) => {
        const st = contractStats(c);
        remaining += st.remaining;
        overdue += st.overdueSum;
      });
      return { key, list, remaining, overdue };
    });
  }, [filteredContracts]);

  if (!supabaseConfigured)
    return (
      <div className="app"><style>{css}</style>
        <div className="loading">
          Supabase не подключён — не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
        </div>
      </div>
    );

  if (session === undefined)
    return (
      <div className="app"><style>{css}</style>
        <div className="loading">Проверка входа…</div>
      </div>
    );

  if (!session)
    return <Login onLogin={login} busy={authBusy} error={authError} />;

  if (loadError)
    return (
      <div className="app"><style>{css}</style>
        <div className="loading">
          Не удалось загрузить данные: {loadError}
          <div><button className="btn primary btn-sm retry-btn" onClick={() => { setStorageError(""); setReloadTick((t) => t + 1); }}>Повторить</button></div>
        </div>
      </div>
    );

  if (!loaded)
    return (
      <div className="app"><style>{css}</style>
        <div className="loading">Загрузка ведомости…</div>
      </div>
    );

  return (
    <div className="app">
      <style>{css}</style>

      <header className="hd">
        <div className="brand">
          <span className="mark"><Wallet size={18} /></span>
          <div>
            <div className="bname">Рассрочки</div>
            <div className="btag">учёт договоров и платежей · v{APP_VERSION}</div>
          </div>
        </div>
        <div className="hd-actions">
          <button className="btn on-dark" onClick={() => setImporting(true)}>
            <Upload size={16} /> Импорт из Excel
          </button>
          <button
            className="btn on-dark"
            onClick={async () => {
              const XLSX = await import("xlsx");
              XLSX.writeFile(buildExportWorkbook(XLSX, contracts, investors), `rassrochki_${new Date().toISOString().slice(0, 10)}.xlsx`);
              await localData.log({ actionType: "export_excel", entityType: "export", entityName: "Полный экспорт", after: { contracts: contracts.length } });
            }}
          >
            <Download size={16} /> Экспорт
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Новый договор
          </button>
          <button className="icon-btn" onClick={logout} title="Выйти">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      {!isDesktopApp && <WebSyncStatus
        rows={{ contracts: contracts.map(contractToRow), investors: investors.map(investorToRow), withdrawals: withdrawals.map(withdrawalToRow) }}
        paused={Boolean(reminderQueue || adding || editingContract || addingInvestor || editingInvestor || addingWithdrawal || importing || dataCenterOpen || openId || expandedId || receivedOpen || profitGroupOpen || tab === 'directories' || confirmDialog || sectionModal)}
        onRefresh={() => setReloadTick(t => t + 1)}
      />}
      {isDesktopApp && <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', padding: '10px 0', fontSize: 13 }}>
        <span>{saveState.pending ? "Сохраняем…" : saveState.error ? `Ошибка сохранения: ${saveState.error}` : saveState.lastSavedAt ? `Сохранено · ${fmtDateTime(saveState.lastSavedAt)}` : "Данные загружены с Mac"}</span>
        <button className="btn ghost btn-sm" onClick={() => setDataCenterOpen(true)}>Последняя успешная копия: {lastBackupAt ? fmtDateTime(lastBackupAt) : "ещё не создана"}</button>
        {backupError && <span role="alert" style={{ color: 'var(--clay)' }}>Ошибка резервного копирования: {backupError}</span>}
      </div>}

      {operatorLogsError && <p role="alert">{operatorLogsError}</p>}
      <nav className="tabs">
        <button className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>
          <LayoutGrid size={16} /> Сводка
        </button>
        <button className={tab === "contracts" ? "on" : ""} onClick={() => setTab("contracts")}>
          <ScrollText size={16} /> Договоры <span className="cnt">{contracts.length}</span>
        </button>
        <button className={tab === "capital" ? "on" : ""} onClick={() => setTab("capital")}>
          <Landmark size={16} /> Капитал
        </button>
        {!isDesktopApp && <button className={tab === "directories" ? "on" : ""} onClick={() => setTab("directories")}><Users size={16}/> Справочники</button>}
        <button className={tab === "cash" ? "on" : ""} onClick={() => setTab("cash")}><Wallet size={16}/> Касса</button>
        <button onClick={() => setDataCenterOpen(true)}>
          {isDesktopApp ? <Database size={16} /> : <History size={16} />} {isDesktopApp ? "Данные" : "История"}
        </button>
      </nav>

      {storageError && (
        <div className="storage-warn-wrap">
          <div className="storage-warn">
            <AlertTriangle size={15} />
            <span>
              Не удалось сохранить последние изменения в базе данных.
              Изменения видны сейчас, но пропадут после перезагрузки страницы.
              <span className="storage-warn-detail">Ошибка: {storageError}</span>
            </span>
          </div>
        </div>
      )}
      {appMessage && <button type="button" className={`app-toast ${appMessage.tone || "error"}`} onClick={() => setAppMessage(null)}>{appMessage.message}<X size={14}/></button>}

      {tab === "cash" && <CashDesk contracts={contracts} cards={cards} onAddCard={addCashCard} onOpen={setOpenId}/> }
      {tab === "directories" && <Directories contracts={contracts} onSaveClient={updateDirectoryClient}/> }

      {tab === "dashboard" && (
        <main className="wrap dashboard-wrap">
          <button type="button" className="hero hero-btn" onClick={() => setSectionModal("remaining")}>
            <div className="hero-label">Остаток к получению</div>
            <div className="hero-num num">{money(totals.remaining)}</div>
            <Ribbon paid={totals.paid} overdue={totals.overdue} remaining={totals.remaining - totals.overdue} />
            <div className="hero-legend">
              <span><i className="dot s-paid" /> Оплачено {money(totals.paid)}</span>
              <span><i className="dot s-over" /> Просрочено {money(totals.overdue)}</span>
              <span><i className="dot s-rem" /> Остаток {money(totals.remaining - totals.overdue)}</span>
            </div>
          </button>

          <section className="cards">
            <Stat icon={<Wallet size={16} />} label="Получено всего" value={money(received.received)} onClick={() => { setReceivedView("received"); setReceivedOpen(true); }} />
            <Stat icon={<Wallet size={16} />} label="Выдано в рассрочку" value={money(totals.financed)} onClick={() => setSectionModal("financed")} />
            <Stat icon={<TrendingUp size={16} />} label="Общая прибыль" value={money(capital.profitTotal)} onClick={() => setSectionModal("profit")} />
            <Stat icon={<CheckCircle2 size={16} />} label="Прибыль получена" value={money(capital.profitRealized)} onClick={() => { setReceivedView("profit"); setReceivedOpen(true); }} />
            <Stat icon={<Users size={16} />} label="Активных договоров" value={totals.active} onClick={() => setSectionModal("active")} />
            <Stat icon={<AlertTriangle size={16} />} label="Должников (просрочка)" value={totals.debtors} tone={totals.debtors ? "clay" : ""} onClick={() => setSectionModal("debtors")} />
          </section>

          <section className="panel daily-panel">
            <div className="panel-hd daily-panel-hd">
              <span className="panel-hd-title"><CalendarDays size={15} /> Кто должен оплатить <span className="cnt">{dailyPayments.rows.length}</span></span>
              <div className="daily-date-controls">
                <select aria-label="Режим выбора ожидаемых платежей" value={dailyRange ? "range" : "day"} onChange={(e) => { setDailyRange(e.target.value === "range"); if (dailyTo < dailyDate) setDailyTo(dailyDate); }}>
                  <option value="day">Один день</option><option value="range">Произвольный период</option>
                </select>
                <label>{dailyRange ? "С даты" : "Дата"}<DateCalendar showValue value={dailyDate} max={dailyRange ? dailyTo || undefined : undefined} onChange={setDailyDate} label="Выбрать дату ожидаемых платежей" /></label>
                {dailyRange && <label>По дату включительно<DateCalendar showValue value={dailyTo} min={dailyDate || undefined} onChange={setDailyTo} label="По дату включительно" /></label>}
                <button className="btn ghost btn-sm" onClick={() => { const today = toIsoDate(new Date()); setDailyDate(today); setDailyTo(today); setDailyRange(false); }}>Сегодня</button>
              </div>
            </div>
            {dailyError ? <div className="empty" role="alert">{dailyError}</div> : <>
            <div className="received-totals daily-totals">
              <div><span>Клиентов должны оплатить</span><b className="num">{dailyPayments.clients}</b></div>
              <div><span>Платежей ожидается</span><b className="num">{dailyPayments.rows.length}</b></div>
              <div><span>Всего к оплате</span><b className="num">{money(dailyPayments.remaining)}</b></div>
            </div>
            {dailyPayments.rows.length ? <div className="data-list daily-payment-list">
              {dailyPayments.rows.map((row) => <button
                type="button" className="data-row data-row-button" key={`${row.contractId}-${row.paymentNo}`}
                onClick={() => setOpenId(row.contractId)}
              >
                <div>
                  <b>{row.clientName}</b>
                  <span>{row.phone ? fmtPhone(row.phone) : "Номер не указан"} · {row.item || "Без товара"} · платёж №{row.paymentNo}{row.dueDate ? ` · срок ${fmtDate(row.dueDate)}` : ""}</span>
                  <small>{row.notifiedAt ? `WhatsApp: уведомлён ${fmtDate(row.notifiedAt)}` : "WhatsApp: не уведомлён"}</small>
                </div>
                <div>
                  <b className="num">Текущий платёж: {money(row.remaining)}</b>
                  <small className="daily-total-debt">Общий долг: <strong className="num">{money(row.totalDebt)}</strong></small>
                  {row.overdueDebt > 0 && <small className="daily-overdue-debt">Из них просрочено: <strong className="num">{money(row.overdueDebt)}</strong></small>}
                  <span><Badge s={row.status} /></span>
                  {row.paidAmount > 0 && <small>Частично внесено {money(row.paidAmount)} из {money(row.amount)}</small>}
                </div>
              </button>)}
            </div> : <div className="empty daily-empty">За выбранный {dailyRange ? "период" : "день"} неоплаченных платежей по графику нет.</div>}
            </>}
          </section>

          <section className="panel daily-panel contact-tasks-panel">
            <div className="panel-hd"><Phone size={15} /> Связаться и проверить обещания <span className="cnt">{dailyContacts.length}</span></div>
            {dailyContacts.length ? <div className="data-list daily-payment-list">
              {dailyContacts.map((row) => <button type="button" className="data-row data-row-button" key={`${row.contractId}-${row.id}`} onClick={() => setOpenId(row.contractId)}>
                <div><b>{row.clientName}</b><span>{row.phone ? fmtPhone(row.phone) : "Номер не указан"} · {row.item || "Без товара"}</span><small>{row.note}</small>{row.promised && <small>Обещал оплатить: {fmtDate(row.promisedDate)}</small>}{row.nextContact && <small>Связаться: {fmtDate(row.nextContactDate)}</small>}</div>
                <div>{row.nextContact && <span className="badge b-brass">Связаться</span>}{row.promised && <span className="badge b-emerald">Обещал оплатить</span>}{row.promisedAmount > 0 && <b className="num">{money(row.promisedAmount)}</b>}</div>
              </button>)}
            </div> : <div className="empty daily-empty">За выбранный {dailyRange ? "период" : "день"} контактов и обещаний нет.</div>}
          </section>

          <section className="panel monthly-panel">
            <div className="panel-hd"><TrendingUp size={15} /> По месяцам</div>
            <div className="monthly-grid">
              <div className="monthly-col">
                <div className="mini-hd emerald">Получено</div>
                {monthlyStats.past.map((m) => (
                  <div key={m.key} className="month-row" title={`Прибыль: ${money(m.receivedProfit)}`}>
                    <span className="month-label">{m.label}</span>
                    <span className="month-bar">
                      <span className="month-bar-fill fill-received" style={{ width: `${(m.received / monthlyStats.maxPast) * 100}%` }} />
                    </span>
                    <span className="month-val num">{money(m.received)}</span>
                    <span className="month-profit num">{money(m.receivedProfit)}</span>
                  </div>
                ))}
              </div>
              <div className="monthly-col">
                <div className="mini-hd">Ожидается</div>
                {monthlyStats.future.map((m) => (
                  <div key={m.key} className="month-row" title={`Прибыль: ${money(m.expectedProfit)}`}>
                    <span className="month-label">{m.label}</span>
                    <span className="month-bar">
                      <span className="month-bar-fill fill-expected" style={{ width: `${(m.expected / monthlyStats.maxFuture) * 100}%` }} />
                    </span>
                    <span className="month-val num">{money(m.expected)}</span>
                    <span className="month-profit num">{money(m.expectedProfit)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="monthly-note">В последней колонке — прибыль (наценка) в составе суммы.</div>
          </section>

          <section className="panel">
            <div className="panel-hd panel-hd-row">
              <span className="panel-hd-title"><CalendarDays size={15} /> Ближайшие платежи <span className="cnt">{totals.upcoming.length}</span></span>
              {totals.upcoming.length > 8 && <button type="button" className="btn ghost btn-sm upcoming-toggle" onClick={() => setShowAllUpcoming((value) => !value)}>{showAllUpcoming ? "Свернуть" : `Показать все (${totals.upcoming.length})`}</button>}
            </div>
            {totals.upcoming.length === 0 ? (
              <div className="empty">Всё оплачено — открытых платежей нет.</div>
            ) : (
              <div className="rows">
                {visibleUpcoming.map((r) => (
                  <div key={r.cid + "-" + r.index} className="prow" role="button" tabIndex={0} onClick={() => { setOpenId(r.cid); }}>
                    <span className="prow-name-block">
                      <span className="prow-name">{r.client}</span>
                      {r.phone && <span className="prow-phone muted">{fmtPhone(r.phone)}</span>}
                    </span>
                    <span className="prow-date">{fmtDate(r.dueDate)}</span>
                    <span className="prow-sum num">{money(r.amountDue)}</span>
                    <Badge s={r.status} />
                    {waReminderLink(r.phone, r.client, r.item, r.remainingDue ?? r.amountDue, r.dueDate, r.status, r.overdueRows) ? (
                      <a
                        className={`wa-row-btn ${r.notifiedAt ? "notified" : ""}`}
                        href={waReminderLink(r.phone, r.client, r.item, r.remainingDue ?? r.amountDue, r.dueDate, r.status, r.overdueRows)}
                        target="_blank" rel="noreferrer"
                        title={r.notifiedAt ? `Уведомлён ${fmtDateTime(r.notifiedAt)}. Отправить повторно` : "Напомнить в WhatsApp"}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); notifyPayment(r.cid, r.index, e.currentTarget.href); }}
                      >
                        {r.notifiedAt ? <Check size={15} /> : <MessageCircle size={15} />}
                      </a>
                    ) : <span />}
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {tab === "contracts" && (
        <main className="wrap">
          {contracts.length === 0 ? (
            <div className="panel"><div className="empty">Договоров пока нет — добавьте первый кнопкой «Новый договор».</div></div>
          ) : (
          <>
          <div className="clist-toolbar">
            <div className="search-box">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Имя, телефон, товар или заметка…"
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch("")} title="Очистить"><X size={13} /></button>
              )}
            </div>
            <select className="toolbar-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="created">Сначала новые</option>
              <option value="dueDate">По ближайшему платежу</option>
              <option value="name">По имени (А-Я)</option>
              <option value="remaining">По остатку долга</option>
            </select>
            <button className="btn ghost btn-sm" aria-expanded={advancedFilters} onClick={()=>setAdvancedFilters(v=>!v)}>Фильтры{[investorFilter,contactFilter,notificationFilter,deferralFilter,callResultFilter].filter(v=>v!=="all").length ? ` · ${[investorFilter,contactFilter,notificationFilter,deferralFilter,callResultFilter].filter(v=>v!=="all").length}` : ""}</button>
            {advancedFilters && <div className="advanced-filters">
            <select className="toolbar-select" value={investorFilter} onChange={(e) => setInvestorFilter(e.target.value)}>
              <option value="all">Все источники</option>
              <option value="">Общий пул</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>{inv.name}</option>
              ))}
            </select>
            <select className="toolbar-select" value={contactFilter} onChange={(e) => setContactFilter(e.target.value)}>
              <option value="all">Все контакты</option>
              <option value="has">Есть история контактов</option>
              <option value="none">Без контактов</option>
            </select>
            <select className="toolbar-select" value={notificationFilter} onChange={(e) => setNotificationFilter(e.target.value)}>
              <option value="all">Все уведомления</option>
              <option value="notified">Текущий платёж уведомлён</option>
              <option value="unnotified">Текущий платёж не уведомлён</option>
              <option value="stale">Не уведомлены за 3 дня</option>
            </select>
            <label className={`toolbar-filter-label ${deferralFilter !== "all" ? "active" : ""}`}>
              <CalendarDays size={14}/><span>Отсрочка</span>
              <select value={deferralFilter} onChange={(e) => setDeferralFilter(e.target.value)}>
                <option value="all">Все</option>
                <option value="active">Действует</option>
                <option value="expired">Срок прошёл</option>
                <option value="none">Без отсрочки</option>
              </select>
            </label>
            {!isDesktopApp && <label className={`toolbar-filter-label ${callResultFilter !== "all" ? "active" : ""}`}>
              <Phone size={14}/><span>Отметка оператора</span>
              <select aria-label="Последняя отметка оператора" value={callResultFilter} onChange={(e) => setCallResultFilter(e.target.value)}>
                <option value="all">Все</option>
                {Object.entries(callResults).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                <option value="none">Без отметок оператора</option>
              </select>
            </label>}
            </div>}
            <div className="filter-chips">
              {[
                ["all", "Все"], ["active", "Активные"], ["overdue", "Просрочка"], ["done", "Закрытые"],
              ].map(([key, label]) => (
                <button key={key} className={statusFilter === key ? "on" : ""} onClick={() => setStatusFilter(key)}>
                  {label} <span className="filter-count">{filterCounts[key]}</span>
                </button>
              ))}
            </div>
            <button className="btn ghost btn-sm export-filtered" disabled={!filteredContracts.length} onClick={exportFilteredContracts}>
              <Download size={14} /> Экспорт списка ({filteredContracts.length})
            </button>
            {(workView || search || statusFilter !== "all" || investorFilter !== "all" || contactFilter !== "all" || notificationFilter !== "all" || deferralFilter !== "all" || callResultFilter !== "all" || sortBy !== "created") && <button className="btn ghost btn-sm" onClick={() => {
              setWorkView(""); setSearch(""); setStatusFilter("all"); setInvestorFilter("all"); setContactFilter("all"); setNotificationFilter("all"); setDeferralFilter("all"); setCallResultFilter("all"); setSortBy("created");
            }}><RotateCcw size={14} /> Сбросить фильтры</button>}
          </div>

          <div className="workbench-controls">
            <div className="workbench-views" aria-label="Сохранённые виды">{[["calls","Сегодня звонить"],["large","Крупные долги"],["promised","Обещали оплатить"]].map(([key,label])=><button key={key} className={`btn btn-sm ${workView===key?"primary":"ghost"}`} aria-pressed={workView===key} onClick={()=>{setWorkView(workView===key?"":key);setSearch("");setStatusFilter("all");setInvestorFilter("all");setContactFilter("all");setNotificationFilter("all");setDeferralFilter("all");setCallResultFilter("all");setSortBy(key==="large"?"remaining":"dueDate");}}>{label}</button>)}</div>
            <div className="seg-toggle" aria-label="Вид списка"><button className={listMode==="cards"?"on":""} onClick={()=>setListMode("cards")}>Карточки</button><button className={listMode==="table"?"on":""} onClick={()=>setListMode("table")}>Таблица</button></div>
            {workView && <small className="workbench-hint">{workView==="large"?"Просрочка от 100 000 ₽, по убыванию остатка долга":workView==="promised"?"Незакрытые договоры с обещанием на сегодня или будущую дату":"Контакты и обещания на сегодня или раньше; просрочки без уведомления за 72 часа"}</small>}
            <label className="select-visible"><input type="checkbox" checked={filteredContracts.length>0 && visibleSelected.length===filteredContracts.length} onChange={e=>setSelectedIds(e.target.checked?new Set(filteredContracts.map(c=>c.id)):new Set())}/> Выбрать все в списке</label>
            {visibleSelected.length>0 && <><button className="btn primary btn-sm" disabled={!visibleSelected.some(reminderFor)} onClick={beginReminders}>Напомнить выбранным в WhatsApp ({visibleSelected.filter(reminderFor).length})</button><button className="btn ghost btn-sm" onClick={()=>setSelectedIds(new Set())}>Снять выбор ({visibleSelected.length})</button>{visibleSelected.filter(c=>!reminderFor(c)).length>0 && <small>Без номера или открытого платежа: {visibleSelected.filter(c=>!reminderFor(c)).length}</small>}</>}
          </div>
          <div className="filtered-summary" aria-label="Итоги отфильтрованных договоров">
            <b>Итого по выборке</b>
            <span>Договоров <strong className="num">{filteredContracts.length}</strong></span>
            <span>Сумма договоров <strong className="num">{money(filteredSummary.financed)}</strong></span>
            <span>Остаток <strong className="num">{money(filteredSummary.remaining)}</strong></span>
            <span className="filtered-summary-profit">Прибыль получена <strong className="num">{money(filteredSummary.profitReceived)}</strong></span>
            <span className="filtered-summary-profit">Прибыль ожидается <strong className="num">{money(filteredSummary.profitExpected)}</strong></span>
            {filteredSummary.overdue > 0 && <span className="filtered-summary-overdue">Просрочка <strong className="num">{money(filteredSummary.overdue)}</strong></span>}
          </div>

          {filteredContracts.length === 0 ? (
            <div className="panel"><div className="empty">Ничего не найдено по этому запросу или фильтру.</div></div>
          ) : listMode === "table" ? <ContractTable contracts={filteredContracts} getStats={contractStats} selected={selectedIds} onSelect={toggleSelected} onPay={openQuickPay} onOpen={setOpenId} money={money}/> : (
          <div className="clist">
            {groupedContracts.map((g) => {
            const renderCard = (c) => {
              const st = contractStats(c);
              const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
              const expanded = expandedId === c.id;
              const overdueRows = st.rows.filter((r) => r.status === "overdue");
              const upcomingRows = st.rows.filter((r) => !r.paid && r.status !== "overdue");
              const paidRows = st.rows.filter((r) => r.paid);
              const investorLabel = c.investorId
                ? (investors.find((i) => i.id === c.investorId)?.name || "—")
                : "Общий пул";
              const reminderUrl = st.next
                ? waReminderLink(c.phone, c.clientName, c.item, st.next.remainingDue ?? st.next.amountDue, st.next.dueDate, st.next.status, st.rows)
                : null;
              return (
                <div key={c.id} className={`citem ${overdueRows.length ? "has-overdue" : ""} ${c.comment?.trim() ? "has-comment" : ""}`}>
                  <label className="card-select"><input type="checkbox" checked={selectedIds.has(c.id)} onChange={()=>toggleSelected(c.id)}/> Выбрать</label>
                  <div
                    className="citem-status-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setExpandedId(expanded ? null : c.id); } }}
                  >
                    <span className="citem-name-block">
                      <span className="citem-heading"><span className="citem-name" title={c.clientName}>{c.clientName}</span><ChevronDown size={16} className={`chev ${expanded ? "on" : ""}`} /></span>
                      {c.phone ? <a
                        className="citem-phone shown"
                        href={`tel:${normalizePhone(c.phone) ? `+${normalizePhone(c.phone)}` : c.phone}`}
                        title={`Позвонить: ${fmtPhone(c.phone)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDesktopApp) { e.preventDefault(); openExternalUrl(e.currentTarget.href); }
                        }}
                      ><Phone size={12} /> {fmtPhone(c.phone)}</a> : <span className="citem-phone shown"><Phone size={12} /> Номер не указан</span>}
                      {(c.investorId || !st.overdueSum) && <span className="citem-meta">{c.investorId && <span className="citem-investor muted" title={investorLabel}>{investorLabel}</span>}{!st.overdueSum && <Badge s={badge} />}</span>}
                      {overdueRows.length > 0 ? <span className="citem-overdue-summary">
                        <span className="citem-overdue-main"><span className="overdue-days"><AlertTriangle size={16}/> Просрочка {daysLabel(overdueDays(st.rows))}</span><b className="num">{money(st.overdueSum)}</b></span>
                        <span className="citem-overdue-meta">{overdueRows.length} {paymentWord(overdueRows.length)} · с {fmtDate(overdueRows[0].dueDate)}</span>
                      </span> : <span className={`citem-next-payment ${st.next || st.done ? "shown" : ""} ${st.done ? "closed" : ""}`}>
                        {st.done ? <CheckCircle2 size={12} /> : <CalendarDays size={12} />}
                        {st.done
                          ? "Договор полностью закрыт"
                          : st.next && toIsoDate(st.next.dueDate) === toIsoDate(new Date())
                            ? "Сегодня к оплате"
                            : st.next ? `Платёж ${fmtDate(st.next.dueDate)}` : "Платежей нет"}
                        {st.next ? <b className="num">· {money(st.next.remainingDue)}</b> : null}
                      </span>}
                      {(reminderUrl || st.next?.notifiedAt) && <span className="citem-notification-row">
                        <span className={`citem-notified ${st.next?.notifiedAt ? "shown" : "pending"}`}>
                          {st.next?.notifiedAt ? <Check size={13}/> : <MessageCircle size={13}/>}
                          <span>WhatsApp · {st.next?.notifiedAt ? `уведомлён ${fmtDate(st.next.notifiedAt)}` : "напомнить об оплате"}</span>
                        </span>
                        {reminderUrl && <button type="button"
                          className={`citem-card-wa ${st.next?.notifiedAt ? "notified" : ""}`}
                          aria-label={st.next?.notifiedAt ? "Повторно уведомить клиента в WhatsApp" : "Уведомить клиента в WhatsApp"}
                          title={st.next?.notifiedAt ? `Уведомлён ${fmtDateTime(st.next.notifiedAt)}. Отправить повторно` : "Уведомить клиента в WhatsApp"}
                          onClick={(e) => { e.stopPropagation(); notifyPayment(c.id, st.next.index, reminderUrl); }}
                        >{st.next?.notifiedAt ? <Check size={15}/> : <MessageCircle size={15}/>}</button>}
                      </span>}
                      <span className={`citem-deferral ${st.deferrals.length ? "shown" : ""}`}>
                        <CalendarDays size={12} /> Отсрочка до {st.deferrals[0] ? fmtDate(st.deferrals[0].dueDate) : ""}
                        {st.deferrals[0]?.deferralReason ? ` · ${st.deferrals[0].deferralReason}` : ""}
                        {st.deferrals[0]?.deferralHistory?.length > 1 ? ` · переносов ${st.deferrals[0].deferralHistory.length}` : ""}
                        {st.deferrals.length > 1 ? ` · платежей ${st.deferrals.length}` : ""}
                      </span>
                      {c.comment?.trim() && <span className="citem-comment" title={c.comment.trim()}>
                        <ScrollText size={12}/><span>{c.comment.trim()}</span>
                      </span>}
                      <span className="citem-amount">Остаток <b className="num">{money(st.remaining)}</b></span>
                    </span>
                  </div>
                  <div className="citem-open-row">
                    {!st.done && st.next && <button type="button" className="btn primary citem-open" onClick={()=>openQuickPay(c.id)}>Принять платёж</button>}
                    <button type="button" className="btn ghost btn-sm citem-open" onClick={() => setOpenId(c.id)}>
                      Карточка клиента
                    </button>
                  </div>
                  {expanded && (
                    <div className="citem-expand">
                      <section className="card-comment" aria-label="Комментарий к договору">
                        <div className="mini-hd">Комментарий</div>
                        <p>{c.comment?.trim() || "Комментарий не добавлен"}</p>
                      </section>
                      <section className="contact-history card-contacts" aria-label="История контактов клиента">
                        <div className="contact-history-hd"><div>
                          <b>История контактов</b>
                          <span>{expandedClientContacts.length ? `Записей: ${expandedClientContacts.length}` : "Контактов пока нет"}</span>
                        </div></div>
                        <ContactEntries contacts={expandedClientContacts} contractId={c.id} />
                      </section>
                      <div className="mini-row citem-contract-date">
                        <span>Дата составления договора</span><span className="num">{fmtDate(c.startDate)}</span>
                      </div>
                      {st.deferrals.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd brass">Отсрочка</div>
                          {st.deferrals.map((r) => (
                            <div key={r.index} className="mini-row citem-deferral-row">
                              <span>
                                Платёж №{r.n}: {fmtDate(r.scheduledDueDate)} → {fmtDate(r.dueDate)}
                                {r.deferralReason ? <small>Причина: {r.deferralReason}</small> : <small>Причина не указана</small>}
                              </span>
                              <span className="num">{money(r.remainingDue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {overdueRows.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd clay">Просрочено</div>
                          {overdueRows.map((r) => (
                            <div key={r.index} className="mini-row">
                              <span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.remainingDue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {upcomingRows.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd">Предстоящие</div>
                          {upcomingRows.map((r) => (
                            <div key={r.index} className="mini-row">
                              <span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.remainingDue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {paidRows.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd emerald">История платежей</div>
                          {paidRows.map((r) => (
                            <div key={r.index} className="mini-row">
                              <span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.amountDue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            if (g.list.length === 1) return renderCard(g.list[0]);
            return (
              <div key={"g-" + g.key} className="cgroup">
                <div className="cgroup-hd">
                  <span className="cgroup-name"><Users size={14} /> {g.list[0].clientName}</span>
                  <span className="cgroup-stats">
                    Договоров: {g.list.length} · Остаток <b className="num">{money(g.remaining)}</b>

                  </span>
                </div>
                <div className="cgroup-items">{g.list.map(renderCard)}</div>
              </div>
            );
            })}
          </div>
          )}
          </>
          )}
        </main>
      )}

      {tab === "capital" && (
        <main className="wrap">
          <FinancialReport contracts={contracts} investors={investors} withdrawals={withdrawals} getStats={contractStats} />
          <section className="hero">
            <div className="hero-label">Капитал вкладчиков</div>
            <div className="hero-num num">{money(capital.invested)}</div>
            <Ribbon
              paid={capital.deployed}
              overdue={capital.free < 0 ? -capital.free : 0}
              remaining={Math.max(0, capital.free)}
            />
            <div className="hero-legend">
              <span><i className="dot s-paid" /> В обороте {money(capital.deployed)}</span>
              {capital.free < 0 && (
                <span><i className="dot s-over" /> Не хватает вложений {money(-capital.free)}</span>
              )}
              <span><i className="dot s-rem" /> Свободно {money(Math.max(0, capital.free))}</span>
              {capital.withdrawnTotal > 0 && (
                <span>Выведено всего: {money(capital.withdrawnTotal)}</span>
              )}
            </div>
          </section>

          <section className="cards">
            <Stat icon={<TrendingUp size={16} />} label="Прибыль получена" value={money(capital.profitRealized)} />
            <Stat icon={<Clock size={16} />} label="Прибыль ожидается" value={money(capital.profitExpected)} />
            <Stat icon={<Wallet size={16} />} label="Прибыль всего по договорам" value={money(capital.profitTotal)} />
          </section>

          <section className="panel investor-profit-panel">
            <div className="panel-hd"><TrendingUp size={15} /> Прибыль по вкладчикам</div>
            {!investorProfits.reconciled && <div className="storage-warn">Итоги прибыли не сходятся на {money(Math.abs(investorProfits.difference))}. Данные не исправлялись автоматически — откройте расшифровку.</div>}
            <div className="profit-table-wrap">
              <table className="profit-table">
                <thead><tr><th>Источник</th><th>Вложено</th><th>В обороте</th><th>Возвращено</th><th>Прибыль получена</th><th>Ожидается</th><th>Выплачено</th><th>К выплате</th><th>Договоры</th></tr></thead>
                <tbody>{investorProfits.groups.map((group) => <tr key={group.key} onClick={() => setProfitGroupOpen(group)}>
                  <td><b>{group.name}</b></td><td className="num">{money(group.invested)}</td><td className="num">{money(group.capitalInTurnover)}</td><td className="num">{money(group.capitalReturned)}</td><td className="num">{money(group.profitReceived)}</td><td className="num">{money(group.profitExpected)}</td><td className="num">{money(group.paidOut)}</td><td className="num">{money(group.profitToPay)}</td><td>{group.contractCount}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>

          <section className="panel-hd panel-hd-row inv-list-hd">
            <span className="panel-hd-title"><Landmark size={15} /> Вкладчики</span>
            <button className="btn primary btn-sm" onClick={() => setAddingInvestor(true)}>
              <Plus size={14} /> Вкладчик
            </button>
          </section>

          {investors.length === 0 ? (
            <div className="panel"><div className="empty">Вкладчиков пока нет.</div></div>
          ) : (
            investors.map((inv) => {
              const invDeployed = capital.perInvestor[inv.id] || 0;
              const invWithdrawn = capital.withdrawnByInvestor[inv.id] || 0;
              const invFree = (+inv.amount || 0) - invDeployed - invWithdrawn;
              const pct = capital.invested ? Math.round(((+inv.amount || 0) / capital.invested) * 100) : 0;
              const invProfit = capital.profitByInvestor[inv.id] || { realized: 0, expected: 0 };
              const accrual = investorAccrual(inv, withdrawals);
              return (
                <div key={inv.id} className="inv-card">
                  <div className="citem-top">
                    <span className="citem-name">{inv.name}</span>
                    <span className="inv-card-actions">
                      <button className="icon-btn-ghost" onClick={() => setEditingInvestor(inv)} title="Изменить вкладчика"><Pencil size={14} /></button>
                      <button className="icon-btn-ghost" onClick={() => removeInvestor(inv.id)} title="Удалить"><Trash2 size={14} /></button>
                    </span>
                  </div>
                  <div className="det-grid inv-grid">
                    <div><span>Вклад</span><b className="num">{money(inv.amount)}</b></div>
                    <div><span>Доля</span><b className="num">{pct}%</b></div>
                    <div><span>В обороте</span><b className="num">{money(invDeployed)}</b></div>
                    <div><span>Выведено</span><b className="num">{money(invWithdrawn)}</b></div>
                    <div><span>Свободно</span><b className="num strong">{money(invFree)}</b></div>
                    <div><span>Прибыль получена</span><b className="num">{money(invProfit.realized)}</b></div>
                    <div><span>Прибыль ожидается</span><b className="num">{money(invProfit.expected)}</b></div>
                  </div>
                  {accrual.monthly > 0 && <div className="investor-accrual">
                    <div className="investor-accrual-hd"><b>Ежемесячные начисления</b><span>{money(accrual.monthly)} в месяц · с {fmtDate(inv.accrualStartDate)}</span></div>
                    <div className="investor-accrual-grid">
                      <div><span>Начислено</span><b className="num">{money(accrual.accrued)}</b></div>
                      <div><span>Выплачено</span><b className="num">{money(accrual.paid)}</b></div>
                      <div><span>К выплате</span><b className="num strong">{money(accrual.payable)}</b></div>
                      <div><span>Следующая дата</span><b className="num">{accrual.nextDue ? fmtDate(accrual.nextDue) : "—"}</b></div>
                    </div>
                    {accrual.payable > 0 && <button className="btn primary btn-sm" onClick={() => payInvestorAccrual(inv, Math.min(accrual.monthly, accrual.payable))}>
                      <Check size={13} /> Выплатить {money(Math.min(accrual.monthly, accrual.payable))}
                    </button>}
                  </div>}
                </div>
              );
            })
          )}
          {capital.perInvestor[""] > 0 && (
            <div className="muted unassigned-note">Без привязки к вкладчику в обороте: {money(capital.perInvestor[""])}</div>
          )}

          <section className="panel-hd panel-hd-row inv-list-hd wd-list-hd">
            <span className="panel-hd-title"><Wallet size={15} /> Выводы</span>
            <button className="btn primary btn-sm" onClick={() => setAddingWithdrawal(true)}>
              <Plus size={14} /> Вывод
            </button>
          </section>

          {withdrawals.length === 0 ? (
            <div className="panel"><div className="empty">Выводов пока не было.</div></div>
          ) : (
            <div className="panel">
              <div className="rows">
                {withdrawals.map((w) => {
                  const invName = w.investorId
                    ? (investors.find((i) => i.id === w.investorId)?.name || "—")
                    : "Общий пул / собственные";
                  return (
                    <div key={w.id} className="wd-row">
                      <span className="wd-date">{fmtDate(w.date)}</span>
                      <span className="wd-purpose"><span className="badge b-brass">{WITHDRAWAL_PURPOSES[w.purpose] || "Прочее"}</span></span>
                      <span className="wd-investor muted">{invName}</span>
                      <span className="wd-sum num strong">{money(w.amount)}</span>
                      <button className="icon-btn-ghost" onClick={() => removeWithdrawal(w.id)} title="Удалить">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      )}

      {reminderQueue && <div className="overlay"><div className="sheet reminder-queue" role="dialog" aria-modal="true" aria-label="Очередь напоминаний"><div className="sheet-hd"><b>Напоминания · осталось {reminderQueue.length}</b><button className="icon-btn" disabled={queueBusy} onClick={()=>setReminderQueue(null)} aria-label="Закрыть"><X size={18}/></button></div><div className="sheet-body">
        {queueContract ? <><h3>{queueContract.clientName}</h3><p>{queueContract.phone} · {queueContract.item}</p>{queueUrl && <pre className="reminder-preview">{new URL(queueUrl).searchParams.get("text")}</pre>}<p className="field-hint">Отправьте сообщение в WhatsApp и подтвердите отправку. Затем откроется следующий клиент очереди.</p><div className="sheet-actions"><button className="btn primary" disabled={queueBusy || !queueUrl} onClick={async()=>{setQueueBusy(true);try{const sent=await notifyPayment(queueContract.id,contractStats(queueContract).next.index,queueUrl);if(sent)setReminderQueue(q=>q.slice(1));}finally{setQueueBusy(false);}}}>Открыть WhatsApp</button><button className="btn ghost" disabled={queueBusy} onClick={()=>setReminderQueue(q=>q.slice(1))}>Пропустить</button></div></>:<><p>Очередь завершена.</p><button className="btn primary" onClick={()=>{setReminderQueue(null);setSelectedIds(new Set());}}>Готово</button></>}
      </div></div></div>}
      {open && (
        <Detail
          key={`${open.id}:${quickPayId===open.id ? "pay":"view"}`}
          initialAction={quickPayId===open.id ? "pay":undefined}
          contracts={contracts}
          contract={open}
          clientContacts={openClientContacts}
          investors={investors}
          onClose={() => { setOpenId(null); setQuickPayId(null); }}
          onToggle={togglePay}
          onNotify={notifyPayment}
          onUndoNotify={undoPaymentNotification}
          onDefer={deferPayment}
          onUpdatePaidDate={updatePaidDate}
          onEditPayment={editPaidPayment}
          onDeletePayment={deletePaidPayment}
          onPay={payPayment}
          cards={cards}
          onAttachReceipt={attachReceipt}
          onRemoveReceipt={removeReceipt}
          onEarlyPayoff={earlyPayoff}
          onDelete={deleteContract}
          onUpdateComment={updateComment}
          onAddContact={addContact}
          onDeleteContact={deleteContact}
          onEdit={(c) => { setOpenId(null); setEditingContract(c); }}
          onHistory={(c) => setDataCenterOpen({ contract: { id: c.id, name: c.clientName || c.client_name || c.id } })}
        />
      )}
      {adding && <AddForm cards={cards} investors={investors} clients={clientOptions} products={productOptions} onClose={() => setAdding(false)} onSave={addContract} />}
      {editingContract && (
        <AddForm cards={cards}
          investors={investors}
          clients={clientOptions} products={productOptions}
          editing={editingContract}
          onClose={() => setEditingContract(null)}
          onSave={updateContract}
        />
      )}
      {draftToContinue && draftToContinue.draft_type !== "Импорт Excel" && (
        <AddForm cards={cards}
          investors={investors}
          clients={clientOptions} products={productOptions}
          draft={draftToContinue}
          editing={contracts.find((contract) => contract.id === draftContractId(draftToContinue))}
          onClose={() => setDraftToContinue(null)}
          onSave={draftToContinue.draft_type === "Редактирование договора"
            ? (data) => updateContract(data, draftContractId(draftToContinue)) : addContract}
        />
      )}
      {draftToContinue && draftToContinue.draft_type === "Импорт Excel" && (
        <ImportModal
          investors={investors}
          contracts={contracts}
          draft={draftToContinue}
          onClose={() => setDraftToContinue(null)}
          onImport={importData}
        />
      )}
      {addingInvestor && <AddInvestorForm onClose={() => setAddingInvestor(false)} onSave={addInvestor} />}
      {editingInvestor && <AddInvestorForm editing={editingInvestor} onClose={() => setEditingInvestor(null)} onSave={updateInvestor} />}
      {addingWithdrawal && (
        <AddWithdrawalForm investors={investors} onClose={() => setAddingWithdrawal(false)} onSave={addWithdrawal} />
      )}
      {importing && (
        <ImportModal investors={investors} contracts={contracts} onClose={() => setImporting(false)} onImport={importData} />
      )}
      {sectionModal && (
        <SectionDetail
          title={sectionTitles[sectionModal]}
          rows={sectionRows}
          onClose={() => setSectionModal(null)}
          onOpenContract={(id) => { setSectionModal(null); setOpenId(id); }}
        />
      )}
      {dataCenterOpen && (
        <DataPanelBoundary onClose={() => setDataCenterOpen(false)}><React.Suspense fallback={<div className="overlay"><div className="loading">Загрузка данных приложения…</div></div>}>
          <DataCenter
            contractFilter={dataCenterOpen?.contract || null}
            onClose={() => setDataCenterOpen(false)}
            onRestored={() => setReloadTick((t) => t + 1)}
            onContinueDraft={(draft) => { setDataCenterOpen(false); setDraftToContinue(draft); }}
          />
        </React.Suspense></DataPanelBoundary>
      )}
      {confirmDialog && <ConfirmDialog options={confirmDialog} onCancel={() => finishConfirm(false)} onConfirm={() => finishConfirm(true)} />}
      {receivedOpen && <ReceivedDetail contracts={contracts} summary={received} view={receivedView} onClose={() => setReceivedOpen(false)} onOpenContract={(id) => { setReceivedOpen(false); setOpenId(id); }} />}
      {profitGroupOpen && <ProfitGroupDetail group={profitGroupOpen} onClose={() => setProfitGroupOpen(null)} onOpenContract={(id) => { setProfitGroupOpen(null); setOpenId(id); }} />}
      <div className="build-info">Версия {APP_VERSION} · сборка {fmtDate(`${BUILD_DATE}T00:00:00`)}</div>
    </div>
  );
}

/* --------------------------- Вход --------------------------------- */

function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    onLogin(email.trim(), password);
  };

  return (
    <div className="app">
      <style>{css}</style>
      <div className="login-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mark"><Wallet size={20} /></div>
          <div className="login-title">Рассрочки</div>
          <div className="login-sub">Войдите, чтобы продолжить</div>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </Field>
          <Field label="Пароль">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div className="login-error">{error}</div>}
          <button className="btn primary login-btn" type="submit" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}

const Stat = ({ icon, label, value, tone, onClick }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`stat ${onClick ? "stat-btn" : ""}`} onClick={onClick}>
      <div className="stat-ic">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className={`stat-val num ${tone || ""}`}>{value}</div>
    </Tag>
  );
};

function ConfirmDialog({ options, onCancel, onConfirm }) {
  return (
    <div className="overlay nested-overlay" onClick={onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h3>{options.title}</h3>
        <p>{options.message}</p>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onCancel}>Отмена</button>
          <button className={`btn ${options.danger === false ? "primary" : "danger"}`} onClick={onConfirm}>{options.confirmLabel || "Подтвердить"}</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Детали раздела сводки ------------------ */

function SectionDetail({ title, rows, onClose, onOpenContract }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">{title}</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          {rows.length === 0 ? (
            <div className="empty">Пусто.</div>
          ) : (
            <>
              <div className="section-total">
                <span>Итого · {rows.length} {rows.length === 1 ? "договор" : rows.length < 5 ? "договора" : "договоров"}</span>
                <b className="num">{money(rows.reduce((s, r) => s + r.amount, 0))}</b>
              </div>
              <div className="rows">
                {rows.map((r) => (
                  <button key={r.id} className="prow" onClick={() => onOpenContract(r.id)}>
                    <span className="prow-name">{r.name}</span>
                    <span className="prow-date">{r.item}</span>
                    <span className="prow-sum num">{money(r.amount)}</span>
                    <Badge s={r.badge} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceivedDetail({ contracts, summary: allTimeSummary, view = "received", onClose, onOpenContract }) {
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [to, setTo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const custom = month === "custom";
  const periodError = custom && (!from || !to ? "Укажите начало и конец периода." : from > to ? "Начало периода не может быть позже окончания." : "");
  const range = useMemo(() => custom ? { from, to } : null, [custom, from, to]);
  const [profitMode, setProfitMode] = useState("actual");
  const monthlyProfit = useMemo(() => profitComparisonByMonth(contracts, contractStats), [contracts]);
  const planned = useMemo(() => scheduledProfitSummary(contracts, contractStats, custom ? "" : month, range), [contracts, month, custom, range]);
  const showPlanned = view === "profit" && profitMode === "planned";
  const months = useMemo(() => monthlyProfit.map((row) => row.month), [monthlyProfit]);
  const summary = useMemo(
    () => month ? receivedSummary(contracts, contractStats, custom ? "" : month, range) : allTimeSummary,
    [contracts, allTimeSummary, month, custom, range]
  );
  const monthLabel = (value) => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${value}-01T12:00:00`));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd"><div className="sheet-name">{view === "profit" ? "Плановая и фактическая прибыль" : "Получено всего"}</div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18}/></button></div>
        <div className="sheet-body">
          <div className="received-period">
            <label htmlFor="received-month">Период</label>
            <select id="received-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">За всё время</option>
              <option value="custom">Произвольный период</option>
              {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </select>
          </div>
          {custom && <div className="received-period received-range">
            <label>С даты<DateCalendar showValue value={from} max={to || undefined} onChange={setFrom} label="С даты" /></label>
            <label>По дату включительно<DateCalendar showValue value={to} min={from || undefined} onChange={setTo} label="По дату включительно" /></label>
          </div>}
          {periodError ? <p role="alert" className="storage-warn">{periodError}</p> : <>
          {view === "profit" ? <>
            <div className="received-totals">
              <div><span>Обязательная прибыль (по графику)</span><b>{money(planned.profitScheduled)}</b></div>
              <div><span>Фактическая прибыль (получено)</span><b>{money(summary.profitReceived)}</b></div>
            </div>
            <p className="field-hint">План — наценка в полной сумме платежей по срокам с учётом переносов, включая уже оплаченные. Факт — наценка в поступлениях по дате оплаты. Разница не равна просрочке: возможны авансы и оплата старых долгов.</p>
            {!custom && <div className="monthly-profit-register profit-comparison">
              <div className="monthly-profit-register-hd"><span>Месяц</span><span>Обязательная</span><span>Фактическая</span></div>
              {monthlyProfit.map((row) => <button type="button" key={row.month} className={month === row.month ? "on" : ""} onClick={() => setMonth((current) => current === row.month ? "" : row.month)}>
                <span>{monthLabel(row.month)}</span><b className="num">{money(row.profitScheduled)}</b><strong className="num">{money(row.profitReceived)}</strong>
              </button>)}
              {!monthlyProfit.length && <div className="empty">Платежей пока нет.</div>}
            </div>
            }
            <div className="seg-toggle">
              <button type="button" className={!showPlanned ? "on" : ""} onClick={() => setProfitMode("actual")}>Фактические поступления</button>
              <button type="button" className={showPlanned ? "on" : ""} onClick={() => setProfitMode("planned")}>Обязательные платежи</button>
            </div>
            <p className="field-hint">Ниже — полные суммы {showPlanned ? "платежей по графику" : "поступлений"}, включая возврат капитала.</p>
          </> : <>
          <div className="received-totals received-plan-totals">
            <div><span>По плану за период</span><b>{money(planned.scheduled)}</b></div>
            <div><span>Фактически получено</span><b>{money(summary.received)}</b></div>
            <div><span>Возвращённый капитал</span><b>{money(summary.principalReturned)}</b></div>
            <div><span>Полученная прибыль</span><b>{money(summary.profitReceived)}</b></div>
          </div>
          <p className="field-hint">По плану — полная сумма платежей по графику за выбранный период с учётом переносов, включая уже оплаченные. Фактически получено — поступления по дате оплаты.</p>
          </>}
          {!summary.reconciled && <div className="storage-warn">Полученная сумма не сходится с капиталом и прибылью.</div>}
          <div className="data-list received-payment-list">
            {(showPlanned ? planned.rows : summary.rows).map((row, index) => <button className="data-row data-row-button" key={`${row.contractId}-${row.paymentNo}-${index}`} onClick={() => onOpenContract(row.contractId)}>
              <div><b>{row.clientName}</b><span>{row.item} · платёж №{row.paymentNo}</span></div><div><b className="num">{money(row.amount)}</b><small>{(showPlanned ? row.dueDate : row.paidDate) ? fmtDate(showPlanned ? row.dueDate : row.paidDate) : "дата не указана"}</small></div>
            </button>)}
            {!(showPlanned ? planned.rows : summary.rows).length && <div className="empty">За выбранный период платежей нет.</div>}
          </div>
          </>}
        </div>
      </div>
    </div>
  );
}

function ProfitGroupDetail({ group, onClose, onOpenContract }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd"><div className="sheet-name">{group.name}</div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18}/></button></div>
        <div className="sheet-body">
          <div className="received-totals"><div><span>Прибыль получена</span><b>{money(group.profitReceived)}</b></div><div><span>Прибыль ожидается</span><b>{money(group.profitExpected)}</b></div><div><span>К выплате</span><b>{money(group.profitToPay)}</b></div></div>
          <div className="data-list">{group.contracts.map((contract) => <button className="data-row data-row-button" key={contract.id} onClick={() => onOpenContract(contract.id)}><div><b>{contract.clientName}</b><span>{contract.item || "Без товара"}</span></div><div><b className="num">{money(contract.profitReceived)}</b><small>ожидается {money(contract.profitExpected)}</small></div></button>)}</div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Детали договора ----------------------- */

function ContactEntries({ contacts, contractId, onDelete }) {
  if (!contacts.length) return null;
  return <div className="contact-list">
    {contacts.map((contact) => <article className="contact-entry" key={`${contact._contractId || contractId}:${contact.id}`}>
      <div className="contact-entry-hd">
        <b>{contact.resultLabel || CONTACT_TYPES[contact.type] || "Контакт"}{contact.readOnly ? " · Оператор" : ""}</b>
        <time>{fmtDateTime(contact.occurredAt)}</time>
        {onDelete && !contact.readOnly && <button type="button" className="icon-btn-ghost" title="Удалить запись" onClick={() => onDelete(contact._contractId || contractId, contact.id)}><Trash2 size={13} /></button>}
      </div>
      {contact._contractId !== contractId && contact._item && <small className="contact-contract-label">Договор: {contact._item}</small>}
      <p>{contact.note}</p>
      {(contact.promisedDate || contact.promisedAmount > 0 || contact.nextContactDate) && <div className="contact-meta">
        {(contact.promisedDate || contact.promisedAmount > 0) && <span>Обещание: {contact.promisedDate ? fmtDate(contact.promisedDate) : "дата не указана"}{contact.promisedAmount > 0 ? ` · ${money(contact.promisedAmount)}` : ""}</span>}
        {contact.nextContactDate && <span>Связаться снова: {fmtDate(contact.nextContactDate)}</span>}
      </div>}
    </article>)}
  </div>;
}

function Detail(props) {
  const [selected, setSelected] = useState(props.initialAction ? {id:props.contract.id,mode:props.initialAction} : null);
  const selectedContract = props.contracts.find(c => c.id === selected?.id);
  if (selectedContract) return <ContractDetail {...props} key={`${selected.id}:${selected.mode || 'view'}`} contract={selectedContract} initialAction={selected.mode} onClose={() => setSelected(null)} />;
  return <ClientCard contract={props.contract} contracts={props.contracts} contacts={props.clientContacts}
    getStats={contractStats} investors={props.investors} onClose={props.onClose}
    onOpenContract={(id, mode) => setSelected({ id, mode })} onExternal={openExternalUrl}
    renderContacts={contacts => <ContactEntries contacts={contacts} onDelete={props.onDeleteContact} />} />;
}

function ContractDetail({ onDeletePayment, onEditPayment, cards = [], contract, clientContacts, investors, onClose, onToggle, onNotify, onUndoNotify, onDefer, onUpdatePaidDate, onPay, onAttachReceipt, onRemoveReceipt, onEarlyPayoff, onDelete, onUpdateComment, onAddContact, onDeleteContact, onEdit, onHistory, initialAction }) {
  const actionArea = useRef(null);
  useEffect(() => {
    if (initialAction) actionArea.current?.scrollIntoView({ block: "center" });
  }, [initialAction]);
  const st = contractStats(contract);
  const investorName = contract.investorId
    ? (investors.find((i) => i.id === contract.investorId)?.name || "—")
    : "Общий пул";

  const [comment, setComment] = useState(contract.comment || "");
  const [payingIdx, setPayingIdx] = useState(initialAction === "pay" ? st.next?.index ?? null : null);
  const [editEventIndex,setEditEventIndex] = useState(0);
  const [editRecord,setEditRecord] = useState(null);
  const [payMode, setPayMode] = useState("new"); // "new" | "edit"
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(initialAction === "pay" && st.next ? String(st.next.remainingDue) : "");
  const [payComment, setPayComment] = useState("");
  const [payMethod,setPayMethod] = useState("");
  const [payCard,setPayCard] = useState("");
  const [payBusy,setPayBusy] = useState(false);
  const paymentLock = useRef(false);
  const [payError,setPayError] = useState("");
  const [deferringIdx, setDeferringIdx] = useState(null);
  const [deferDate, setDeferDate] = useState("");
  const [deferReason, setDeferReason] = useState("");
  const [deferMode, setDeferMode] = useState('add');
  const [deferBusy, setDeferBusy] = useState(false);
  const [deferError, setDeferError] = useState('');
  const deferralPending = useRef(false);
  const [addingContact, setAddingContact] = useState(initialAction === "note");
  const [contactForm, setContactForm] = useState({
    type: "call", occurredAt: localDateTimeInput(), note: "",
    promisedDate: "", promisedAmount: "", nextContactDate: "",
  });
  const contacts = clientContacts || (Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : []);

  const saveContact = async () => {
    if (!contactForm.note.trim() || !contactForm.occurredAt) return;
    const saved = await onAddContact(contract.id, {
      id: `contact-${Date.now()}`, type: contactForm.type,
      occurredAt: new Date(contactForm.occurredAt).toISOString(), note: contactForm.note.trim(),
      promisedDate: contactForm.promisedDate || "", promisedAmount: +contactForm.promisedAmount || 0,
      nextContactDate: contactForm.nextContactDate || "",
    });
    if (!saved) return;
    setContactForm({ type: "call", occurredAt: localDateTimeInput(), note: "", promisedDate: "", promisedAmount: "", nextContactDate: "" });
    setAddingContact(false);
  };

  const startPay = (idx, remainingDue) => {
    if (paymentLock.current) return;
    setPayError("");
    setDeferringIdx(null);
    setPayingIdx(idx);
    setPayMode("new");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(String(remainingDue));
    setPayComment("");
  };

  const startEditDate = (idx, currentDate, eventIndex) => {
    const row = st.rows.find(r=>r.index===idx);
    const index = eventIndex ?? Math.max(0,row.paymentEvents.length-1);
    const event = row.paymentEvents[index];
    if (!event) return;
    setDeferringIdx(null); setPayingIdx(idx); setPayMode('edit'); setPayError('');
    setEditEventIndex(index); setEditRecord(JSON.parse(JSON.stringify(contract.payments[idx])));
    setPayDate(event.date); setPayAmount(String(event.amount)); setPayComment(event.comment || '');
    setPayMethod(event.method || ''); setPayCard(event.card || '');
  };

  const deleteSelectedPayment = async idx => {
    if (paymentLock.current) return;
    paymentLock.current = true; setPayBusy(true); setPayError('');
    try {
      if (await onDeletePayment(contract.id,idx,editEventIndex,editRecord)) setPayingIdx(null);
    } catch(e) {setPayError(e.message);} finally {paymentLock.current=false;setPayBusy(false);}
  };

  const confirmPay = async (idx) => {
    if (paymentLock.current) return;
    paymentLock.current = true; setPayBusy(true); setPayError('');
    try {
      const destination = payMode === 'edit' && !payMethod ? {} : paymentDestination(payMethod,payCard);
      const saved = payMode === 'edit'
        ? await onEditPayment(contract.id,idx,editEventIndex,editRecord,{date:payDate,amount:payAmount,comment:payComment,destination})
        : await onPay(contract.id, idx, payDate, +payAmount || 0, payComment, destination);
      if (saved) setPayingIdx(null);
    } catch(e) {setPayError(e.message);} finally {paymentLock.current=false;setPayBusy(false);}
  };

  const startDeferral = (row, mode = row.deferredUntil ? 'edit' : 'add') => {
    if (deferralPending.current) return;
    setPayingIdx(null);
    setDeferringIdx(row.index);
    setDeferMode(mode); setDeferError('');
    setDeferDate(mode === 'edit' ? row.deferredUntil : toIsoDate(addMonths(toIsoDate(row.dueDate), 1)));
    setDeferReason(mode === 'edit' ? row.deferralReason : '');
  };

  const confirmDeferral = async (row, mode = deferMode) => {
    if (deferralPending.current) return;
    deferralPending.current = true; setDeferBusy(true); setDeferError('');
    try {
      const saved = await onDefer(contract.id, row.index, mode === 'cancel' ? '' : deferDate, deferReason, mode);
      if (saved) setDeferringIdx(null);
      else if (mode !== 'cancel') setDeferError('Отсрочка не сохранена. Проверьте дату и сообщение об ошибке.');
    } catch (error) { setDeferError(error.message || String(error)); showAppMessage(error.message || String(error)); }
    finally { deferralPending.current = false; setDeferBusy(false); }
  };

  const handleFile = async (e, idx) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    onAttachReceipt(contract.id, idx, file);
    e.target.value = "";
  };

  const [pdfSaving, setPdfSaving] = useState(false);
  const saveContractPdf = async () => {
    if (pdfSaving) return;
    setPdfSaving(true);
    try {
      const { createContractPdf, contractPdfFilename } = await import('./contractPdf');
      const filename = contractPdfFilename(contract);
      let path;
      if (isDesktopApp) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        path = await save({ title: 'Сохранить договор PDF', defaultPath: filename, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (!path) return;
        if (!path.toLowerCase().endsWith('.pdf')) path += '.pdf';
      }
      const { default: fontUrl } = await import('./assets/DejaVuSans.ttf?url');
      const response = await fetch(fontUrl);
      if (!response.ok) throw new Error('Не удалось загрузить шрифт PDF');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const pdf = createContractPdf(contract, st, btoa(binary));
      if (isDesktopApp) {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(path, pdf);
        showAppMessage(`PDF сохранён: ${path}`, 'success');
      } else {
        const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
        const link = document.createElement('a'); link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) { showAppMessage(`Не удалось сохранить PDF: ${error.message || error}`); }
    finally { setPdfSaving(false); }
  };

  const printContract = () => {
    if (isDesktopApp) { saveContractPdf(); return; }
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rowsHtml = st.rows.map((r) => `
      <tr>
        <td>${r.n}</td>
        <td>${fmtDate(r.dueDate)}</td>
        <td class="num">${money(r.amountDue)}</td>
        <td>${r.paid ? `Оплачен ${fmtDate(r.paidDate)}` : r.paidAmount > 0 ? `Частично: ${money(r.paidAmount)}` : ""}</td>
      </tr>`).join("");
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Договор рассрочки — ${esc(contract.clientName)}</title>
<style>
  body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#16332E;margin:40px;font-size:14px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#4E5C57;margin-bottom:24px}
  table{border-collapse:collapse;width:100%;margin:14px 0 24px}
  th,td{border:1px solid #C7CEBF;padding:7px 10px;text-align:left;font-size:13px}
  th{background:#EEF1EB}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:10px}
  .grid div{padding:3px 0}
  .lbl{color:#4E5C57}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}
  .sign div{border-top:1px solid #16332E;padding-top:6px;font-size:12.5px;color:#4E5C57}
  @media print{body{margin:16mm}}
</style></head><body>
<h1>Договор рассрочки</h1>
<div class="sub">от ${fmtDate(contract.startDate)}</div>
<div class="grid">
  <div><span class="lbl">Клиент:</span> ${esc(contract.clientName)}</div>
  <div><span class="lbl">Телефон:</span> ${esc(fmtPhone(contract.phone)) || "—"}</div>
  <div><span class="lbl">Товар:</span> ${esc(contract.item) || "—"}</div>
  <div><span class="lbl">Сумма договора:</span> ${money(st.financed + (+contract.downPayment || 0))}</div>
  <div><span class="lbl">Первоначальный взнос:</span> ${money(contract.downPayment)}</div>
  <div><span class="lbl">Срок:</span> ${contract.termMonths} мес</div>
  <div><span class="lbl">К оплате в рассрочку:</span> ${money(st.financed)}</div>
  <div><span class="lbl">Поручитель:</span> ${esc(contract.guarantorName) || "—"}</div>
  <div><span class="lbl">Телефон поручителя:</span> ${esc(fmtPhone(contract.guarantorPhone)) || "—"}</div>
</div>
<table>
  <thead><tr><th>№</th><th>Дата платежа</th><th>Сумма</th><th>Отметка об оплате</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="sign">
  <div>Подпись продавца</div>
  <div>Подпись клиента</div>
</div>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) { showAppMessage("Разрешите всплывающие окна для печати"); return; }
    win.document.write(html);
    win.document.close();
  };

  const openReceipt = async (receipt) => {
    if (receipt.path) {
      // открываем вкладку сразу (по клику), иначе Safari заблокирует её после ожидания ссылки
      const win = window.open("about:blank", "_blank");
      const { data, error } = await supabase.storage.from("receipts").createSignedUrl(receipt.path, 60);
      if (error || !data?.signedUrl) { win?.close(); showAppMessage(`Не удалось открыть чек: ${error?.message || "нет ссылки"}`); return; }
      if (win) win.location.href = data.signedUrl;
      else window.open(data.signedUrl, "_blank");
    } else if (receipt.dataUrl) {
      window.open(receipt.dataUrl, "_blank");
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet contract-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <button className="icon-btn" onClick={onClose}><ChevronLeft size={18} /></button>
          <div>
            <div className="sheet-name">{contract.clientName}</div>
            {contract.phone && (
              <a className="sheet-phone" href={`tel:${contract.phone}`} onClick={(e) => { if (isDesktopApp) { e.preventDefault(); openExternalUrl(e.currentTarget.href); } }}><Phone size={12} /> {fmtPhone(contract.phone)}</a>
            )}
          </div>
          {contract.phone && st.next && waReminderLink(contract.phone, contract.clientName, contract.item, st.next.remainingDue ?? st.next.amountDue, st.next.dueDate, st.next.status, st.rows) && (
            <a
              className={`icon-btn wa-green ${st.next.notifiedAt ? "notified" : ""}`}
              href={waReminderLink(contract.phone, contract.clientName, contract.item, st.next.remainingDue ?? st.next.amountDue, st.next.dueDate, st.next.status, st.rows)}
              target="_blank" rel="noreferrer"
              title={st.next.notifiedAt ? `Уведомлён ${fmtDateTime(st.next.notifiedAt)}. Отправить повторно` : "Напомнить в WhatsApp"}
              onClick={(e) => { e.preventDefault(); onNotify(contract.id, st.next.index, e.currentTarget.href); }}
            >
              {st.next.notifiedAt ? <Check size={18} /> : <MessageCircle size={18} />}
            </a>
          )}
          <button className="icon-btn" onClick={() => onDelete(contract.id)} title="Удалить договор"><Trash2 size={18} /></button>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sheet-body">
          <button className="btn ghost client-return" onClick={onClose}><ChevronLeft size={14}/> К общей карточке клиента</button>
          <div className="det-item">{contract.item}</div>
          <div className="det-grid">
            <div><span>Цена</span><b className="num">{money(contract.totalPrice)}</b></div>
            <div><span>Взнос</span><b className="num">{money(contract.downPayment)}</b></div>
            <div><span>Наценка</span><b className="num">{money(contract.markup)}{contract.markupPercent ? ` (${contract.markupPercent}%)` : ""}</b></div>
            <div><span>Срок</span><b className="num">{contract.termMonths} мес</b></div>
            <div><span>К оплате</span><b className="num">{money(st.financed)}</b></div>
            <div><span>Остаток</span><b className="num strong">{money(st.remaining)}</b></div>
            <div><span>Источник</span><b className="num">{investorName}</b></div>
            <div>
              <span>Поручитель</span>
              <b className="num">
                {contract.guarantorName || "не указан"}
                {contract.guarantorPhone ? ` · ${fmtPhone(contract.guarantorPhone)}` : ""}
              </b>
            </div>
          </div>

          <div className="det-actions-row">
            <button type="button" className="btn ghost btn-sm" onClick={() => onEdit(contract)}>
              <Pencil size={13} /> Изменить договор
            </button>
            <button type="button" className="btn ghost btn-sm" disabled={pdfSaving} onClick={saveContractPdf}>
              <Download size={13} /> {pdfSaving ? 'Сохранение PDF…' : 'Сохранить PDF'}
            </button>
            {!isDesktopApp && <button type="button" className="btn ghost btn-sm" onClick={printContract}>
              <Printer size={13} /> Печать
            </button>}
            {onHistory && <button type="button" className="btn ghost btn-sm" onClick={() => onHistory(contract)}>
              <History size={13} /> История
            </button>}
          </div>

          <div className="comment-block">
            <label className="field comment-field">
              <span>Комментарий</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Заметки по договору…"
                rows={2}
              />
            </label>
            {comment !== (contract.comment || "") && (
              <button className="btn primary btn-sm comment-save" onClick={() => onUpdateComment(contract.id, comment)}>
                Сохранить комментарий
              </button>
            )}
          </div>

          <section className="contact-history">
            <div className="contact-history-hd">
              <div>
                <b>История контактов</b>
                <span>{contacts.length ? `Записей: ${contacts.length}` : "Контактов пока нет"}</span>
              </div>
              <button type="button" className="btn ghost btn-sm" onClick={() => setAddingContact((value) => !value)}>
                <Plus size={13} /> {addingContact ? "Закрыть" : "Добавить контакт"}
              </button>
            </div>
            {addingContact && (
              <div className="contact-form" ref={initialAction === "note" ? actionArea : null}>
                <label><span>Способ связи</span><select value={contactForm.type} onChange={(e) => setContactForm((f) => ({ ...f, type: e.target.value }))}>{Object.entries(CONTACT_TYPES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label><span>Дата и время</span><input type="datetime-local" value={contactForm.occurredAt} onChange={(e) => setContactForm((f) => ({ ...f, occurredAt: e.target.value }))} /></label>
                <label className="contact-note"><span>Результат разговора</span><textarea rows={2} value={contactForm.note} onChange={(e) => setContactForm((f) => ({ ...f, note: e.target.value }))} placeholder="Например: обещал оплатить до пятницы" /></label>
                <label><span>Обещанная дата оплаты</span><input type="date" value={contactForm.promisedDate} onChange={(e) => setContactForm((f) => ({ ...f, promisedDate: e.target.value }))} /></label>
                <label><span>Обещанная сумма</span><input type="number" min="0" value={contactForm.promisedAmount} onChange={(e) => setContactForm((f) => ({ ...f, promisedAmount: e.target.value }))} placeholder="0" /></label>
                <label><span>Следующий контакт</span><input type="date" value={contactForm.nextContactDate} onChange={(e) => setContactForm((f) => ({ ...f, nextContactDate: e.target.value }))} /></label>
                <button type="button" className="btn primary btn-sm contact-submit" disabled={!contactForm.note.trim() || !contactForm.occurredAt} onClick={saveContact}>Сохранить контакт</button>
              </div>
            )}
            <ContactEntries contacts={contacts} contractId={contract.id} onDelete={onDeleteContact} />
          </section>

          <div className="ledger-hd-row">
            <div className="ledger-hd ledger-hd-inline">График платежей</div>
            {!st.done && (
              <button className="btn ghost btn-sm" onClick={() => startPay(st.next?.index ?? st.rows?.find(r => !r.paid)?.index ?? 0, st.remaining)}>
                <CheckCircle2 size={13} /> Досрочное погашение
              </button>
            )}
          </div>
          <div className="ledger">
            {st.rows.map((r) => (
              <div key={r.index} className={`lrow ${r.status}`}>
                <span className="lnum num">{r.n}</span>
                <span className="ldate">{fmtDate(r.dueDate)}</span>
                <span className="lsum num">{money(r.amountDue)}</span>
                <span className="lstatus"><Badge s={r.status} /></span>
                {r.paid ? (
                  <div className="lbtn-group">
                    <button className="lbtn undo" onClick={() => onToggle(contract.id, r.index)}>
                      <Undo2 size={13} /> Отменить
                    </button>
                    <button
                      className="lbtn undo edit-date"
                      title="Редактировать платёж" aria-label="Редактировать платёж"
                      onClick={() => (payingIdx === r.index ? setPayingIdx(null) : startEditDate(r.index, r.paidDate))}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                ) : r.paidAmount > 0 ? (
                  <div className="lbtn-group">
                    <button hidden={payingIdx === r.index} className="lbtn pay" onClick={() => (payingIdx === r.index && payMode === "new" ? setPayingIdx(null) : startPay(r.index, r.remainingDue))}>
                      <Check size={13} /> Доплатить
                    </button>
                    <button className="lbtn undo" title="Редактировать платёж" onClick={() => startEditDate(r.index,r.paidDate)}><Pencil size={13}/> Изменить</button>
                    <button className="lbtn undo" title="Сбросить оплату" onClick={() => onToggle(contract.id, r.index)}>
                      <Undo2 size={13} />
                    </button>
                    <button className="lbtn defer" disabled={deferBusy} title={r.deferredUntil ? "Изменить отсрочку" : "Отсрочить платёж"} onClick={() => deferringIdx === r.index ? setDeferringIdx(null) : startDeferral(r)}>
                      <CalendarDays size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="lbtn-group">
                    <button hidden={payingIdx === r.index} className="lbtn pay" onClick={() => (payingIdx === r.index ? setPayingIdx(null) : startPay(r.index, r.remainingDue))}>
                      <Check size={13} /> Оплатить
                    </button>
                    <button className="lbtn defer" disabled={deferBusy} title={r.deferredUntil ? "Изменить отсрочку" : "Отсрочить платёж"} onClick={() => deferringIdx === r.index ? setDeferringIdx(null) : startDeferral(r)}>
                      <CalendarDays size={13} />
                    </button>
                  </div>
                )}
                {r.paidAmount > 0 && !r.paid && (
                  <div className="partial-note">
                    <strong>К доплате — <span className="money-nowrap">{money(r.remainingDue)}</span></strong>
                    <span>Внесено <span className="money-nowrap">{money(r.paidAmount)}</span> из <span className="money-nowrap">{money(r.amountDue)}</span>.</span>
                  </div>
                )}
                {r.paymentEvents.length > 0 && <details className="payment-details"><summary>История платежей · {r.paymentEvents.length}</summary><div className="payment-comments" aria-label="Фактические оплаты">
                  {r.paymentEvents.map((event, index) => <span key={`${event.createdAt || event.date}-${index}`}>
                    <CheckCircle2 size={12}/><span>Оплата {fmtDate(event.date)} · {money(event.amount)}{event.method === 'cash' ? ' · Наличные' : event.method === 'bank' ? ` · Безнал · ${event.card || 'Карта не указана'}` : ''}{event.comment ? ` — ${event.comment}` : ''}</span>
                  </span>)}
                </div></details>}
                {r.notifiedAt && (
                  <details className="payment-details"><summary>Уведомление WhatsApp</summary><div className="notification-note" title="Отметка ставится при открытии напоминания в WhatsApp">
                    <MessageCircle size={13} /> Уведомлён через WhatsApp · {fmtDateTime(r.notifiedAt)}
                    <button type="button" className="notification-undo" onClick={() => onUndoNotify(contract.id, r.index)}>
                      <Undo2 size={12} /> Отменить отметку
                    </button>
                  </div></details>
                )}
                {r.deferredUntil && (
                  <div className="deferral-history">
                    <div className="deferral-note">
                      <CalendarDays size={13} /> Текущая отсрочка до {fmtDate(r.dueDate)}
                      {r.deferralHistory.length > 1 ? ` · переносов: ${r.deferralHistory.length}` : ""}
                    </div>
                    <div className="deferral-steps">
                      {(r.deferralHistory.length ? r.deferralHistory : [{ fromDate: toIsoDate(r.scheduledDueDate), toDate: r.deferredUntil, reason: r.deferralReason }]).map((entry, index) => (
                        <span key={`${entry.toDate}-${index}`}>{index + 1}. {fmtDate(entry.fromDate)} → {fmtDate(entry.toDate)}{entry.reason ? ` · ${entry.reason}` : ""}</span>
                      ))}
                    </div>
                    {!r.paid && <div className="deferral-actions">
                      <button type="button" className="btn ghost btn-sm" disabled={deferBusy} onClick={() => startDeferral(r, 'edit')}><Pencil size={13}/> Изменить</button>
                      <button type="button" className="btn ghost btn-sm" disabled={deferBusy} onClick={() => startDeferral(r, 'add')}><Plus size={13}/> Добавить отсрочку</button>
                      <button type="button" className="btn ghost btn-sm" disabled={deferBusy} onClick={() => confirmDeferral(r, 'cancel')}><Undo2 size={13}/> Отменить последнюю</button>
                    </div>}
                  </div>
                )}
                {deferringIdx === r.index && (
                  <div className="defer-inline">
                    <fieldset disabled={deferBusy} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, border: 0, padding: 0, margin: 0, minWidth: 0, width: '100%' }}>
                      <label><span>{deferMode === 'edit' ? 'Исправить дату отсрочки' : 'Новая дата платежа'}</span><DateFields value={deferDate} onChange={setDeferDate} /></label>
                      <label className="defer-reason"><span>Причина (необязательно)</span><input value={deferReason} onChange={(e) => setDeferReason(e.target.value)} placeholder="По просьбе клиента" /></label>
                      <button type="button" className="btn primary btn-sm" disabled={!deferDate || deferBusy} onClick={() => confirmDeferral(r)}>{deferBusy ? 'Сохраняем…' : deferMode === 'edit' ? 'Сохранить изменения отсрочки' : 'Сохранить новую отсрочку'}</button>
                      <button type="button" className="btn ghost btn-sm" onClick={() => setDeferringIdx(null)}>Закрыть</button>
                    </fieldset>
                    {deferError && <p role="alert">{deferError}</p>}
                  </div>
                )}
                {payingIdx === r.index && (
                  <div className="pay-inline" ref={initialAction === "pay" ? actionArea : null}>
                    {payMode === 'edit' && <label>Поступление <select aria-label="Редактируемое поступление" disabled={payBusy} value={editEventIndex} onChange={e=>startEditDate(r.index,r.paidDate,+e.target.value)}>{r.paymentEvents.map((event,i)=><option key={i} value={i}>{fmtDate(event.date)} · {money(event.amount)} · {event.method === 'cash' ? 'Наличные' : event.card || 'Способ не указан'}</option>)}</select></label>}
                    <div className="pay-date-field"><span>Дата оплаты</span><DateFields value={payDate} onChange={setPayDate} /></div>
                    <div className="pay-destination"><PaymentDestination method={payMethod} card={payCard} onMethod={setPayMethod} onCard={setPayCard} cards={cards}/></div>
                    {payError && <p role="alert">{payError}</p>}
                    {(
                      <>
                        <label className="pay-amount-field"><span>Сумма, ₽</span><input
                          type="number"
                          className="pay-amount"
                          min="1"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="Сумма"
                          aria-label="Сумма платежа" title={payMode === "edit" ? "Сумма выбранного поступления" : "Сумма распределится по старым просрочкам и следующим платежам"}
                        />
                        </label><label className="pay-comment-field"><span>Комментарий (необязательно)</span><input
                          type="text"
                          className="pay-comment"
                          value={payComment}
                          onChange={(e) => setPayComment(e.target.value)}
                          placeholder="Комментарий к оплате"
                        /></label>
                      </>
                    )}
                    <div className="pay-form-actions"><button className="btn primary btn-sm" disabled={payBusy || !payDate || !(+payAmount > 0) || (payMode === "new" && !payMethod) || (payMethod === "bank" && !payCard.trim())} onClick={() => confirmPay(r.index)}>{payBusy ? "Сохраняем…" : payMode === "edit" ? "Сохранить изменения" : "Сохранить платёж"}</button>
                    {payMode === 'edit' && <button type="button" className="btn ghost btn-sm" style={{color:'var(--clay)'}} disabled={payBusy} onClick={()=>deleteSelectedPayment(r.index)}><Trash2 size={13}/> Удалить поступление</button>}
                    <button className="btn ghost btn-sm" disabled={payBusy} onClick={() => setPayingIdx(null)}>Отмена</button></div>
                    {payMode === "new" && +payAmount > r.remainingDue && (
                      <small className="payment-allocation-note">Сначала закроются старые просрочки, затем следующие платежи.</small>
                    )}
                  </div>
                )}
                <details className="payment-details"><summary>Чеки{r.receipt ? " · 1" : " · прикрепить"}</summary><div className="receipt-row">
                  {r.receipt ? (
                    <>
                      <button type="button" className="receipt-link" onClick={() => openReceipt(r.receipt)}>
                        <FileText size={13} /> {r.receipt.name}
                      </button>
                      <button className="receipt-remove" onClick={() => onRemoveReceipt(contract.id, r.index)} title="Удалить чек">
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <label className="receipt-btn" htmlFor={`receipt-${contract.id}-${r.index}`}>
                      <Paperclip size={13} /> Прикрепить чек
                      <input
                        id={`receipt-${contract.id}-${r.index}`}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden-file-input"
                        onChange={(e) => handleFile(e, r.index)}
                      />
                    </label>
                  )}
                </div></details>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Новый договор ------------------------- */

function AddForm({ cards = [], investors, clients = [], products = [], onClose, onSave, editing, draft }) {
  const draftData = draft?.data || null;
  const source = draftData || editing;
  const [f, setF] = useState({
    clientName: source?.clientName || "", phone: source?.phone || "", item: source?.item || "",
    comment: source?.comment || "",
    totalPrice: source ? String(source.totalPrice || "") : "",
    downPayment: source ? String(source.downPayment || "") : "",
    downPaymentMethod: source?.downPaymentMethod || source?.payments?.__downPaymentDestination?.method || "",
    downPaymentCard: source?.downPaymentCard || source?.payments?.__downPaymentDestination?.card || "",
    markupPercent: source ? String(source.markupPercent || 0) : "20",
    markupAmount: source ? String(source.markupAmount ?? source.markup ?? 0) : "0",
    totalPayable: source ? String(source.totalPayable ?? Math.max(0,
      (+source.totalPrice || 0) - (+source.downPayment || 0) + (+(source.markupAmount ?? source.markup) || 0))) : "0",
    monthlyPayment: source ? String(source.monthlyPayment || 0) : "0",
    termMonths: source ? String(source.termMonths || 1) : "6",
    startDate: source?.startDate || new Date().toISOString().slice(0, 10),
    investorId: source?.investorId || "",
    guarantorName: source?.guarantorName || "", guarantorPhone: source?.guarantorPhone || "",
    markupBase: source?.markupBase || (source ? "principal" : "full"), // "principal" (цена−взнос) | "full" (полная цена)
  });
  const [showGuarantor, setShowGuarantor] = useState(!!(source?.guarantorName || source?.guarantorPhone));
  const [selectedClient, setSelectedClient] = useState("");
  // что пользователь редактировал последним — процент или сумму наценки:
  // при изменении цены/взноса пересчитываем ту величину, которую он НЕ трогал.
  // для существующего договора по умолчанию бережём загруженную сумму (не затираем её процентом).
  const [lastEditedMarkup, setLastEditedMarkup] = useState(source ? "amount" : "percent");
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const draftId = useRef(draft?.id || `${editing ? "edit" : "new"}-contract-${editing?.id || Date.now()}`);
  const newContractId = useRef(draftData?.newContractId || `c${crypto.randomUUID()}`);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const saveInProgress = useRef(false);
  const draftSaved = useRef(false);
  const draftWrite = useRef(Promise.resolve());
  const persistDraft = (values) => {
    if (!isDesktopApp || draftSaved.current) return Promise.resolve();
    const filled = [values.clientName, values.phone, values.item, values.totalPrice, values.startDate, values.termMonths].filter((value) => String(value || "").trim()).length;
    const task = localData.saveDraft({
      id: draftId.current, draftType: editing || draft?.draft_type === "Редактирование договора" ? "Редактирование договора" : "Новый договор",
      title: values.clientName || values.item || "Новый договор",
      data: { ...values, contractId: editing?.id || draftContractId(draft) || undefined, newContractId: newContractId.current },
      completion: Math.round(filled / 6 * 100),
    });
    draftWrite.current = task;
    return task;
  };
  const closeForm = async () => {
    if (saveInProgress.current) return;
    try { await persistDraft(f); onClose(); }
    catch (error) { setFormError(`Не удалось сохранить черновик: ${error.message || error}`); }
  };
  const selectClient = (e) => {
    const key = e.target.value;
    setSelectedClient(key);
    const client = clients.find((item) => item.key === key);
    if (client) setF((prev) => ({ ...prev, clientName: client.name, phone: client.phone || "" }));
  };

  useEffect(() => {
    if (!isDesktopApp) return;
    let current = true;
    setDraftStatus("Сохраняем черновик…");
    persistDraft(f).then(() => { if (current) setDraftStatus("Черновик сохранён на Mac"); })
      .catch((error) => { if (current) { setDraftStatus("Черновик не сохранён в базе"); setFormError(error.message || String(error)); } });
    return () => { current = false; };
  }, [f, editing]);

  const principal = Math.max(0, (+f.totalPrice || 0) - (+f.downPayment || 0));
  // база, от которой считается процент наценки
  const markupBaseValue = f.markupBase === "full" ? (+f.totalPrice || 0) : principal;

  // цена/взнос/база меняются — пересчитываем платёж в месяц и ту из величин
  // наценки (сумма/процент), которую пользователь НЕ редактировал последней
  useEffect(() => {
    setF((prev) => {
      if (lastEditedMarkup === "amount") {
        const amount = +prev.markupAmount || 0;
        const percent = markupBaseValue > 0 ? Math.round((amount / markupBaseValue) * 1000) / 10 : 0;
        const monthly = Math.round((principal + amount) / Math.max(1, +prev.termMonths || 1));
        return { ...prev, markupPercent: String(percent), totalPayable: String(principal + amount), monthlyPayment: String(monthly) };
      }
      const amount = Math.round(markupBaseValue * (+prev.markupPercent || 0) / 100);
      const monthly = Math.round((principal + amount) / Math.max(1, +prev.termMonths || 1));
      return { ...prev, markupAmount: String(amount), totalPayable: String(principal + amount), monthlyPayment: String(monthly) };
    });
  }, [markupBaseValue, principal]);

  const onMarkupPercent = (e) => {
    const percent = e.target.value;
    setLastEditedMarkup("percent");
    const amount = Math.round(markupBaseValue * (+percent || 0) / 100);
    const monthly = Math.round((principal + amount) / Math.max(1, +f.termMonths || 1));
    setF((prev) => ({ ...prev, markupPercent: percent, markupAmount: String(amount), totalPayable: String(principal + amount), monthlyPayment: String(monthly) }));
  };

  const onMarkupAmount = (e) => {
    const amount = e.target.value;
    setLastEditedMarkup("amount");
    const percent = markupBaseValue > 0 ? Math.round(((+amount || 0) / markupBaseValue) * 1000) / 10 : 0;
    const monthly = Math.round((principal + (+amount || 0)) / Math.max(1, +f.termMonths || 1));
    setF((prev) => ({ ...prev, markupAmount: amount, markupPercent: String(percent), totalPayable: String(principal + (+amount || 0)), monthlyPayment: String(monthly) }));
  };

  const onTotalPayable = (e) => {
    const totalPayableInput = e.target.value;
    const totalPayable = Math.max(principal, +totalPayableInput || 0);
    // При вводе общей суммы пересчитываем ежемесячный платёж.
    setLastEditedMarkup("amount");
    const term = Math.max(1, +f.termMonths || 1);
    const amount = Math.max(0, Math.round(totalPayable - principal));
    const percent = markupBaseValue > 0 ? Math.round((amount / markupBaseValue) * 1000) / 10 : 0;
    const monthly = Math.round(totalPayable / term);
    setF((prev) => ({ ...prev, totalPayable: totalPayableInput, monthlyPayment: String(monthly), markupAmount: String(amount), markupPercent: String(percent) }));
  };

  const onMonthlyPayment = (e) => {
    const monthlyInput = e.target.value;
    setLastEditedMarkup("amount");
    const term = Math.max(1, +f.termMonths || 1);
    const totalPayable = Math.round((+monthlyInput || 0) * term);
    const amount = totalPayable - principal;
    const percent = markupBaseValue > 0 ? Math.round((amount / markupBaseValue) * 1000) / 10 : 0;
    setF((prev) => ({ ...prev, monthlyPayment: monthlyInput, totalPayable: String(totalPayable), markupAmount: String(amount), markupPercent: String(percent) }));
  };

  const onTermMonths = (e) => {
    const term = e.target.value;
    const amount = +f.markupAmount || 0;
    const monthly = Math.round((principal + amount) / Math.max(1, +term || 1));
    setF((prev) => ({ ...prev, termMonths: term, monthlyPayment: String(monthly) }));
  };

  const markup = +f.markupAmount || 0;
  const financed = principal + markup;
  const changes = { ...f, totalPrice: +f.totalPrice, downPayment: +f.downPayment || 0, markup,
    termMonths: +f.termMonths, markupPercent: +f.markupPercent || 0 };
  let editError = "";
  if (draft?.draft_type === "Редактирование договора" && !editing) editError = "Исходный договор не найден. Восстановите его из корзины, затем продолжите черновик.";
  if (editing) { try { prepareContractEdit(editing, changes); } catch (error) { editError = error.message; } }
  const valid = f.clientName.trim().length > 0 && Number.isInteger(+f.termMonths) && +f.termMonths > 0
    && +f.termMonths <= 600 && +f.totalPrice >= 0 && (+f.downPayment || 0) >= 0
    && (+f.downPayment || 0) <= +f.totalPrice && markup >= 0 && !editError;
  const comparison = editing ? [
    ["Клиент", editing.clientName, f.clientName], ["Телефон", fmtPhone(editing.phone), fmtPhone(f.phone)],
    ["Товар", editing.item, f.item], ["Цена", money(editing.totalPrice), money(+f.totalPrice)],
    ["Первоначальный взнос", money(editing.downPayment), money(+f.downPayment)],
    ["Наценка", money(editing.markup), money(markup)],
    ["К оплате", money(contractStats(editing).financed), money(financed)],
    ["Срок", `${editing.termMonths} мес.`, `${f.termMonths} мес.`],
    ["Первый платёж", editing.startDate, f.startDate],
    ["Остаток", money(contractStats(editing).remaining), money(financed - contractStats(editing).paidSum)],
    ["Комментарий", editing.comment, f.comment],
  ].filter(([, before, after]) => String(before || "") !== String(after || "")) : [];
  const samePhoneClient = clients.find((client) => {
    const phone = normalizePhone(f.phone);
    return phone && normalizePhone(client.phone) === phone && client.contractIds.some((id) => id !== editing?.id);
  });

  return (
    <div className="overlay" onClick={closeForm}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">{editing ? "Изменить договор" : "Новый договор рассрочки"}</div>
          <button className="icon-btn" disabled={saving} onClick={closeForm}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {clients.length > 0 && <Field label="Выбрать клиента из базы">
            <select value={selectedClient} onChange={selectClient}>
              <option value="">Новый клиент / ввести вручную</option>
              {clients.map((client) => <option key={client.key} value={client.key}>{client.name}{client.phone ? ` · ${fmtPhone(client.phone)}` : ""}{client.contractCount > 1 ? ` · договоров ${client.contractCount}` : ""}</option>)}
            </select>
          </Field>}
          <Field label="ФИО клиента"><input value={f.clientName} onChange={set("clientName")} placeholder="Иванов Иван" /></Field>
          <div className="frow">
            <Field label="Телефон"><input value={f.phone} onChange={set("phone")} placeholder="+7 …" /></Field>
            <Field label="Дата 1-го платежа">
              <DateFields value={f.startDate} onChange={(v) => setF((prev) => ({ ...prev, startDate: v }))} />
            </Field>
          </div>
          {samePhoneClient && <div className="duplicate-client-hint"><AlertTriangle size={14}/><span>В базе уже есть клиент «{samePhoneClient.name}» с таким номером, договоров: {samePhoneClient.contractCount}. Проверьте, не создаёте ли вы дубликат.</span></div>}
          <Field label="Выбрать товар из базы">
            <select
              value={products.find((product) => product.key === String(f.item || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru"))?.key || ""}
              onChange={(e) => {
                const product = products.find((product) => product.key === e.target.value);
                setF((prev) => ({ ...prev, item: product?.name || "" }));
              }}
            >
              <option value="">Новый товар / ввести вручную</option>
              {products.map((product) => <option key={product.key} value={product.key}>{product.name}</option>)}
            </select>
          </Field>
          <Field label="Товар">
            <input value={f.item} onChange={set("item")} placeholder="Телефон, техника…" />
            <small className="field-hint">Новый товар появится в списке после сохранения договора.</small>
          </Field>
          {showGuarantor ? (
            <div className="frow">
              <Field label="Поручитель, ФИО">
                <input value={f.guarantorName} onChange={set("guarantorName")} placeholder="Иванов Иван" />
              </Field>
              <Field label="Поручитель, телефон">
                <input value={f.guarantorPhone} onChange={set("guarantorPhone")} placeholder="+7 …" />
              </Field>
            </div>
          ) : (
            <button type="button" className="btn ghost btn-sm guarantor-toggle" onClick={() => setShowGuarantor(true)}>
              <Plus size={13} /> Добавить поручителя
            </button>
          )}
          <div className="frow">
            <Field label="Цена товара"><input type="number" value={f.totalPrice} onChange={set("totalPrice")} placeholder="0" /></Field>
            <Field label="Первонач. взнос"><input type="number" value={f.downPayment} onChange={set("downPayment")} placeholder="0" /></Field>
            {+f.downPayment > 0 && <PaymentDestination method={f.downPaymentMethod} card={f.downPaymentCard} onMethod={v=>setF(prev=>({...prev,downPaymentMethod:v}))} onCard={v=>setF(prev=>({...prev,downPaymentCard:v}))} cards={cards}/>}
          </div>
          <Field label="Считать процент наценки от">
            <div className="seg-toggle">
              <button
                type="button"
                className={f.markupBase === "principal" ? "on" : ""}
                onClick={() => setF((prev) => ({ ...prev, markupBase: "principal" }))}
              >
                Цена − взнос
              </button>
              <button
                type="button"
                className={f.markupBase === "full" ? "on" : ""}
                onClick={() => setF((prev) => ({ ...prev, markupBase: "full" }))}
              >
                Полная цена
              </button>
            </div>
          </Field>
          <div className="frow">
            <Field label="Наценка, %"><input type="number" value={f.markupPercent} onChange={onMarkupPercent} placeholder="20" /></Field>
            <Field label="Наценка, ₽"><input type="number" value={f.markupAmount} onChange={onMarkupAmount} placeholder="0" /></Field>
          </div>
          <div className="frow">
            <Field label="Срок, мес"><input type="number" value={f.termMonths} onChange={onTermMonths} placeholder="6" /></Field>
            <Field label="К оплате всего, ₽"><input type="number" value={f.totalPayable} onChange={onTotalPayable} onBlur={() => setF((prev) => ({ ...prev, totalPayable: String(financed) }))} placeholder="0" /></Field>
          </div>
          <Field label="Платёж в месяц, ₽">
            <input type="number" min="0" step="1" value={f.monthlyPayment} onChange={onMonthlyPayment} placeholder="0" />
            <small className="field-hint">Введите платёж вручную — общая сумма и наценка пересчитаются по сроку договора.</small>
            {markup < 0 && <small className="field-hint" role="alert">Платёж за весь срок не покрывает стоимость товара за вычетом первоначального взноса. Увеличьте платёж или срок.</small>}
          </Field>
          <Field label="Источник финансирования">
            <select value={f.investorId} onChange={set("investorId")}>
              <option value="">Общий пул (без привязки)</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>{inv.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий (необязательно)">
            <textarea value={f.comment} onChange={set("comment")} placeholder="Заметки по договору…" rows={2} />
          </Field>

          <div className="calc">
            <div><span>Наценка</span><b className="num">{money(markup)}</b></div>
            <div><span>К оплате в рассрочку</span><b className="num">{money(financed)}</b></div>
          </div>

          {comparison.length > 0 && <div className="mini-block" style={{ marginTop: 16 }}><h3>Было → Станет</h3>
            {comparison.map(([label, before, after]) => <div key={label} style={{ margin: '8px 0', overflowWrap: 'anywhere' }}><b>{label}:</b> {before || "не указано"} → {after || "не указано"}</div>)}
            <p>Фактически получено: {money(contractStats(editing).paidSum)} — сохраняется.</p>
          </div>}
          {editError && <p role="alert" style={{ color: 'var(--clay)' }}>{editError}</p>}
          {formError && <p role="alert" style={{ color: 'var(--clay)' }}>{formError}</p>}
          {isDesktopApp && <p role="status">{draftStatus}</p>}
          <div className="sheet-actions">
            <button className="btn ghost" onClick={closeForm}>{isDesktopApp ? "Закрыть и сохранить черновик" : "Отмена"}</button>
            <button className="btn primary" disabled={!valid || saving} onClick={async () => {
              if (saveInProgress.current) return;
              saveInProgress.current = true; setSaving(true); setFormError("");
              try {
              await draftWrite.current;
              if (+f.downPayment > 0 && (!editing || f.downPaymentMethod)) paymentDestination(f.downPaymentMethod,f.downPaymentCard);
              const { markupAmount: _markupAmount, totalPayable: _totalPayable, monthlyPayment: _monthlyPayment, markupBase: _markupBase, ...rest } = f;
              const success = await onSave({
                ...rest, newContractId: newContractId.current, phone: fmtPhone(f.phone.trim()), guarantorPhone: fmtPhone(f.guarantorPhone.trim()), totalPrice: +f.totalPrice, downPayment: +f.downPayment || 0,
                markup, markupPercent: +f.markupPercent || 0, termMonths: Math.max(1, +f.termMonths || 1),
              });
              if (success !== true) { setFormError("Договор не сохранён. Черновик оставлен для повторной попытки."); return; }
              draftSaved.current = true;
              if (isDesktopApp) {
                try { await localData.deleteDraft(draftId.current); }
                catch (error) { showAppMessage(`Договор сохранён, но не удалось убрать черновик: ${error.message || error}`); }
              }
              showAppMessage("Сохранено", "success"); onClose();
              } catch (error) { setFormError(error.message || String(error)); }
              finally { saveInProgress.current = false; setSaving(false); }
            }}>{saving ? "Сохраняем…" : editing ? "Сохранить изменения" : "Создать договор"}</button>
          </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

// поле даты из трёх сегментов (ДД/ММ/ГГГГ) с автопереходом — вместо капризного native <input type="date">
function DateFields({ value, onChange }) {
  const [vy, vm, vd] = value ? value.split("-") : ["", "", ""];
  const [day, setDay] = useState(vd || "");
  const [month, setMonth] = useState(vm || "");
  const [year, setYear] = useState(vy || "");

  useEffect(() => {
    const [y, m, d] = value ? value.split("-") : ["", "", ""];
    setDay(d || ""); setMonth(m || ""); setYear(y || "");
  }, [value]);

  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);

  const commit = (d, m, y) => {
    if (d.length === 2 && m.length === 2 && y.length === 4) onChange(`${y}-${m}-${d}`);
  };

  const onDay = (e) => {
    let v = e.target.value.replace(/\D/g, "");
    if (v.length === 1 && +v > 3) v = "0" + v;
    v = v.slice(0, 2);
    if (v.length === 2 && +v > 31) v = "31";
    setDay(v);
    commit(v, month, year);
    if (v.length === 2) monthRef.current?.focus();
  };

  const onMonth = (e) => {
    let v = e.target.value.replace(/\D/g, "");
    if (v.length === 1 && +v > 1) v = "0" + v;
    v = v.slice(0, 2);
    if (v.length === 2 && +v > 12) v = "12";
    setMonth(v);
    commit(day, v, year);
    if (v.length === 2) yearRef.current?.focus();
  };

  const onYear = (e) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
    setYear(v);
    commit(day, month, v);
  };

  const backspaceTo = (ref, current) => (e) => {
    if (e.key === "Backspace" && current === "") ref.current?.focus();
  };

  return (
    <div className="date-fields">
      <input className="date-segment" ref={dayRef} value={day} onChange={onDay} onFocus={(e) => e.target.select()} placeholder="ДД" inputMode="numeric" />
      <span>.</span>
      <input className="date-segment" ref={monthRef} value={month} onChange={onMonth} onKeyDown={backspaceTo(dayRef, month)}
        onFocus={(e) => e.target.select()} placeholder="ММ" inputMode="numeric" />
      <span>.</span>
      <input className="date-segment" ref={yearRef} value={year} onChange={onYear} onKeyDown={backspaceTo(monthRef, year)}
        onFocus={(e) => e.target.select()} placeholder="ГГГГ" inputMode="numeric" />
      <DateCalendar value={value} onChange={onChange}/>
    </div>
  );
}

/* --------------------------- Новый вкладчик ------------------------ */

function AddInvestorForm({ onClose, onSave, editing }) {
  const [f, setF] = useState({
    name: editing?.name || "", amount: editing ? String(editing.amount || "") : "",
    monthlyPayment: editing ? String(editing.monthlyPayment || "") : "",
    accrualStartDate: editing?.accrualStartDate || new Date().toISOString().slice(0, 10),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.name.trim() && +f.amount > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">{editing ? "Изменить вкладчика" : "Новый вкладчик"}</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <Field label="Имя вкладчика"><input value={f.name} onChange={set("name")} placeholder="Иванов Пётр" /></Field>
          <Field label="Сумма вклада"><input type="number" value={f.amount} onChange={set("amount")} placeholder="0" /></Field>
          <div className="frow">
            <Field label="Начисление в месяц">
              <input type="number" value={f.monthlyPayment} onChange={set("monthlyPayment")} placeholder="Например, 28 000" />
            </Field>
            <Field label="Дата первого начисления">
              <DateFields value={f.accrualStartDate} onChange={(value) => setF((prev) => ({ ...prev, accrualStartDate: value }))} />
            </Field>
          </div>
          <div className="form-hint">Если ежемесячных начислений нет, оставьте сумму пустой или укажите 0.</div>
          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>Отмена</button>
            <button className="btn primary" disabled={!valid} onClick={() => onSave({
              name: f.name.trim(), amount: +f.amount, monthlyPayment: +f.monthlyPayment || 0,
              accrualStartDate: +f.monthlyPayment > 0 ? f.accrualStartDate : "",
            })}>
              {editing ? "Сохранить" : "Добавить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Новый вывод средств --------------------- */

function AddWithdrawalForm({ investors, onClose, onSave }) {
  const [f, setF] = useState({
    amount: "", date: new Date().toISOString().slice(0, 10),
    investorId: "", purpose: "owner", note: "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = +f.amount > 0 && f.date;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">Новый вывод средств</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <div className="frow">
            <Field label="Сумма"><input type="number" value={f.amount} onChange={set("amount")} placeholder="0" /></Field>
            <Field label="Дата">
              <DateFields value={f.date} onChange={(v) => setF((prev) => ({ ...prev, date: v }))} />
            </Field>
          </div>
          <Field label="С кем рассчитываемся">
            <select value={f.investorId} onChange={set("investorId")}>
              <option value="">Общий пул / собственные средства</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>{inv.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Назначение вывода">
            <select value={f.purpose} onChange={set("purpose")}>
              {Object.entries(WITHDRAWAL_PURPOSES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий (необязательно)">
            <input value={f.note} onChange={set("note")} placeholder="Например, модель телефона для закупки" />
          </Field>

          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>Отмена</button>
            <button className="btn primary" disabled={!valid} onClick={() => onSave({
              amount: +f.amount, date: f.date, investorId: f.investorId, purpose: f.purpose, note: f.note.trim(),
            })}>Вывести</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Импорт из Excel ------------------------ */

function ImportModal({ investors, contracts, onClose, onImport, draft }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(draft?.data?.result || null);
  const [pending, setPending] = useState(draft?.data?.pending || null);
  const draftId = useRef(draft?.id || `import-${Date.now()}`);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const { newInvestors, newContracts, paymentUpdates, errors } = await parseImportWorkbook(file, investors, contracts);
      const nextPending = { newInvestors, newContracts, paymentUpdates };
      const nextResult = { investors: newInvestors.length, contracts: newContracts.length, payments: paymentUpdates.length, errors, fileName: file.name };
      setPending(nextPending);
      setResult(nextResult);
      if (isDesktopApp) await localData.saveDraft({ id: draftId.current, draftType: "Импорт Excel", title: file.name, data: { pending: nextPending, result: nextResult }, completion: 100 });
    } catch (err) {
      setResult({ investors: 0, contracts: 0, payments: 0, errors: [`Не удалось прочитать файл: ${err.message || err}`] });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">Импорт из Excel</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <p className="import-hint">
            Скачайте шаблон, заполните вкладки «Вкладчики», «Договоры» и, если нужно, «Платежи»
            (для отметки уже оплаченных платежей), затем загрузите файл обратно.
            Новые записи добавятся к уже существующим на сайте.
          </p>
          <div className="import-actions">
            <a className="btn ghost" href={`${import.meta.env.BASE_URL}rassrochki_template.xlsx`} download>
              <Download size={16} /> Скачать шаблон
            </a>
            <label className="btn primary" htmlFor="import-file-input">
              <Upload size={16} /> {busy ? "Загрузка…" : "Выбрать файл .xlsx"}
              <input
                id="import-file-input"
                type="file"
                accept=".xlsx,.xls"
                className="hidden-file-input"
                disabled={busy}
                onChange={handleFile}
              />
            </label>
          </div>

          {result && (
            <div className="import-result">
              <div className="import-result-row">
                <CheckCircle2 size={15} className="ok" />
                Найдено вкладчиков: {result.investors}, договоров: {result.contracts}, платежей: {result.payments}
              </div>
              {result.errors.length > 0 && (
                <div className="mini-block">
                  <div className="mini-hd clay">Замечания ({result.errors.length})</div>
                  {result.errors.map((err, i) => (
                    <div key={i} className="mini-row import-error">{err}</div>
                  ))}
                </div>
              )}
              {pending && <div className="sheet-actions import-confirm-actions">
                <button className="btn ghost" onClick={onClose}>Сохранить в черновиках</button>
                <button className="btn primary" onClick={async () => {
                  setBusy(true);
                  try {
                    const success = await onImport(pending.newInvestors, pending.newContracts, pending.paymentUpdates);
                    if (success !== true) return;
                    if (isDesktopApp) await localData.deleteDraft(draftId.current);
                    setPending(null); onClose();
                    showAppMessage("Импорт сохранён", "success");
                  } catch (error) { showAppMessage(`Импорт не завершён: ${error.message || error}. Черновик сохранён.`); }
                  finally { setBusy(false); }
                }} disabled={busy}>Применить импорт</button>
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Стили                                                              */
/* ------------------------------------------------------------------ */

const css = `
.app{
  --paper:#EEF1EB; --surface:#FBFCF9; --surface-2:#F1F4EE; --ink:#16332E; --ink-soft:#4E5C57;
  --line:#DCE1D7; --brass:#8C6A2E; --emerald:#1E7A54; --clay:#B4463A; --amber:#B4801F;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  color:var(--ink); background:var(--paper); min-height:100%;
  -webkit-font-smoothing:antialiased;
}
.app *{box-sizing:border-box}
.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.build-info{padding:8px 20px 14px;text-align:center;color:var(--ink-soft);font-size:10px;opacity:.75}
.strong{font-weight:600}
.muted{color:var(--ink-soft);font-size:12px}
.loading{padding:60px;text-align:center;color:var(--ink-soft)}
.retry-btn{margin-top:14px}
.app-toast{position:fixed;z-index:120;right:18px;bottom:18px;display:flex;align-items:center;gap:10px;max-width:440px;border:1px solid #F0CAC4;border-radius:10px;background:#FBEEEC;color:var(--clay);padding:11px 13px;font:inherit;font-size:12px;text-align:left;box-shadow:0 12px 36px rgba(22,51,46,.18);cursor:pointer}

.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:32px 28px;
  width:100%;max-width:360px;box-shadow:0 24px 60px rgba(18,32,28,.12)}
.login-mark{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;margin-bottom:14px;
  background:linear-gradient(135deg,var(--brass),#B0873C);color:#fff}
.login-title{font-weight:700;font-size:19px;letter-spacing:.02em}
.login-sub{color:var(--ink-soft);font-size:13px;margin:2px 0 20px}
.login-error{background:#FBEEEC;color:var(--clay);border:1px solid #F0CAC4;border-radius:9px;
  padding:9px 12px;font-size:12.5px;margin-bottom:14px}
.login-btn{width:100%;justify-content:center;margin-top:4px}

.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  padding:16px 20px;background:var(--ink);color:#EFF3EC}
.brand{display:flex;align-items:center;gap:11px}
.hd-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--brass),#B0873C);color:#fff}
.bname{font-weight:700;font-size:16px;letter-spacing:.02em}
.btag{font-size:11px;color:#9FB0A6;letter-spacing:.03em}

.tabs{display:flex;gap:4px;padding:10px 20px 0;background:var(--ink)}
.tabs button{display:flex;align-items:center;gap:7px;border:none;cursor:pointer;
  background:transparent;color:#9FB0A6;font:inherit;font-size:13px;font-weight:600;
  padding:9px 14px;border-radius:9px 9px 0 0}
.tabs button.on{background:var(--paper);color:var(--ink)}
.tabs .cnt{background:var(--line);color:var(--ink-soft);font-size:11px;padding:1px 7px;border-radius:20px}
.tabs button.on .cnt{background:var(--brass);color:#fff}

.storage-warn-wrap{max-width:820px;margin:14px auto 0;padding:0 18px}
.storage-warn{display:flex;align-items:center;gap:10px;padding:11px 16px;
  background:#FBEEEC;color:var(--clay);border:1px solid #F0CAC4;border-radius:11px;font-size:12.5px;line-height:1.5}
.storage-warn svg{flex-shrink:0}
.storage-warn-detail{display:block;margin-top:3px;font-size:11.5px;opacity:.85;font-family:'IBM Plex Mono',monospace}

.wrap{max-width:820px;margin:0 auto;padding:22px 18px 60px}

.hero{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin-bottom:16px}
.hero-btn{display:block;width:100%;border:1px solid var(--line);cursor:pointer;font:inherit;color:inherit;
  text-align:left;transition:border-color .15s}
.hero-btn:hover{border-color:var(--brass)}
.hero-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);font-weight:600}
.hero-num{font-size:40px;font-weight:600;margin:4px 0 16px}
.ribbon{display:flex;height:10px;border-radius:20px;overflow:hidden;background:var(--line)}
.seg{display:block;height:100%}
.s-paid{background:var(--emerald)} .s-over{background:var(--clay)} .s-rem{background:#C7CEBF}
.hero-legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:12.5px;color:var(--ink-soft)}
.dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:14px 16px}
.stat-ic{color:var(--brass);margin-bottom:8px}
.stat-label{font-size:12px;color:var(--ink-soft);margin-bottom:3px}
.stat-val{font-size:22px;font-weight:600}
.stat-val.clay{color:var(--clay)}
.stat-btn{cursor:pointer;text-align:left;font:inherit;color:inherit;width:100%;transition:border-color .15s}
.stat-btn:hover{border-color:var(--brass)}

/* Dark canvas around the dashboard cards. */
.app:has(.dashboard-wrap){background:#0f172a;min-height:100vh}
.app:has(.dashboard-wrap) .hd,.app:has(.dashboard-wrap) .tabs{background:#11192c}
.app:has(.dashboard-wrap) .tabs button.on{background:#0f172a;color:#c4b5fd}
.app:has(.dashboard-wrap) .build-info{color:#9baac0}
body:has(.dashboard-wrap){background:#0f172a}

/* Dashboard metric cards, styled after the compact mobile reference. */
.dashboard-wrap .hero{background:linear-gradient(135deg,#243144,#182231);border-color:#354155;color:#f7f9ff;border-radius:22px;box-shadow:inset 0 1px 0 #ffffff0a}
.dashboard-wrap .hero-label{color:#a993f5}
.dashboard-wrap .hero-num{font-family:inherit;font-variant-numeric:tabular-nums;font-size:clamp(26px,5vw,40px);letter-spacing:-.035em}
.dashboard-wrap .hero-legend{color:#b3bfd0}
.dashboard-wrap .s-paid{background:#00c99a}.dashboard-wrap .s-over{background:#ff616e}.dashboard-wrap .s-rem{background:#536179}
.dashboard-wrap .cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.dashboard-wrap .stat{--metric-accent:#00c99a;--metric-tint:#00c99a16;position:relative;isolation:isolate;overflow:hidden;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;min-height:160px;padding:17px 16px;background:linear-gradient(135deg,#243144,#182231);border:1px solid #354155;border-radius:20px;box-shadow:inset 0 1px 0 #ffffff0a;color:#f7f9ff;transition:border-color .15s,transform .15s}
.dashboard-wrap .stat:nth-child(2){--metric-accent:#4c9aff;--metric-tint:#3866ff20}
.dashboard-wrap .stat:nth-child(3){--metric-accent:#a78bfa;--metric-tint:#8649ee20}
.dashboard-wrap .stat:nth-child(5){--metric-accent:#ffbd00;--metric-tint:#ff8a0019}
.dashboard-wrap .stat:nth-child(6){--metric-accent:#ff616e;--metric-tint:#ff425b1c}
.dashboard-wrap .stat::before{content:"";position:absolute;z-index:-1;right:-22px;top:-25px;width:112px;height:112px;border-radius:50%;background:var(--metric-tint);opacity:.5}
.dashboard-wrap .stat-btn::after{content:"";position:absolute;right:20px;top:24px;width:8px;height:8px;border-top:2px solid #64748b;border-right:2px solid #64748b;transform:rotate(45deg)}
.dashboard-wrap .stat-ic{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:42px;height:42px;border-radius:14px;margin:0 0 18px;background:var(--metric-tint);color:var(--metric-accent)}
.dashboard-wrap .stat-ic svg{width:22px;height:22px;stroke-width:2.2}
.dashboard-wrap .stat-label{margin:0 0 5px;color:#9baac0;font-size:10px;font-weight:700;line-height:1.35;text-transform:uppercase;letter-spacing:.025em}
.dashboard-wrap .stat-val{max-width:100%;font-family:inherit;font-variant-numeric:tabular-nums;font-size:clamp(17px,2.7vw,25px);font-weight:700;line-height:1.2;letter-spacing:-.045em;white-space:nowrap}
.dashboard-wrap .stat-val.clay{color:#ff616e}
.dashboard-wrap .stat-btn:hover{border-color:var(--metric-accent);transform:translateY(-2px)}
.dashboard-wrap .stat-btn:focus-visible,.dashboard-wrap .hero-btn:focus-visible{outline:3px solid #a78bfa;outline-offset:3px}
@media(max-width:560px){
  .dashboard-wrap .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .dashboard-wrap .stat{min-height:150px;padding:15px 13px;border-radius:19px}
  .dashboard-wrap .stat-val{font-size:clamp(16px,4.6vw,25px)}
  .dashboard-wrap .hero{padding:20px}
  .dashboard-wrap .hero-legend{gap:10px;font-size:11px}
}

.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.panel-hd{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line);
  font-weight:600;font-size:13.5px;color:var(--brass)}
.panel-hd-row{justify-content:space-between}
.panel-hd-title{display:flex;align-items:center;gap:8px}
.empty{padding:26px 18px;text-align:center;color:var(--ink-soft);font-size:13px}
.rows{display:flex;flex-direction:column}
.prow{display:grid;grid-template-columns:1fr auto auto auto auto;align-items:center;gap:14px;
  padding:12px 18px;border:none;border-bottom:1px solid var(--line);background:transparent;
  cursor:pointer;font:inherit;text-align:left;width:100%}
.wa-row-btn{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;
  color:#1E7A54;border:1px solid var(--line);background:var(--surface)}
.wa-row-btn:hover{border-color:var(--emerald);background:#E1F0E7}
.wa-row-btn.notified{color:#fff;border-color:var(--emerald);background:var(--emerald)}
.icon-btn.wa-green{color:#7BE0A8}
.icon-btn.wa-green.notified{color:#fff;background:var(--emerald);border-color:var(--emerald)}
.prow:last-child{border-bottom:none}
.prow:hover{background:#F3F5EF}
.prow-name-block{display:flex;flex-direction:column;gap:1px}
.prow-name{font-weight:500;font-size:14px}
.prow-phone{font-size:11.5px}
.prow-date{font-size:12.5px;color:var(--ink-soft)}
.prow-sum{font-size:14px;font-weight:600}
.upcoming-toggle{margin-left:auto}

.badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap}
.b-emerald{background:#E1F0E7;color:var(--emerald)}
.b-clay{background:#F7E3E0;color:var(--clay)}
.b-amber{background:#F6ECD6;color:#8A6111}
.b-line{background:#EBEEE5;color:var(--ink-soft)}
.b-brass{background:#F1E7D6;color:var(--brass)}

.clist-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}
.search-box{display:flex;align-items:center;gap:8px;flex:1;min-width:220px;background:var(--surface);
  border:1px solid var(--line);border-radius:9px;padding:8px 12px;color:var(--ink-soft)}
.search-box input{flex:1;border:none;background:transparent;font:inherit;font-size:14px;color:var(--ink)}
.search-box input:focus{outline:none}
.search-clear{background:transparent;border:none;color:var(--ink-soft);cursor:pointer;display:grid;place-items:center}
.search-clear:hover{color:var(--clay)}
.toolbar-select{border:1px solid var(--line);background:var(--surface);border-radius:9px;
  padding:8px 10px;font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer}
.toolbar-select:focus{outline:none;border-color:var(--brass)}
.toolbar-filter-label{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:0 5px 0 9px;color:var(--ink-soft);font-size:11.5px;font-weight:600}.toolbar-filter-label.active{border-color:var(--brass);background:#FBF7EF;color:var(--brass)}.toolbar-filter-label select{border:0;background:transparent;padding:8px 5px;color:var(--ink);font:inherit;font-size:12px;outline:none}
.filter-chips{display:flex;gap:6px;flex-wrap:wrap}
.filter-chips button{border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);cursor:pointer;
  font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:20px;white-space:nowrap}
.filter-chips button.on{background:var(--brass);color:#fff;border-color:var(--brass)}
.filter-count{display:inline-grid;min-width:18px;height:18px;margin-left:4px;padding:0 4px;place-items:center;border-radius:10px;
  background:var(--surface-2);color:var(--ink-soft);font-size:10.5px;font-variant-numeric:tabular-nums}
.filter-chips button.on .filter-count{background:rgba(255,255,255,.2);color:#fff}
.export-filtered{white-space:nowrap}
.filtered-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 14px;padding:10px 12px;
  border:1px solid var(--line);border-radius:11px;background:var(--surface);font-size:11.5px;color:var(--ink-soft)}
.filtered-summary>b{margin-right:3px;color:var(--ink);font-size:12px}.filtered-summary span{padding:4px 7px;border-radius:7px;background:var(--surface-2)}
.filtered-summary strong{margin-left:3px;color:var(--ink);font-size:12px}.filtered-summary .filtered-summary-overdue{background:#FBEEEC;color:var(--clay)}
.filtered-summary .filtered-summary-overdue strong{color:var(--clay)}
.filtered-summary .filtered-summary-profit{background:#EAF3ED;color:var(--emerald)}.filtered-summary .filtered-summary-profit strong{color:var(--emerald)}

.clist{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;align-items:start}
.cgroup{grid-column:1/-1;border:1px solid var(--line);border-radius:14px;background:#F3F5EF;padding:12px}
.cgroup-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;
  padding:2px 4px 12px}
.cgroup-name{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:15px}
.cgroup-stats{font-size:12.5px;color:var(--ink-soft)}
.cgroup-stats b{color:var(--ink)}
.cgroup-overdue{color:var(--clay);font-weight:600}
.cgroup-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;align-items:start}

.monthly-panel{margin-bottom:16px}
.daily-panel{margin-bottom:16px}.daily-panel-hd{justify-content:space-between;color:var(--brass);flex-wrap:wrap;gap:12px}
.daily-panel .cnt{display:inline-grid;min-width:20px;height:20px;padding:0 6px;place-items:center;border-radius:10px;
  background:var(--surface-2);color:var(--ink-soft);font-size:10.5px}
.daily-date-controls{display:flex;align-items:flex-end;flex-wrap:wrap;gap:8px}.daily-date-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px}.daily-date-controls input,.daily-date-controls select{border:1px solid var(--line);border-radius:8px;
  background:var(--surface);padding:7px 9px;font:inherit;font-size:12.5px;color:var(--ink)}
.daily-totals{margin:14px 18px}.daily-payment-list{margin:0 18px 16px}.daily-empty{padding-top:12px}
.daily-total-debt strong{color:var(--ink)}.daily-overdue-debt,.daily-overdue-debt strong{color:var(--clay)}
.monthly-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.monthly-col{padding:14px 18px}
.monthly-col + .monthly-col{border-left:1px solid var(--line)}
.month-row{display:grid;grid-template-columns:64px 1fr auto auto;align-items:center;gap:10px;padding:5px 0}
.month-label{font-size:12px;color:var(--ink-soft);white-space:nowrap}
.month-bar{display:block;height:8px;border-radius:6px;background:var(--line);overflow:hidden;min-width:40px}
.month-bar-fill{display:block;height:100%;border-radius:6px}
.fill-received{background:var(--emerald)}
.fill-expected{background:var(--brass)}
.month-val{font-size:12.5px;font-weight:600;white-space:nowrap}
.month-profit{font-size:11.5px;color:var(--ink-soft);white-space:nowrap}
.monthly-note{padding:0 18px 12px;font-size:11.5px;color:var(--ink-soft)}
.citem{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  transition:border-color .15s}
.citem:hover{border-color:var(--brass)}
.citem-status-row{display:block;width:100%;border:none;background:transparent;cursor:pointer;font:inherit;text-align:left;padding:20px}
.citem-status-row:hover{background:#F3F5EF}
.citem-name-block{display:flex;flex-direction:column;gap:10px;min-width:0;width:100%}
.citem-heading{display:flex;align-items:center;gap:10px;min-width:0}
.citem-heading>.chev{flex:0 0 auto}
.citem-name{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;line-height:20px}
.citem-phone{display:none;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:18px;color:var(--ink-soft);text-decoration:none;overflow-wrap:anywhere}
.citem-phone.shown{display:flex}.citem-phone svg{flex:0 0 auto}
.citem-phone[href]{width:fit-content;max-width:100%;cursor:pointer}.citem-phone[href]:hover{color:var(--emerald);text-decoration:underline}
.citem-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.citem-investor{flex:1;min-width:70px;overflow:hidden;font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.citem-meta>.badge{flex-shrink:0}
.citem-next-payment{display:none;align-items:center;flex-wrap:wrap;gap:5px;font-size:12px;line-height:18px;color:var(--ink-soft);width:100%}
.citem-next-payment.shown{display:flex}.citem-next-payment b{color:var(--ink);font-size:12px}.citem-next-payment.closed{color:var(--emerald);font-weight:600}
.citem-overdue-summary{display:flex;flex-direction:column;gap:6px;width:100%;padding:10px 12px;border:1px solid #F0CAC4;border-radius:10px;background:#FBEEEC;color:var(--clay)}
.citem-overdue-main{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px;min-width:0}
.citem-overdue-main>span{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;white-space:nowrap}
.citem-overdue-main b{font-size:13px;white-space:nowrap}.citem-overdue-meta{font-size:11px;line-height:17px;color:#8F4941}
.citem-notification-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;min-width:0}
.citem-notified{display:flex;align-items:flex-start;gap:5px;min-width:0;font-size:11px;line-height:17px;color:var(--emerald)}
.citem-notified>svg{flex:0 0 auto;margin-top:2px}.citem-notified>span{min-width:0;overflow-wrap:anywhere}.citem-notified.pending{color:var(--ink-soft)}
.citem-deferral{display:none;align-items:flex-start;gap:5px;width:100%;font-size:11px;line-height:17px;color:var(--brass);overflow-wrap:anywhere}.citem-deferral.shown{display:flex}.citem-deferral>svg{flex:0 0 auto;margin-top:2px}
.citem-comment{display:flex;align-items:flex-start;gap:6px;width:100%;padding:8px 10px;border-radius:8px;background:var(--surface-2);color:var(--ink-soft);font-size:11px;line-height:17px}.citem-comment>svg{flex:0 0 auto;margin-top:2px;color:var(--brass)}.citem-comment>span{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.citem-amount{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 8px;margin-top:4px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;line-height:20px;color:var(--ink-soft)}
.citem-amount b{color:var(--ink);font-size:14px;white-space:nowrap}
.citem-card-wa{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;border:1px solid #BBD5C5;border-radius:8px;background:#EAF3ED;color:var(--emerald);padding:0;cursor:pointer}
.citem-card-wa:hover{border-color:var(--emerald);background:#DCEDE3}.citem-card-wa.notified{background:var(--emerald);border-color:var(--emerald);color:#fff}
@media(pointer:coarse){.citem-card-wa{width:44px;height:44px}}
.chev{color:var(--ink-soft);transition:transform .15s}
.chev.on{transform:rotate(180deg)}
.citem-expand{padding:0 16px 16px;border-top:1px solid var(--line)}
.card-comment{margin:12px 0;padding:10px;border-radius:8px;background:var(--surface-2)}
.card-comment p{margin:6px 0 0;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.card-contacts{margin-bottom:12px}.card-contacts .contact-history-hd{padding:10px}
.card-contacts .contact-entry{padding:10px;min-width:0;overflow-wrap:anywhere}
.card-contacts .contact-entry-hd{display:flex;flex-wrap:wrap;gap:4px 8px}
.mini-block{margin-top:12px}
.mini-hd{font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;color:var(--ink-soft);margin-bottom:6px}
.mini-hd.clay{color:var(--clay)}
.mini-hd.emerald{color:var(--emerald)}
.mini-hd.brass{color:var(--brass)}
.citem-deferral-row>span:first-child{display:flex;flex-direction:column;gap:2px}
.citem-deferral-row small{font-size:10.5px;color:var(--ink-soft)}
.mini-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px dashed var(--line)}
.mini-row:last-child{border-bottom:none}
.citem-contract-date{margin-top:12px;color:var(--ink-soft)}
.citem-contract-date .num{color:var(--ink);font-weight:600}
.citem-open-row{padding:0 20px 18px}.citem-open{width:100%;justify-content:center;white-space:normal}

.overlay{position:fixed;inset:0;background:rgba(18,32,28,.42);display:flex;justify-content:center;
  align-items:flex-start;padding:24px 14px;z-index:50;overflow-y:auto;backdrop-filter:blur(2px)}
.sheet{background:var(--paper);border-radius:18px;width:100%;max-width:540px;overflow:hidden;
  box-shadow:0 24px 60px rgba(18,32,28,.28);animation:pop .18s ease}
@keyframes pop{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
.sheet-hd{display:flex;align-items:center;gap:12px;padding:16px 18px;background:var(--ink);color:#EFF3EC}
.sheet-hd>div{flex:1}
.sheet-name{font-weight:600;font-size:16px}
.sheet-phone{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#9FB0A6;text-decoration:none}
.icon-btn{background:rgba(255,255,255,.1);border:none;color:#EFF3EC;width:32px;height:32px;
  border-radius:8px;display:grid;place-items:center;cursor:pointer}
.icon-btn:hover{background:rgba(255,255,255,.2)}
.sheet-body{padding:18px}

.det-item{font-size:14px;color:var(--ink-soft);margin-bottom:14px}
.det-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
.det-grid>div{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.det-grid span{display:block;font-size:11px;color:var(--ink-soft);margin-bottom:2px}
.det-grid b{font-size:15px;font-weight:600}

.ledger-hd{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--brass);
  font-weight:600;margin-bottom:8px}
.ledger-hd-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.ledger-hd-inline{margin-bottom:0}
.ledger{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.lrow{display:grid;grid-template-columns:26px 1fr auto auto auto;align-items:center;gap:12px;
  padding:11px 14px;border-bottom:1px solid var(--line)}
.lrow:last-child{border-bottom:none}
.lrow.overdue{background:#FBEEEC}
.lrow.paid{background:#F1F6F1}
.lrow.partial{background:#FBF4E4}
.partial-note{grid-column:1/-1;font-size:12px;color:#8A6111;margin-top:2px}
.payment-comments{grid-column:1/-1;display:flex;flex-direction:column;gap:4px;margin-top:3px}.payment-comments>span{display:flex;align-items:flex-start;gap:5px;padding:6px 8px;border-radius:7px;background:var(--surface-2);color:var(--ink-soft);font-size:11px;line-height:1.4}.payment-comments svg{flex:0 0 auto;margin-top:1px;color:var(--brass)}
.notification-note{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11.5px;
  color:var(--emerald);margin-top:2px}
.notification-undo{display:inline-flex;align-items:center;gap:4px;margin-left:6px;border:0;background:transparent;
  color:var(--clay);font:inherit;font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px;border-radius:5px}
.notification-undo:hover{background:#FBEEEC}
.deferral-history{grid-column:1/-1;margin-top:2px}.deferral-note{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--brass)}
.deferral-steps{display:flex;flex-direction:column;gap:2px;margin:5px 0 0 19px}.deferral-steps span{font-size:10.5px;color:var(--ink-soft)}
.lnum{color:var(--ink-soft);font-size:12px}
.ldate{font-size:13px}
.lsum{font-size:14px;font-weight:600}
.lbtn{display:inline-flex;align-items:center;gap:5px;border:none;cursor:pointer;font:inherit;
  font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px}
.lbtn.pay{background:var(--emerald);color:#fff}
.lbtn.undo{background:transparent;color:var(--ink-soft);border:1px solid var(--line)}
.lbtn.defer{background:#F1E7D6;color:var(--brass);border:1px solid #E4D2B4;padding:6px 8px}
.lbtn.pay:hover{filter:brightness(1.06)}
.lbtn-group{display:flex;gap:6px}
.lbtn.edit-date{padding:6px 8px}
.defer-inline{grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;padding:10px;
  border:1px solid #E4D2B4;border-radius:9px;background:#FBF7EF}
.defer-inline label>span{display:block;margin-bottom:4px;font-size:10.5px;color:var(--ink-soft)}
.defer-reason{flex:1;min-width:170px}.defer-reason input{box-sizing:border-box;width:100%;border:1px solid var(--line);
  border-radius:8px;background:var(--surface);padding:8px 10px;font:inherit;font-size:12.5px;color:var(--ink)}

.hidden-file-input{display:none}
.receipt-row{grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:2px}
.receipt-btn{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--ink-soft);
  border:1px dashed var(--line);padding:5px 10px;border-radius:8px;cursor:pointer;background:transparent}
.receipt-btn:hover{border-color:var(--brass);color:var(--brass)}
.receipt-link{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--emerald);
  text-decoration:none;border:1px solid var(--line);padding:5px 10px;border-radius:8px;background:var(--surface);
  cursor:pointer;font-family:inherit}
.receipt-link:hover{border-color:var(--emerald)}
.receipt-remove{background:transparent;border:none;color:var(--ink-soft);cursor:pointer;display:grid;place-items:center;
  width:22px;height:22px;border-radius:6px}
.receipt-remove:hover{color:var(--clay)}

.field{display:block;margin-bottom:12px}
.field>span{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:5px;font-weight:500}
.field input, .field select, .field textarea{width:100%;border:1px solid var(--line);background:var(--surface);border-radius:9px;
  padding:10px 12px;font:inherit;font-size:14px;color:var(--ink);resize:vertical}
.field input:focus, .field select:focus, .field textarea:focus{outline:none;border-color:var(--brass);box-shadow:0 0 0 3px rgba(140,106,46,.12)}
.field input[readonly]{background:var(--surface-2);color:var(--ink-soft);cursor:default}.field-hint{display:block;margin-top:5px;color:var(--ink-soft);font-size:10.5px;line-height:1.4}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.seg-toggle{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.seg-toggle button{border:none;background:var(--surface);color:var(--ink-soft);cursor:pointer;font:inherit;
  font-size:13px;font-weight:600;padding:9px 12px}
.seg-toggle button + button{border-left:1px solid var(--line)}
.seg-toggle button.on{background:var(--brass);color:#fff}

.date-fields{position:relative;display:flex;align-items:center;gap:2px;width:100%;border:1px solid var(--line);
  background:var(--surface);border-radius:9px;padding:10px 12px}
.date-fields:focus-within{border-color:var(--brass);box-shadow:0 0 0 3px rgba(140,106,46,.12)}
.date-fields .date-segment{border:none;background:transparent;font:inherit;font-size:14px;color:var(--ink);
  text-align:center;padding:0;outline:none}
.date-fields .date-segment:nth-of-type(1){width:1.7em}
.date-fields .date-segment:nth-of-type(2){width:1.7em}
.date-fields .date-segment:nth-of-type(3){width:2.8em}
.date-fields span{color:var(--ink-soft)}
.date-picker-button{display:grid;place-items:center;margin-left:auto;padding:1px;border:0;background:transparent;color:var(--brass);cursor:pointer}
.date-picker-button.date-picker-value{display:flex;align-items:center;justify-content:center;gap:8px;margin:0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:12.5px;white-space:nowrap;min-height:34px}.date-calendar button:disabled{opacity:.35;cursor:default;background:transparent}
.date-picker-button:hover{color:var(--emerald)}
.date-calendar{position:fixed;z-index:10000;box-sizing:border-box;padding:12px;background:#fafbf7;color:#173c34;border:1px solid #d9dfd3;border-radius:16px;box-shadow:0 12px 40px #173c3433;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:calc(100vh - 16px);overflow:auto}
.date-calendar button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;border-radius:8px}
.date-calendar button:hover{background:#e9eee5}
.date-calendar button:focus-visible{outline:2px solid #8c6a2e;outline-offset:1px}
.date-calendar-head{display:flex;align-items:center;gap:3px;margin-bottom:10px}
.date-calendar-head strong{flex:1;text-align:center;text-transform:capitalize}
.date-calendar-head button{display:grid;place-items:center;padding:5px}
.date-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.date-calendar-grid span{padding:5px 0;color:#6b766e;font-size:12px}
.date-calendar-grid button{height:32px;font-variant-numeric:tabular-nums}
.date-calendar-grid .other-month{color:#9ca59b}
.date-calendar-grid button[aria-current="date"]{box-shadow:inset 0 0 0 1px #8c6a2e}
.date-calendar-grid button[aria-pressed="true"]{background:#197d5b;color:white}
.date-calendar .date-calendar-today{display:block;width:100%;padding:8px;margin-top:8px;color:#197d5b;font-weight:600}
.deferral-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}

.det-edit-btn{margin-bottom:16px}
.det-actions-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.section-total{display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:var(--ink);color:#EFF3EC;border-radius:11px;padding:12px 16px;margin-bottom:14px;font-size:13px}
.section-total b{font-size:18px;font-weight:600}
.guarantor-toggle{margin-bottom:12px}
.duplicate-client-hint{display:flex;align-items:flex-start;gap:7px;margin:-2px 0 12px;padding:9px 11px;border:1px solid #E4D2B4;border-radius:9px;background:#FBF7EF;color:var(--brass);font-size:11.5px;line-height:1.4}
.comment-block{margin-bottom:18px}
.comment-field{margin-bottom:8px}
.comment-save{width:100%;justify-content:center}
.contact-history{margin-bottom:20px;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
.contact-history-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px}
.contact-history-hd>div{display:flex;flex-direction:column;gap:2px}.contact-history-hd b{font-size:13px;color:var(--ink)}
.contact-history-hd span{font-size:10.5px;color:var(--ink-soft)}
.contact-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:14px;border-top:1px solid var(--line);background:var(--surface-2)}
.contact-form label{display:flex;flex-direction:column;gap:5px}.contact-form label>span{font-size:10.5px;color:var(--ink-soft)}
.contact-form input,.contact-form select,.contact-form textarea{box-sizing:border-box;width:100%;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px;color:var(--ink);font:inherit;font-size:12px}
.contact-form textarea{resize:vertical}.contact-note{grid-column:1/-1}.contact-submit{grid-column:1/-1;justify-content:center}
.contact-list{border-top:1px solid var(--line)}.contact-entry{padding:11px 14px}.contact-entry+.contact-entry{border-top:1px solid var(--line)}
.contact-entry-hd{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px}.contact-entry-hd b{font-size:12px;color:var(--emerald)}
.contact-entry-hd time{font-size:10.5px;color:var(--ink-soft)}.contact-entry p{margin:6px 0 0;font-size:12px;line-height:1.45;white-space:pre-wrap}
.contact-contract-label{display:block;margin-top:4px;color:var(--brass);font-size:10.5px}
.contact-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.contact-meta span{padding:4px 7px;border-radius:7px;background:var(--surface-2);font-size:10.5px;color:var(--ink-soft)}

.pay-inline{grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
.pay-amount{width:110px;border:1px solid var(--line);background:var(--surface);border-radius:8px;
  padding:6px 8px;font:inherit;font-size:12.5px;color:var(--ink)}
.pay-comment{flex:1;min-width:210px;border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:6px 8px;font:inherit;font-size:12.5px;color:var(--ink)}
.pay-amount:focus,.pay-comment:focus{outline:none;border-color:var(--brass)}
.pay-inline .date-fields{width:auto;padding:6px 8px}
.pay-inline .date-fields input{font-size:12.5px}
.payment-allocation-note{flex-basis:100%;color:var(--brass);font-size:10.5px}

.calc{display:flex;gap:12px;margin:6px 0 18px}
.calc>div{flex:1;background:var(--ink);color:#EFF3EC;border-radius:11px;padding:12px 14px}
.calc span{display:block;font-size:11px;color:#9FB0A6;margin-bottom:3px}
.calc b{font-size:19px;font-weight:600}

.sheet-actions{display:flex;justify-content:flex-end;gap:10px}
.btn{display:inline-flex;align-items:center;gap:7px;border:none;cursor:pointer;font:inherit;
  font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:10px}
.btn.primary{background:var(--brass);color:#fff}
.btn.primary:hover{filter:brightness(1.06)}
.btn.primary:disabled{opacity:.45;cursor:not-allowed;filter:none}
.btn.danger{background:var(--clay);color:#fff}
.btn.danger:disabled{opacity:.4;cursor:not-allowed}
.btn.ghost{background:transparent;color:var(--ink-soft);border:1px solid var(--line)}
.btn.on-dark{background:rgba(255,255,255,.12);color:#EFF3EC;border:1px solid rgba(255,255,255,.18)}
.btn.on-dark:hover{background:rgba(255,255,255,.2)}
.btn-sm{padding:6px 12px;font-size:12.5px}

.import-hint{font-size:13px;color:var(--ink-soft);line-height:1.5;margin:0 0 14px}
.import-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.import-result{margin-top:4px}
.import-result-row{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600}
.import-result-row .ok{color:var(--emerald)}
.import-error{color:var(--clay)}

.icon-btn-ghost{background:transparent;border:1px solid var(--line);color:var(--ink-soft);
  width:30px;height:30px;border-radius:8px;display:grid;place-items:center;cursor:pointer}
.icon-btn-ghost:hover{border-color:var(--clay);color:var(--clay)}

.inv-list-hd{margin-bottom:6px}
.inv-grid{grid-template-columns:repeat(2,1fr)}
.inv-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:15px 16px;margin-bottom:10px}
.inv-card:last-child{margin-bottom:0}
.citem-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.inv-card-actions{display:flex;gap:6px}.form-hint{margin:-4px 0 16px;font-size:11.5px;color:var(--ink-soft)}
.investor-accrual{margin-top:12px;padding:13px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line)}
.investor-accrual-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.investor-accrual-hd b{font-size:13px}.investor-accrual-hd span{font-size:11.5px;color:var(--ink-soft)}
.investor-accrual-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}.investor-accrual-grid>div{background:var(--surface);border-radius:8px;padding:8px 10px}.investor-accrual-grid span{display:block;font-size:10.5px;color:var(--ink-soft);margin-bottom:2px}.investor-accrual-grid b{font-size:13px}
.unassigned-note{margin-top:4px;font-size:12.5px}

.wd-list-hd{margin-top:18px}
.wd-row{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:14px;
  padding:12px 18px;border-bottom:1px solid var(--line)}
.wd-row:last-child{border-bottom:none}
.wd-date{font-size:12.5px;color:var(--ink-soft);white-space:nowrap}
.wd-investor{font-size:12.5px;white-space:nowrap}
.wd-sum{font-size:14px}

.nested-overlay{z-index:120}
.confirm-card{width:min(440px,calc(100vw - 32px));background:var(--surface);border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
.confirm-card h3{margin:0 0 8px;font-size:19px}.confirm-card p{margin:0 0 18px;color:var(--ink-soft);line-height:1.5}
.confirm-card input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font:inherit;margin-bottom:16px}
.data-center-sheet{width:min(980px,calc(100vw - 24px))}
.data-header-actions{display:flex;align-items:center;gap:8px}.backup-ok{padding:10px 12px;margin-bottom:12px;border-radius:9px;background:rgba(32,112,88,.1);color:var(--emerald);font-size:13px}
.data-center-tabs{display:flex;gap:4px;padding:10px 18px;border-bottom:1px solid var(--line);overflow-x:auto}
.data-center-tabs button{display:flex;align-items:center;gap:6px;border:0;background:transparent;padding:8px 11px;border-radius:8px;color:var(--ink-soft);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.data-center-tabs button.on{background:var(--surface-2);color:var(--ink);font-weight:700}.data-center-tabs button span{font-size:11px}
.data-toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}.data-toolbar select{border:1px solid var(--line);border-radius:9px;padding:9px;background:var(--surface);font:inherit}.data-toolbar label{font-size:13px;color:var(--ink-soft)}
.data-list{border:1px solid var(--line);border-radius:12px;overflow:hidden}.data-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--surface)}.data-row:last-child{border-bottom:0}.data-row>div{display:flex;flex-direction:column;gap:3px}.data-row>div:last-child{align-items:flex-end}.data-row span,.data-row small{font-size:12px;color:var(--ink-soft)}.data-row-actions{flex-direction:row!important;align-items:center!important}.data-row-button{width:100%;border:0;text-align:left;cursor:pointer;font:inherit}.data-row-button:hover{background:var(--surface-2)}
.journal-row{align-items:flex-start}.journal-row>div:first-child{min-width:0;flex:1}.journal-row .action-description{margin-top:3px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere}.journal-row>div:last-child{flex:0 0 auto}
.received-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.received-plan-totals{grid-template-columns:repeat(2,minmax(0,1fr))}.received-totals>div{background:var(--surface-2);border-radius:10px;padding:12px}.received-totals span{display:block;font-size:11px;color:var(--ink-soft);margin-bottom:4px}.received-totals b{font-size:17px}
.received-range{flex-wrap:wrap}.received-range label{display:flex;flex-direction:column;gap:6px;flex:1;min-width:160px}.received-range input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:8px 10px;font:inherit;color:var(--ink)}
.received-period{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.received-period label{font-size:12.5px;font-weight:600;color:var(--ink-soft)}.received-period select{min-width:190px;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:8px 10px;font:inherit;color:var(--ink)}
.monthly-profit-register{margin-bottom:14px;border:1px solid var(--line);border-radius:11px;overflow:hidden}.monthly-profit-register-hd,.monthly-profit-register button{display:grid;grid-template-columns:1fr 150px 160px;align-items:center;gap:12px;width:100%;padding:10px 12px;box-sizing:border-box;text-align:left}.monthly-profit-register-hd{background:var(--surface-2);color:var(--ink-soft);font-size:10.5px}.monthly-profit-register-hd span:not(:first-child){text-align:right}.monthly-profit-register button{border:0;border-top:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;cursor:pointer}.monthly-profit-register button:hover,.monthly-profit-register button.on{background:#EDF6F1}.monthly-profit-register button b,.monthly-profit-register button strong{text-align:right;white-space:nowrap}.monthly-profit-register button strong{color:var(--emerald)}
.investor-profit-panel{margin-top:14px}.profit-table-wrap{overflow-x:auto}.profit-table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap}.profit-table th,.profit-table td{padding:10px 9px;border-bottom:1px solid var(--line);text-align:right}.profit-table th:first-child,.profit-table td:first-child{text-align:left}.profit-table tbody tr{cursor:pointer}.profit-table tbody tr:hover{background:var(--surface-2)}

/* Separate summary figures and receipts into clearly outlined cards. */
.received-totals>div{border:1px solid #b8c7bf;background:var(--surface);box-shadow:0 2px 5px #16332e08;padding:15px;border-radius:12px}
.received-totals span{line-height:1.45;margin-bottom:7px}
.received-payment-list.data-list{display:flex;flex-direction:column;gap:12px;border:0;border-radius:0;overflow:visible}
.received-payment-list .data-row{border:1px solid #b8c7bf;border-radius:12px;padding:16px;color:var(--ink);box-shadow:0 2px 5px #16332e08}
.received-payment-list .data-row:last-child{border-bottom:1px solid #b8c7bf}
.received-payment-list .data-row>div{min-width:0;gap:6px;overflow-wrap:anywhere}
.received-payment-list .data-row:hover{border-color:var(--emerald)}
.received-payment-list .data-row:focus-visible{outline:2px solid var(--emerald);outline-offset:3px}

/* Consistent readable frames across tabs and detail sheets. */
.app{--line:#b8c7bf}
.app :is(.panel,.citem,.stat,.card,.client-total,.client-facts>div,.det-item,.investor-accrual-grid>div){border:1px solid var(--line);border-radius:12px}
.app :is(.client-facts>div,.det-item,.investor-accrual-grid>div){padding:12px;background:var(--surface)}
.app .data-list{border:0;overflow:visible}
.app :is(.data-row,.directory-row,.client-choice,.client-history-row,.client-contract,.client-history,.mini-row,.prow,.lrow,.wd-row){border:1px solid var(--line);border-radius:10px;margin-bottom:10px;padding:12px;background:var(--surface)}
.app .data-row-button{color:var(--ink)}
.app :is(.data-row,.directory-row,.client-choice,.client-history-row):last-child{border-bottom:1px solid var(--line)}
.app :is(.data-row-button,.client-choice,.client-history-row):hover{border-color:var(--emerald);background:var(--surface-2)}
.app .panel>.prow{margin:10px;width:calc(100% - 20px)}
.app .card{background:var(--surface)}
.app table{border-collapse:separate;border-spacing:0 6px}
.app :is(td,th){padding:10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.app :is(td,th):first-child{border-left:1px solid var(--line);border-radius:8px 0 0 8px}
.app :is(td,th):last-child{border-right:1px solid var(--line);border-radius:0 8px 8px 0}
.app .cash-summary>p{border:1px solid var(--line);border-radius:12px;padding:14px;margin:0;background:var(--surface)}

@media(max-width:560px){
  .cards{grid-template-columns:1fr}
  .det-grid{grid-template-columns:repeat(2,1fr)}
  .prow{grid-template-columns:1fr auto;row-gap:4px}
  .prow-date{grid-column:1}
  .hero-num{font-size:32px}
  .lrow{grid-template-columns:22px 1fr auto;row-gap:6px}
  .lstatus{grid-column:2}
  .lbtn{grid-column:3}
  .lbtn-group{grid-column:3}
  .monthly-grid{grid-template-columns:1fr}
  .daily-panel-hd{align-items:flex-start;flex-direction:column}.daily-date-controls{width:100%}.daily-date-controls input{flex:1}
  .daily-totals{margin:12px}.daily-payment-list{margin:0 12px 12px}
  .monthly-col + .monthly-col{border-left:none;border-top:1px solid var(--line)}
  .month-profit{display:none}
  .wd-row{grid-template-columns:1fr auto;row-gap:6px}
  .wd-purpose{grid-column:1}
  .wd-investor{grid-column:1}
  .received-totals{grid-template-columns:1fr}
  .monthly-profit-register-hd,.monthly-profit-register button{grid-template-columns:1fr auto}.monthly-profit-register-hd span:nth-child(2),.monthly-profit-register button b{display:none}.profit-comparison .monthly-profit-register-hd,.profit-comparison button{grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px}.profit-comparison .monthly-profit-register-hd span:nth-child(2),.profit-comparison button b{display:block}
  .investor-accrual-grid{grid-template-columns:repeat(2,1fr)}
  .investor-accrual-hd{align-items:flex-start;flex-direction:column}
  .contact-form{grid-template-columns:1fr}.contact-note,.contact-submit{grid-column:1}
  .contact-history-hd{align-items:flex-start;flex-direction:column}
  .data-row{align-items:flex-start;flex-direction:column}.data-row>div:last-child{align-items:flex-start}
}
`;
