import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutGrid, ScrollText, Plus, Phone, Wallet, Users, AlertTriangle,
  CheckCircle2, Clock, ChevronLeft, X, Check, Undo2, CalendarDays,
  Landmark, TrendingUp, Trash2, Paperclip, FileText, ChevronDown,
  Upload, Download, LogOut, Search, Pencil,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase, supabaseConfigured } from "./supabaseClient";

/* ------------------------------------------------------------------ */
/*  Утилиты                                                            */
/* ------------------------------------------------------------------ */

const money = (n) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";

const fmtDate = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));

// приводим телефон к виду 8-928-662-85-85; если не похоже на рос. номер — возвращаем как есть
const fmtPhone = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d[0] === "7") d = "8" + d.slice(1);
  else if (d.length === 10) d = "8" + d;
  if (d.length !== 11) return raw;
  return `${d[0]}-${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
};

const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

const addMonths = (isoDate, n) => {
  const d = new Date(isoDate);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  d.setHours(0, 0, 0, 0);
  return d;
};

// разбиваем сумму на равные части, остаток кладём в последний платёж
const splitAmount = (total, parts) => {
  total = Math.round(total);
  const base = Math.round(total / parts);
  const arr = Array(parts).fill(base);
  arr[parts - 1] = total - base * (parts - 1);
  return arr;
};

const buildSchedule = (c) => {
  const financed = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0) + (+c.markup || 0));
  const amounts = splitAmount(financed, Math.max(1, +c.termMonths || 1));
  const today = startOfToday();
  return amounts.map((amt, i) => {
    const due = addMonths(c.startDate, i);
    const rec = c.payments && c.payments[i];
    const paid = !!(rec && rec.paidDate);
    let status = "upcoming";
    if (paid) status = "paid";
    else if (due < today) status = "overdue";
    else if ((due - today) / 86400000 <= 7) status = "due";
    return { n: i + 1, index: i, dueDate: due, amountDue: amt, paid, paidDate: paid ? rec.paidDate : null, receipt: rec ? rec.receipt : null, status };
  });
};

const contractStats = (c) => {
  const rows = buildSchedule(c);
  const financed = rows.reduce((s, r) => s + r.amountDue, 0);
  const paidSum = rows.filter((r) => r.paid).reduce((s, r) => s + r.amountDue, 0);
  const overdueSum = rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.amountDue, 0);
  const next = rows.find((r) => !r.paid) || null;
  const done = rows.every((r) => r.paid);
  return { rows, financed, paidSum, remaining: financed - paidSum, overdueSum, next, done };
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

// сколько из наценки (прибыли) уже получено, а сколько ещё в графике платежей
const contractCapital = (c) => {
  const principal = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0));
  const markup = Math.max(0, +c.markup || 0);
  const financed = principal + markup;
  const { paidSum } = contractStats(c);
  const frac = financed > 0 ? paidSum / financed : 0;
  return { principal, markup, principalReturned: principal * frac, profitRealized: markup * frac };
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

const investorFromRow = (r) => ({ id: r.id, name: r.name, amount: Number(r.amount) || 0 });
const investorToRow = (i) => ({ id: i.id, name: i.name, amount: i.amount });

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

const excelDateToIso = (v) => {
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
    XLSX.utils.sheet_to_json(contractsSheet, { defval: "" }).forEach((row, i) => {
      const rowNum = i + 2;
      const clientName = String(row["ФИО клиента"] || "").trim();
      if (!clientName) return;
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

      const startDate = excelDateToIso(row["Дата 1-го платежа"]) || new Date().toISOString().slice(0, 10);

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
        clientName, phone: String(row["Телефон"] || "").trim(), item: String(row["Товар"] || "").trim(),
        totalPrice, downPayment, markup, markupPercent, termMonths, startDate,
        investorId: investor ? investor.id : "", comment: String(row["Комментарий"] || "").trim(),
        guarantorName, guarantorPhone, payments: {},
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
      const paidDate = excelDateToIso(row["Дата фактической оплаты"]);
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
/*  Мелкие компоненты                                                  */
/* ------------------------------------------------------------------ */

const STATUS = {
  paid: { label: "Оплачен", cls: "b-emerald" },
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
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [contracts, setContracts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [tab, setTab] = useState("dashboard");
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const [investors, setInvestors] = useState([]);
  const [addingInvestor, setAddingInvestor] = useState(false);

  const [withdrawals, setWithdrawals] = useState([]);
  const [addingWithdrawal, setAddingWithdrawal] = useState(false);

  const [sectionModal, setSectionModal] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [editingContract, setEditingContract] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [investorFilter, setInvestorFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created");

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
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, reloadTick]);

  const totals = useMemo(() => {
    let financed = 0, paid = 0, overdue = 0, remaining = 0, debtors = 0, active = 0;
    const upcoming = [];
    contracts.forEach((c) => {
      const st = contractStats(c);
      financed += st.financed; paid += st.paidSum; overdue += st.overdueSum; remaining += st.remaining;
      if (st.overdueSum > 0) debtors += 1;
      if (!st.done) active += 1;
      st.rows.filter((r) => !r.paid).forEach((r) => upcoming.push({ ...r, client: c.clientName, cid: c.id }));
    });
    upcoming.sort((a, b) => a.dueDate - b.dueDate);
    return { financed, paid, overdue, remaining, debtors, active, upcoming: upcoming.slice(0, 8) };
  }, [contracts]);

  const capital = useMemo(() => {
    let principalTotal = 0, principalReturned = 0, profitRealized = 0, profitTotal = 0;
    const perInvestor = {};
    contracts.forEach((c) => {
      const cc = contractCapital(c);
      principalTotal += cc.principal;
      principalReturned += cc.principalReturned;
      profitRealized += cc.profitRealized;
      profitTotal += cc.markup;
      const key = c.investorId || "";
      perInvestor[key] = (perInvestor[key] || 0) + (cc.principal - cc.principalReturned);
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
      perInvestor, withdrawnByInvestor, withdrawnTotal,
    };
  }, [contracts, investors, withdrawals]);

  const addInvestor = async (data) => {
    const inv = { ...data, id: "i" + Date.now() };
    setInvestors((prev) => [inv, ...prev]);
    setAddingInvestor(false);
    const { error } = await supabase.from("investors").insert(investorToRow(inv));
    setStorageError(!!error);
  };

  const removeInvestor = async (id) => {
    setInvestors((prev) => prev.filter((i) => i.id !== id));
    const { error } = await supabase.from("investors").delete().eq("id", id);
    setStorageError(!!error);
  };

  const addWithdrawal = async (data) => {
    const w = { ...data, id: "w" + Date.now() };
    setWithdrawals((prev) => [w, ...prev]);
    setAddingWithdrawal(false);
    const { error } = await supabase.from("withdrawals").insert(withdrawalToRow(w));
    setStorageError(!!error);
  };

  const removeWithdrawal = async (id) => {
    setWithdrawals((prev) => prev.filter((w) => w.id !== id));
    const { error } = await supabase.from("withdrawals").delete().eq("id", id);
    setStorageError(!!error);
  };

  const importData = async (newInvestors, newContracts, paymentUpdates) => {
    let failed = false;
    if (newInvestors.length) {
      setInvestors((prev) => [...newInvestors, ...prev]);
      const { error } = await supabase.from("investors").insert(newInvestors.map(investorToRow));
      if (error) failed = true;
    }
    if (newContracts.length) {
      setContracts((prev) => [...newContracts, ...prev]);
      const { error } = await supabase.from("contracts").insert(newContracts.map(contractToRow));
      if (error) failed = true;
    }
    if (paymentUpdates && paymentUpdates.length) {
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
      if (results.some((r) => r.error)) failed = true;
    }
    setStorageError(failed);
  };

  const togglePay = async (cid, idx, paidDate) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const cur = payments[idx];
    if (cur && cur.paidDate) {
      if (cur.receipt) payments[idx] = { receipt: cur.receipt };
      else delete payments[idx];
    } else {
      payments[idx] = { ...(cur || {}), paidDate: paidDate || new Date().toISOString().slice(0, 10) };
    }
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    setStorageError(!!error);
  };

  const updatePaidDate = async (cid, idx, paidDate) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const cur = payments[idx];
    if (!cur || !cur.paidDate) return;
    payments[idx] = { ...cur, paidDate };
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    setStorageError(!!error);
  };

  const attachReceipt = async (cid, idx, file) => {
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    const safeExt = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : "";
    const path = `${cid}/${idx}-${Date.now()}${safeExt}`;
    const { error: uploadError } = await supabase.storage.from("receipts").upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) { setStorageError(true); alert(`Не удалось загрузить чек: ${uploadError.message}`); return; }
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const receipt = { name: file.name, type: file.type, path };
    const payments = { ...(c.payments || {}) };
    payments[idx] = { ...(payments[idx] || {}), receipt };
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    setStorageError(!!error);
  };

  const earlyPayoff = async (cid) => {
    const c = contracts.find((x) => x.id === cid);
    if (!c) return;
    const payments = { ...(c.payments || {}) };
    const today = new Date().toISOString().slice(0, 10);
    buildSchedule(c).forEach((r) => {
      if (!r.paid) payments[r.index] = { ...(payments[r.index] || {}), paidDate: today };
    });
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    setStorageError(!!error);
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
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, payments } : x)));
    if (receipt && receipt.path) await supabase.storage.from("receipts").remove([receipt.path]);
    const { error } = await supabase.from("contracts").update({ payments }).eq("id", cid);
    setStorageError(!!error);
  };

  const addContract = async (data) => {
    const c = { ...data, id: "c" + Date.now(), payments: {} };
    setContracts((prev) => [c, ...prev]);
    setAdding(false);
    const { error } = await supabase.from("contracts").insert(contractToRow(c));
    setStorageError(!!error);
  };

  const updateContract = async (data) => {
    const cid = editingContract.id;
    const updated = { ...editingContract, ...data };
    setContracts((prev) => prev.map((c) => (c.id === cid ? updated : c)));
    setEditingContract(null);
    const { error } = await supabase.from("contracts").update(contractToRow(updated)).eq("id", cid);
    setStorageError(!!error);
  };

  const updateComment = async (cid, comment) => {
    setContracts((prev) => prev.map((x) => (x.id === cid ? { ...x, comment } : x)));
    const { error } = await supabase.from("contracts").update({ comment }).eq("id", cid);
    setStorageError(!!error);
  };

  const deleteContract = async (cid) => {
    if (!window.confirm("Удалить договор безвозвратно? Все платежи и прикреплённые чеки будут удалены.")) return;
    const c = contracts.find((x) => x.id === cid);
    setContracts((prev) => prev.filter((x) => x.id !== cid));
    setOpenId(null);
    const receiptPaths = Object.values(c?.payments || {}).map((p) => p?.receipt?.path).filter(Boolean);
    if (receiptPaths.length) await supabase.storage.from("receipts").remove(receiptPaths);
    const { error } = await supabase.from("contracts").delete().eq("id", cid);
    setStorageError(!!error);
  };

  const open = contracts.find((c) => c.id === openId) || null;

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

  const filteredContracts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = contracts.filter((c) => {
      if (statusFilter !== "all") {
        const st = contractStats(c);
        const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
        if (badge !== statusFilter) return false;
      }
      if (investorFilter !== "all" && (c.investorId || "") !== investorFilter) return false;
      if (!q) return true;
      return (
        c.clientName.toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.item || "").toLowerCase().includes(q)
      );
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
  }, [contracts, search, statusFilter, investorFilter, sortBy]);

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
          <div><button className="btn primary btn-sm retry-btn" onClick={() => setReloadTick((t) => t + 1)}>Повторить</button></div>
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
            <div className="btag">учёт договоров и платежей</div>
          </div>
        </div>
        <div className="hd-actions">
          <button className="btn on-dark" onClick={() => setImporting(true)}>
            <Upload size={16} /> Импорт из Excel
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Новый договор
          </button>
          <button className="icon-btn" onClick={logout} title="Выйти">
            <LogOut size={16} />
          </button>
        </div>
      </header>

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
      </nav>

      {storageError && (
        <div className="storage-warn-wrap">
          <div className="storage-warn">
            <AlertTriangle size={15} />
            Не удалось сохранить последние изменения в базе данных — проверьте интернет-соединение.
            Изменения видны сейчас, но могут не сохраниться на сервере.
          </div>
        </div>
      )}

      {tab === "dashboard" && (
        <main className="wrap">
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
            <Stat icon={<Wallet size={16} />} label="Выдано в рассрочку" value={money(totals.financed)} onClick={() => setSectionModal("financed")} />
            <Stat icon={<TrendingUp size={16} />} label="Общая прибыль" value={money(capital.profitTotal)} onClick={() => setSectionModal("profit")} />
            <Stat icon={<CheckCircle2 size={16} />} label="Прибыль получена" value={money(capital.profitRealized)} onClick={() => setSectionModal("profitRealized")} />
            <Stat icon={<Users size={16} />} label="Активных договоров" value={totals.active} onClick={() => setSectionModal("active")} />
            <Stat icon={<AlertTriangle size={16} />} label="Должников (просрочка)" value={totals.debtors} tone={totals.debtors ? "clay" : ""} onClick={() => setSectionModal("debtors")} />
          </section>

          <section className="panel">
            <div className="panel-hd"><CalendarDays size={15} /> Ближайшие платежи</div>
            {totals.upcoming.length === 0 ? (
              <div className="empty">Всё оплачено — открытых платежей нет.</div>
            ) : (
              <div className="rows">
                {totals.upcoming.map((r) => (
                  <button key={r.cid + "-" + r.index} className="prow" onClick={() => { setOpenId(r.cid); }}>
                    <span className="prow-name">{r.client}</span>
                    <span className="prow-date">{fmtDate(r.dueDate)}</span>
                    <span className="prow-sum num">{money(r.amountDue)}</span>
                    <Badge s={r.status} />
                  </button>
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
                placeholder="Поиск по имени, телефону, товару…"
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
            <select className="toolbar-select" value={investorFilter} onChange={(e) => setInvestorFilter(e.target.value)}>
              <option value="all">Все источники</option>
              <option value="">Общий пул</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>{inv.name}</option>
              ))}
            </select>
            <div className="filter-chips">
              {[
                ["all", "Все"], ["active", "Активные"], ["overdue", "Просрочка"], ["done", "Закрытые"],
              ].map(([key, label]) => (
                <button key={key} className={statusFilter === key ? "on" : ""} onClick={() => setStatusFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredContracts.length === 0 ? (
            <div className="panel"><div className="empty">Ничего не найдено по этому запросу или фильтру.</div></div>
          ) : (
          <div className="clist">
            {filteredContracts.map((c) => {
              const st = contractStats(c);
              const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
              const expanded = expandedId === c.id;
              const overdueRows = st.rows.filter((r) => r.status === "overdue");
              const upcomingRows = st.rows.filter((r) => !r.paid && r.status !== "overdue");
              const paidRows = st.rows.filter((r) => r.paid);
              const investorLabel = c.investorId
                ? (investors.find((i) => i.id === c.investorId)?.name || "—")
                : "Общий пул";
              return (
                <div key={c.id} className="citem">
                  <button
                    type="button"
                    className="citem-status-row"
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                  >
                    <span className="citem-name-block">
                      <span className="citem-name">{c.clientName}</span>
                      <span className="citem-investor muted">{investorLabel}</span>
                      <span className="citem-amount">Остаток <b className="num">{money(st.remaining)}</b></span>
                    </span>
                    <span className="citem-status-right">
                      <Badge s={badge} />
                      <ChevronDown size={15} className={`chev ${expanded ? "on" : ""}`} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="citem-expand">
                      <div className="mini-row citem-contract-date">
                        <span>Дата составления договора</span><span className="num">{fmtDate(c.startDate)}</span>
                      </div>
                      {overdueRows.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd clay">Просрочено</div>
                          {overdueRows.map((r) => (
                            <div key={r.index} className="mini-row">
                              <span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.amountDue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {upcomingRows.length > 0 && (
                        <div className="mini-block">
                          <div className="mini-hd">Предстоящие</div>
                          {upcomingRows.map((r) => (
                            <div key={r.index} className="mini-row">
                              <span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.amountDue)}</span>
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
                      <button type="button" className="btn ghost btn-sm citem-open" onClick={() => setOpenId(c.id)}>
                        Открыть договор
                      </button>
                    </div>
                  )}
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
              return (
                <div key={inv.id} className="inv-card">
                  <div className="citem-top">
                    <span className="citem-name">{inv.name}</span>
                    <button className="icon-btn-ghost" onClick={() => removeInvestor(inv.id)} title="Удалить">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="det-grid inv-grid">
                    <div><span>Вклад</span><b className="num">{money(inv.amount)}</b></div>
                    <div><span>Доля</span><b className="num">{pct}%</b></div>
                    <div><span>В обороте</span><b className="num">{money(invDeployed)}</b></div>
                    <div><span>Выведено</span><b className="num">{money(invWithdrawn)}</b></div>
                    <div><span>Свободно</span><b className="num strong">{money(invFree)}</b></div>
                  </div>
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

      {open && (
        <Detail
          contract={open}
          investors={investors}
          onClose={() => setOpenId(null)}
          onToggle={togglePay}
          onUpdatePaidDate={updatePaidDate}
          onAttachReceipt={attachReceipt}
          onRemoveReceipt={removeReceipt}
          onEarlyPayoff={earlyPayoff}
          onDelete={deleteContract}
          onUpdateComment={updateComment}
          onEdit={(c) => { setOpenId(null); setEditingContract(c); }}
        />
      )}
      {adding && <AddForm investors={investors} onClose={() => setAdding(false)} onSave={addContract} />}
      {editingContract && (
        <AddForm
          investors={investors}
          editing={editingContract}
          onClose={() => setEditingContract(null)}
          onSave={updateContract}
        />
      )}
      {addingInvestor && <AddInvestorForm onClose={() => setAddingInvestor(false)} onSave={addInvestor} />}
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
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Детали договора ----------------------- */

function Detail({ contract, investors, onClose, onToggle, onUpdatePaidDate, onAttachReceipt, onRemoveReceipt, onEarlyPayoff, onDelete, onUpdateComment, onEdit }) {
  const st = contractStats(contract);
  const investorName = contract.investorId
    ? (investors.find((i) => i.id === contract.investorId)?.name || "—")
    : "Общий пул";

  const [comment, setComment] = useState(contract.comment || "");
  const [payingIdx, setPayingIdx] = useState(null);
  const [payMode, setPayMode] = useState("new"); // "new" | "edit"
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const startPay = (idx) => {
    setPayingIdx(idx);
    setPayMode("new");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const startEditDate = (idx, currentDate) => {
    setPayingIdx(idx);
    setPayMode("edit");
    setPayDate(currentDate);
  };

  const confirmPay = (idx) => {
    if (payMode === "edit") onUpdatePaidDate(contract.id, idx, payDate);
    else onToggle(contract.id, idx, payDate);
    setPayingIdx(null);
  };

  const handleFile = async (e, idx) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    onAttachReceipt(contract.id, idx, file);
    e.target.value = "";
  };

  const openReceipt = async (receipt) => {
    if (receipt.path) {
      // открываем вкладку сразу (по клику), иначе Safari заблокирует её после ожидания ссылки
      const win = window.open("about:blank", "_blank");
      const { data, error } = await supabase.storage.from("receipts").createSignedUrl(receipt.path, 60);
      if (error || !data?.signedUrl) { win?.close(); alert(`Не удалось открыть чек: ${error?.message || "нет ссылки"}`); return; }
      if (win) win.location.href = data.signedUrl;
      else window.open(data.signedUrl, "_blank");
    } else if (receipt.dataUrl) {
      window.open(receipt.dataUrl, "_blank");
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <button className="icon-btn" onClick={onClose}><ChevronLeft size={18} /></button>
          <div>
            <div className="sheet-name">{contract.clientName}</div>
            {contract.phone && (
              <a className="sheet-phone" href={`tel:${contract.phone}`}><Phone size={12} /> {fmtPhone(contract.phone)}</a>
            )}
          </div>
          <button className="icon-btn" onClick={() => onDelete(contract.id)} title="Удалить договор"><Trash2 size={18} /></button>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sheet-body">
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

          <button type="button" className="btn ghost btn-sm det-edit-btn" onClick={() => onEdit(contract)}>
            <Pencil size={13} /> Изменить договор
          </button>

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

          <div className="ledger-hd-row">
            <div className="ledger-hd ledger-hd-inline">График платежей</div>
            {!st.done && (
              <button className="btn ghost btn-sm" onClick={() => onEarlyPayoff(contract.id)}>
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
                      title="Изменить дату оплаты"
                      onClick={() => (payingIdx === r.index ? setPayingIdx(null) : startEditDate(r.index, r.paidDate))}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                ) : (
                  <button className="lbtn pay" onClick={() => (payingIdx === r.index ? setPayingIdx(null) : startPay(r.index))}>
                    <Check size={13} /> Оплатить
                  </button>
                )}
                {payingIdx === r.index && (
                  <div className="pay-inline">
                    <DateFields value={payDate} onChange={setPayDate} />
                    <button className="btn primary btn-sm" onClick={() => confirmPay(r.index)}>Подтвердить</button>
                    <button className="btn ghost btn-sm" onClick={() => setPayingIdx(null)}>Отмена</button>
                  </div>
                )}
                <div className="receipt-row">
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
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Новый договор ------------------------- */

function AddForm({ investors, onClose, onSave, editing }) {
  const [f, setF] = useState({
    clientName: editing?.clientName || "", phone: editing?.phone || "", item: editing?.item || "",
    comment: editing?.comment || "",
    totalPrice: editing ? String(editing.totalPrice || "") : "",
    downPayment: editing ? String(editing.downPayment || "") : "",
    markupPercent: editing ? String(editing.markupPercent || 0) : "20",
    markupAmount: editing ? String(editing.markup || 0) : "0",
    monthlyPayment: "0",
    termMonths: editing ? String(editing.termMonths || 1) : "6",
    startDate: editing?.startDate || new Date().toISOString().slice(0, 10),
    investorId: editing?.investorId || "",
    guarantorName: editing?.guarantorName || "", guarantorPhone: editing?.guarantorPhone || "",
  });
  const [showGuarantor, setShowGuarantor] = useState(!!(editing?.guarantorName || editing?.guarantorPhone));
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  const principal = Math.max(0, (+f.totalPrice || 0) - (+f.downPayment || 0));

  // цена/взнос меняются — сумма наценки и платёж в месяц пересчитываются от текущего процента
  useEffect(() => {
    setF((prev) => {
      const amount = Math.round(principal * (+prev.markupPercent || 0) / 100);
      const monthly = Math.round((principal + amount) / Math.max(1, +prev.termMonths || 1));
      return { ...prev, markupAmount: String(amount), monthlyPayment: String(monthly) };
    });
  }, [principal]);

  const onMarkupPercent = (e) => {
    const percent = e.target.value;
    const amount = Math.round(principal * (+percent || 0) / 100);
    const monthly = Math.round((principal + amount) / Math.max(1, +f.termMonths || 1));
    setF((prev) => ({ ...prev, markupPercent: percent, markupAmount: String(amount), monthlyPayment: String(monthly) }));
  };

  const onMarkupAmount = (e) => {
    const amount = e.target.value;
    const percent = principal > 0 ? Math.round(((+amount || 0) / principal) * 1000) / 10 : 0;
    const monthly = Math.round((principal + (+amount || 0)) / Math.max(1, +f.termMonths || 1));
    setF((prev) => ({ ...prev, markupAmount: amount, markupPercent: String(percent), monthlyPayment: String(monthly) }));
  };

  const onMonthlyPayment = (e) => {
    const monthlyInput = e.target.value;
    const term = Math.max(1, +f.termMonths || 1);
    const financedFromMonthly = Math.round((+monthlyInput || 0) * term);
    const amount = Math.max(0, financedFromMonthly - principal);
    const percent = principal > 0 ? Math.round((amount / principal) * 1000) / 10 : 0;
    setF((prev) => ({ ...prev, monthlyPayment: monthlyInput, markupAmount: String(amount), markupPercent: String(percent) }));
  };

  const onTermMonths = (e) => {
    const term = e.target.value;
    const amount = +f.markupAmount || 0;
    const monthly = Math.round((principal + amount) / Math.max(1, +term || 1));
    setF((prev) => ({ ...prev, termMonths: term, monthlyPayment: String(monthly) }));
  };

  const markup = +f.markupAmount || 0;
  const financed = principal + markup;
  const valid = f.clientName.trim().length > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">{editing ? "Изменить договор" : "Новый договор рассрочки"}</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <Field label="ФИО клиента"><input value={f.clientName} onChange={set("clientName")} placeholder="Иванов Иван" /></Field>
          <div className="frow">
            <Field label="Телефон"><input value={f.phone} onChange={set("phone")} placeholder="+7 …" /></Field>
            <Field label="Дата 1-го платежа">
              <DateFields value={f.startDate} onChange={(v) => setF((prev) => ({ ...prev, startDate: v }))} />
            </Field>
          </div>
          <Field label="Товар"><input value={f.item} onChange={set("item")} placeholder="Телефон, техника…" /></Field>
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
          </div>
          <div className="frow">
            <Field label="Наценка, %"><input type="number" value={f.markupPercent} onChange={onMarkupPercent} placeholder="20" /></Field>
            <Field label="Наценка, ₽"><input type="number" value={f.markupAmount} onChange={onMarkupAmount} placeholder="0" /></Field>
          </div>
          <div className="frow">
            <Field label="Срок, мес"><input type="number" value={f.termMonths} onChange={onTermMonths} placeholder="6" /></Field>
            <Field label="Платёж в месяц, ₽"><input type="number" value={f.monthlyPayment} onChange={onMonthlyPayment} placeholder="0" /></Field>
          </div>
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

          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>Отмена</button>
            <button className="btn primary" disabled={!valid} onClick={() => {
              const { markupAmount: _markupAmount, monthlyPayment: _monthlyPayment, ...rest } = f;
              onSave({
                ...rest, totalPrice: +f.totalPrice, downPayment: +f.downPayment || 0,
                markup, markupPercent: +f.markupPercent || 0, termMonths: Math.max(1, +f.termMonths || 1),
              });
            }}>{editing ? "Сохранить изменения" : "Создать договор"}</button>
          </div>
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
      <input ref={dayRef} value={day} onChange={onDay} onFocus={(e) => e.target.select()} placeholder="ДД" inputMode="numeric" />
      <span>.</span>
      <input ref={monthRef} value={month} onChange={onMonth} onKeyDown={backspaceTo(dayRef, month)}
        onFocus={(e) => e.target.select()} placeholder="ММ" inputMode="numeric" />
      <span>.</span>
      <input ref={yearRef} value={year} onChange={onYear} onKeyDown={backspaceTo(monthRef, year)}
        onFocus={(e) => e.target.select()} placeholder="ГГГГ" inputMode="numeric" />
    </div>
  );
}

/* --------------------------- Новый вкладчик ------------------------ */

function AddInvestorForm({ onClose, onSave }) {
  const [f, setF] = useState({ name: "", amount: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.name.trim() && +f.amount > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">Новый вкладчик</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <Field label="Имя вкладчика"><input value={f.name} onChange={set("name")} placeholder="Иванов Пётр" /></Field>
          <Field label="Сумма вклада"><input type="number" value={f.amount} onChange={set("amount")} placeholder="0" /></Field>
          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>Отмена</button>
            <button className="btn primary" disabled={!valid} onClick={() => onSave({ name: f.name.trim(), amount: +f.amount })}>
              Добавить
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

function ImportModal({ investors, contracts, onClose, onImport }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const { newInvestors, newContracts, paymentUpdates, errors } = await parseImportWorkbook(file, investors, contracts);
      onImport(newInvestors, newContracts, paymentUpdates);
      setResult({ investors: newInvestors.length, contracts: newContracts.length, payments: paymentUpdates.length, errors });
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
                Добавлено вкладчиков: {result.investors}, договоров: {result.contracts}, отмечено платежей: {result.payments}
              </div>
              {result.errors.length > 0 && (
                <div className="mini-block">
                  <div className="mini-hd clay">Замечания ({result.errors.length})</div>
                  {result.errors.map((err, i) => (
                    <div key={i} className="mini-row import-error">{err}</div>
                  ))}
                </div>
              )}
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
@import url('https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.app{
  --paper:#EEF1EB; --surface:#FBFCF9; --ink:#16332E; --ink-soft:#4E5C57;
  --line:#DCE1D7; --brass:#8C6A2E; --emerald:#1E7A54; --clay:#B4463A; --amber:#B4801F;
  font-family:'Golos Text',system-ui,-apple-system,sans-serif;
  color:var(--ink); background:var(--paper); min-height:100%;
  -webkit-font-smoothing:antialiased;
}
.app *{box-sizing:border-box}
.num{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.strong{font-weight:600}
.muted{color:var(--ink-soft);font-size:12px}
.loading{padding:60px;text-align:center;color:var(--ink-soft)}
.retry-btn{margin-top:14px}

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

.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.panel-hd{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line);
  font-weight:600;font-size:13.5px;color:var(--brass)}
.panel-hd-row{justify-content:space-between}
.panel-hd-title{display:flex;align-items:center;gap:8px}
.empty{padding:26px 18px;text-align:center;color:var(--ink-soft);font-size:13px}
.rows{display:flex;flex-direction:column}
.prow{display:grid;grid-template-columns:1fr auto auto auto;align-items:center;gap:14px;
  padding:12px 18px;border:none;border-bottom:1px solid var(--line);background:transparent;
  cursor:pointer;font:inherit;text-align:left;width:100%}
.prow:last-child{border-bottom:none}
.prow:hover{background:#F3F5EF}
.prow-name{font-weight:500;font-size:14px}
.prow-date{font-size:12.5px;color:var(--ink-soft)}
.prow-sum{font-size:14px;font-weight:600}

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
.filter-chips{display:flex;gap:6px;flex-wrap:wrap}
.filter-chips button{border:1px solid var(--line);background:var(--surface);color:var(--ink-soft);cursor:pointer;
  font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:20px;white-space:nowrap}
.filter-chips button.on{background:var(--brass);color:#fff;border-color:var(--brass)}

.clist{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;align-items:start}
.citem{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  transition:border-color .15s}
.citem:hover{border-color:var(--brass)}
.citem-status-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  border:none;background:transparent;cursor:pointer;font:inherit;text-align:left;padding:15px 16px}
.citem-status-row:hover{background:#F3F5EF}
.citem-name-block{display:flex;flex-direction:column;gap:2px}
.citem-name{font-weight:600;font-size:15px}
.citem-investor{font-size:11.5px}
.citem-amount{font-size:12.5px;color:var(--ink-soft);margin-top:2px}
.citem-amount b{color:var(--ink);font-size:13.5px}
.citem-status-right{display:flex;align-items:center;gap:8px}
.chev{color:var(--ink-soft);transition:transform .15s}
.chev.on{transform:rotate(180deg)}
.citem-expand{padding:0 16px 16px;border-top:1px solid var(--line)}
.mini-block{margin-top:12px}
.mini-hd{font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;color:var(--ink-soft);margin-bottom:6px}
.mini-hd.clay{color:var(--clay)}
.mini-hd.emerald{color:var(--emerald)}
.mini-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px dashed var(--line)}
.mini-row:last-child{border-bottom:none}
.citem-contract-date{margin-top:12px;color:var(--ink-soft)}
.citem-contract-date .num{color:var(--ink);font-weight:600}
.citem-open{margin-top:14px;width:100%;justify-content:center}

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
.lnum{color:var(--ink-soft);font-size:12px}
.ldate{font-size:13px}
.lsum{font-size:14px;font-weight:600}
.lbtn{display:inline-flex;align-items:center;gap:5px;border:none;cursor:pointer;font:inherit;
  font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px}
.lbtn.pay{background:var(--emerald);color:#fff}
.lbtn.undo{background:transparent;color:var(--ink-soft);border:1px solid var(--line)}
.lbtn.pay:hover{filter:brightness(1.06)}
.lbtn-group{display:flex;gap:6px}
.lbtn.edit-date{padding:6px 8px}

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
.frow{display:grid;grid-template-columns:1fr 1fr;gap:12px}

.date-fields{display:flex;align-items:center;gap:2px;width:100%;border:1px solid var(--line);
  background:var(--surface);border-radius:9px;padding:10px 12px}
.date-fields:focus-within{border-color:var(--brass);box-shadow:0 0 0 3px rgba(140,106,46,.12)}
.date-fields input{border:none;background:transparent;font:inherit;font-size:14px;color:var(--ink);
  text-align:center;padding:0;outline:none}
.date-fields input:nth-child(1){width:1.7em}
.date-fields input:nth-child(3){width:1.7em}
.date-fields input:nth-child(5){width:2.8em}
.date-fields span{color:var(--ink-soft)}

.det-edit-btn{margin-bottom:16px}
.guarantor-toggle{margin-bottom:12px}
.comment-block{margin-bottom:18px}
.comment-field{margin-bottom:8px}
.comment-save{width:100%;justify-content:center}

.pay-inline{grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:6px}
.pay-inline .date-fields{width:auto;padding:6px 8px}
.pay-inline .date-fields input{font-size:12.5px}

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
.unassigned-note{margin-top:4px;font-size:12.5px}

.wd-list-hd{margin-top:18px}
.wd-row{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:14px;
  padding:12px 18px;border-bottom:1px solid var(--line)}
.wd-row:last-child{border-bottom:none}
.wd-date{font-size:12.5px;color:var(--ink-soft);white-space:nowrap}
.wd-investor{font-size:12.5px;white-space:nowrap}
.wd-sum{font-size:14px}

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
  .wd-row{grid-template-columns:1fr auto;row-gap:6px}
  .wd-purpose{grid-column:1}
  .wd-investor{grid-column:1}
}
`;
