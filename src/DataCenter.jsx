import React, { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Download, FileClock, FolderOpen, HardDriveDownload, History, RotateCcw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { isDesktopApp, localData } from "./dataClient";
import { formatDataDateTime as formatDateTime, parseDataDate } from "./dataDates";

const TYPE_LABELS = { contracts: "Договор", payments: "Платёж", contacts: "Контакт", investors: "Вкладчик", withdrawals: "Вывод", receipts: "Чек", export: "Экспорт", backup: "Резервная копия", drafts: "Черновик", import: "Импорт" };
const ACTION_LABELS = {
  create: "Создание", update: "Изменение", update_payment: "Изменение платежа",
  create_payment: "Оплата", full_payment: "Полная оплата", partial_payment: "Частичная оплата",
  cancel_payment: "Отмена оплаты", change_payment_date: "Изменение даты оплаты",
  defer_payment: "Отсрочка платежа", edit_deferral: "Изменение отсрочки", cancel_deferral: "Отмена отсрочки",
  whatsapp_notification: "Уведомление WhatsApp", cancel_whatsapp_notification: "Отмена уведомления WhatsApp", early_payoff: "Досрочное погашение",
  create_contact: "Контакт с клиентом", delete_contact: "Удаление записи о контакте",
  attach_receipt: "Прикрепление чека", remove_receipt: "Удаление чека", restore_receipt: "Восстановление чека", permanent_delete_receipt: "Удаление чека навсегда",
  move_to_trash: "Перемещение в корзину", restore: "Восстановление",
  permanent_delete: "Удаление навсегда", import: "Импорт", export_excel: "Экспорт Excel", backup: "Резервная копия",
  export_backup: "Экспорт резервной копии", excel_backup: "Ежедневная Excel-копия",
  stage_restore: "Подготовка восстановления копии", restore_backup: "Восстановление копии", delete_old_drafts: "Удаление старых черновиков",
};

const FIELD_LABELS = {
  client_name: "Клиент", clientName: "Клиент", phone: "Телефон", item: "Товар",
  total_price: "Цена", totalPrice: "Цена", down_payment: "Первоначальный взнос", downPayment: "Первоначальный взнос",
  markup: "Наценка", markup_percent: "Процент наценки", markupPercent: "Процент наценки",
  term_months: "Срок", termMonths: "Срок", start_date: "Дата первого платежа", startDate: "Дата первого платежа",
  investor_id: "Источник финансирования", investorId: "Источник финансирования", comment: "Комментарий",
  guarantor_name: "Поручитель", guarantorName: "Поручитель", guarantor_phone: "Телефон поручителя", guarantorPhone: "Телефон поручителя",
  paidDate: "Дата оплаты", paidAmount: "Сумма оплаты", notifiedAt: "Уведомление WhatsApp", receipt: "Чек",
  deferredUntil: "Отсрочка до", deferralReason: "Причина отсрочки",
  deferralHistory: "История отсрочек", fromDate: "Предыдущая дата", toDate: "Новая дата", reason: "Причина",
  amount: "Сумма", date: "Дата", purpose: "Назначение", name: "Название",
};
const MONEY_FIELDS = /total_price|totalPrice|down_payment|downPayment|markup$|paidAmount|amount$/;
const DATE_FIELDS = /Date$|_date$|notifiedAt$/;
// SQLite на Mac хранит снимки строкой, Supabase отдаёт готовый объект.
const parseJson = (value) => { if (value && typeof value === "object") return value; try { return value ? JSON.parse(value) : null; } catch { return null; } };
const flatten = (value, prefix = "", result = {}) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key, result));
  } else result[prefix] = value;
  return result;
};
const fieldLabel = (path) => {
  const parts = path.split(".");
  const paymentAt = parts.indexOf("payments");
  const base = FIELD_LABELS[parts.at(-1)] || parts.at(-1);
  return paymentAt >= 0 && parts[paymentAt + 1] != null ? `Платёж №${Number(parts[paymentAt + 1]) + 1}: ${base.toLowerCase()}` : base;
};
const displayValue = (path, value) => {
  if (value == null || value === "") return "не указано";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (Array.isArray(value)) return value.length ? `${value.length} зап.` : "пусто";
  if (MONEY_FIELDS.test(path) && Number.isFinite(Number(value))) return `${new Intl.NumberFormat("ru-RU").format(Number(value))} ₽`;
  if (DATE_FIELDS.test(path)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return path.endsWith("notifiedAt") ? formatDateTime(value) : new Intl.DateTimeFormat("ru-RU").format(date);
  }
  return String(value);
};
const paymentNo = (action) => {
  const index = Number(String(action.entity_id || "").split(":").at(-1));
  return Number.isFinite(index) ? index + 1 : null;
};
const paymentMap = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return {};
  if (snapshot.payments && typeof snapshot.payments === "object") return snapshot.payments;
  return Object.keys(snapshot).some((key) => /^\d+$/.test(key)) ? snapshot : {};
};
const changedPaymentDates = (before, after) => {
  const left = paymentMap(before), right = paymentMap(after);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => left[key]?.paidDate !== right[key]?.paidDate)
    .map((key) => ({ number: Number(key) + 1, before: left[key]?.paidDate || "", after: right[key]?.paidDate || "" }));
};
const money = (value) => displayValue("amount", value);
const day = (value) => displayValue("paidDate", value);
// Понятное описание изменения платежей: что именно случилось с каждым платежом.
export const describePaymentChanges = (before, after) => {
  const left = paymentMap(before), right = paymentMap(after);
  const lines = [];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) => Number(a) - Number(b));
  for (const key of keys) {
    const was = left[key] || {}, now = right[key] || {};
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const parts = [];
    const wasEvents = Array.isArray(was.paymentEvents) ? was.paymentEvents : [];
    const nowEvents = Array.isArray(now.paymentEvents) ? now.paymentEvents : [];
    if (nowEvents.length > wasEvents.length) {
      nowEvents.slice(wasEvents.length).forEach((event) => parts.push(`внесено ${money(event.amount)}${event.date ? ` (${day(event.date)})` : ""}${event.comment ? `, «${event.comment}»` : ""}`));
    } else if (nowEvents.length < wasEvents.length) {
      parts.push(`удалена запись об оплате${wasEvents.length - nowEvents.length > 1 ? ` (${wasEvents.length - nowEvents.length} шт.)` : ""}`);
    } else if (JSON.stringify(wasEvents) !== JSON.stringify(nowEvents)) {
      parts.push("исправлена запись об оплате");
    }
    if (!was.paidDate && now.paidDate) parts.push(`оплачен полностью ${day(now.paidDate)}`);
    else if (was.paidDate && !now.paidDate) parts.push(`снята отметка об оплате от ${day(was.paidDate)}`);
    else if (was.paidDate !== now.paidDate) parts.push(`дата оплаты ${day(was.paidDate)} → ${day(now.paidDate)}`);
    if (was.paidAmount !== now.paidAmount && !parts.some((part) => part.startsWith("внесено"))) {
      parts.push(`сумма оплаты ${money(was.paidAmount)} → ${money(now.paidAmount)}`);
    }
    if (!was.deferredUntil && now.deferredUntil) parts.push(`отсрочка до ${day(now.deferredUntil)}${now.deferralReason ? `, причина: ${now.deferralReason}` : ""}`);
    else if (was.deferredUntil && !now.deferredUntil) parts.push("отсрочка отменена");
    else if (was.deferredUntil !== now.deferredUntil) parts.push(`отсрочка ${day(was.deferredUntil)} → ${day(now.deferredUntil)}`);
    if (!was.notifiedAt && now.notifiedAt) parts.push("клиент уведомлён");
    else if (was.notifiedAt && !now.notifiedAt) parts.push("отменена отметка «Клиент уведомлён»");
    if (!was.receipt && now.receipt) parts.push("прикреплён чек");
    else if (was.receipt && !now.receipt) parts.push("удалён чек");
    lines.push(`Платёж №${Number(key) + 1}: ${parts.length ? parts.join(", ") : "изменены данные"}`);
  }
  return lines.length ? `${lines.join("; ")}.` : "";
};

const actionDescription = (action) => {
  if (action.error_message) return action.error_message;
  const beforeRaw = parseJson(action.before_json) || {};
  const afterRaw = parseJson(action.after_json) || {};
  const number = paymentNo(action);
  if (['defer_payment', 'edit_deferral', 'cancel_deferral'].includes(action.action_type)) {
    const from = beforeRaw.deferredUntil || afterRaw.deferralHistory?.at(-1)?.fromDate;
    const to = afterRaw.deferredUntil || beforeRaw.deferralHistory?.[0]?.fromDate;
    return `Платёж №${number || '—'}: ${from ? displayValue('paidDate', from) : 'дата по графику'} → ${to ? displayValue('paidDate', to) : 'дата по графику'}. Причина: ${beforeRaw.deferralReason || 'не указана'} → ${afterRaw.deferralReason || 'не указана'}.`;
  }
  if (action.action_type === "early_payoff") {
    const changes = changedPaymentDates(beforeRaw, afterRaw);
    const numbers = afterRaw.paymentNumbers || changes.filter((item) => item.after).map((item) => item.number);
    const date = afterRaw.paidDate || changes.find((item) => item.after)?.after;
    const total = afterRaw.totalAmount;
    return `Досрочно закрыты платежи: ${numbers.length ? numbers.map((item) => `№${item}`).join(", ") : "не указаны"}${date ? `. Дата оплаты: ${displayValue("paidDate", date)}` : ""}${total != null ? `. Общая сумма: ${displayValue("amount", total)}` : ""}. Договор закрыт.`;
  }
  if (action.action_type === "cancel_payment") {
    return `У платежа №${number || "—"} отменена отметка об оплате${beforeRaw.paidDate ? ` от ${displayValue("paidDate", beforeRaw.paidDate)}` : ""}. Сумма снова включена в задолженность.`;
  }
  if (["create_payment", "full_payment", "partial_payment"].includes(action.action_type)) {
    const partial = afterRaw.paidAmount != null ? `, внесено ${displayValue("paidAmount", afterRaw.paidAmount)}` : " полностью";
    const paymentComment = Array.isArray(afterRaw.paymentEvents) ? afterRaw.paymentEvents.at(-1)?.comment : "";
    return `Платёж №${number || "—"} отмечен оплаченным${partial}${afterRaw.paidDate ? `, дата ${displayValue("paidDate", afterRaw.paidDate)}` : ""}${paymentComment ? `. Комментарий: ${paymentComment}` : ""}.`;
  }
  if (action.action_type === "change_payment_date") {
    return `У платежа №${number || "—"} дата оплаты изменена: ${displayValue("paidDate", beforeRaw.paidDate)} → ${displayValue("paidDate", afterRaw.paidDate)}.`;
  }
  if (action.action_type === "cancel_whatsapp_notification") {
    return `У платежа №${number || "—"} отменена отметка «Клиент уведомлён»${beforeRaw.notifiedAt ? ` от ${displayValue("notifiedAt", beforeRaw.notifiedAt)}` : ""}.`;
  }
  if (action.action_type === "create_contact") {
    const types = { call: "Звонок", whatsapp: "WhatsApp", meeting: "Встреча", other: "Другое" };
    return `${types[afterRaw.type] || "Контакт"} ${afterRaw.occurredAt ? `от ${formatDateTime(afterRaw.occurredAt)}` : ""}: ${afterRaw.note || "результат не указан"}${afterRaw.promisedDate ? `. Обещанная дата оплаты: ${displayValue("promisedDate", afterRaw.promisedDate)}` : ""}${afterRaw.promisedAmount ? `. Обещанная сумма: ${displayValue("amount", afterRaw.promisedAmount)}` : ""}.`;
  }
  if (action.action_type === "delete_contact") {
    return `Удалена запись о контакте${beforeRaw.occurredAt ? ` от ${formatDateTime(beforeRaw.occurredAt)}` : ""}: ${beforeRaw.note || "без описания"}.`;
  }
  if (action.action_type === "update_payment") {
    const text = describePaymentChanges(beforeRaw, afterRaw);
    if (text) return text;
  }
  if (["create", "move_to_trash", "permanent_delete", "restore"].includes(action.action_type) && action.entity_type === "contracts") {
    const row = action.action_type === "create" || action.action_type === "restore" ? afterRaw : beforeRaw;
    if (row.total_price != null) return `${row.item || "Товар не указан"} · ${money(row.total_price)} · ${row.term_months || "—"} мес.${row.start_date ? ` · первый платёж ${day(row.start_date)}` : ""}`;
  }
  const paymentsText = (beforeRaw.payments || afterRaw.payments) && JSON.stringify(beforeRaw.payments) !== JSON.stringify(afterRaw.payments)
    ? describePaymentChanges(beforeRaw.payments, afterRaw.payments) : "";
  const before = flatten(beforeRaw);
  const after = flatten(afterRaw);
  const ignored = /(^|\.)(id|created_at|updated_at|user_id)$|^payments\./;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !ignored.test(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (!keys.length) return paymentsText || "Без изменения полей";
  return (paymentsText ? `${paymentsText} ` : "") + keys.slice(0, 8).map((key) => {
    if (!(key in before)) return `${fieldLabel(key)}: ${displayValue(key, after[key])}`;
    if (!(key in after)) return `${fieldLabel(key)} удалено`;
    return `${fieldLabel(key)}: ${displayValue(key, before[key])} → ${displayValue(key, after[key])}`;
  }).join("; ") + (keys.length > 8 ? `; ещё изменений: ${keys.length - 8}` : "");
};

const SPECIALIZED_PAYMENT_ACTIONS = new Set([
  "create_payment", "full_payment", "partial_payment", "cancel_payment", "change_payment_date",
  "early_payoff", "defer_payment", "edit_deferral", "cancel_deferral", "whatsapp_notification", "cancel_whatsapp_notification", "attach_receipt",
]);
const logTime = (value) => parseDataDate(value)?.getTime() ?? NaN;

export default function DataCenter({ onClose, onRestored, onContinueDraft, contractFilter: initialContractFilter = null }) {
  const cloud = !isDesktopApp;
  const [contractFilter, setContractFilter] = useState(initialContractFilter);
  const [section, setSection] = useState("journal");
  const [actions, setActions] = useState([]);
  const [trash, setTrash] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [backups, setBackups] = useState([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [actionType, setActionType] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [actionQuery, setActionQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [permanent, setPermanent] = useState(null);
  const [draftDelete, setDraftDelete] = useState(null);
  const [deleteOldDraftsConfirm, setDeleteOldDraftsConfirm] = useState(false);
  const [restoreBackup, setRestoreBackup] = useState(null);
  const [restoreWord, setRestoreWord] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");

  const load = async () => {
    try {
      setError("");
      const [nextActions, nextTrash, nextDrafts, nextBackups] = await Promise.all([
        localData.listActions({ actionType, onlyErrors, contractId: contractFilter?.id || "", from: dateFrom ? `${dateFrom}T00:00:00` : "", to: dateTo ? `${dateTo}T23:59:59` : "" }),
        cloud ? [] : localData.listTrash(), cloud ? [] : localData.listDrafts(), cloud ? [] : localData.listBackups(),
      ]);
      setActions(nextActions); setTrash(nextTrash); setDrafts(nextDrafts); setBackups(nextBackups);
    } catch (e) { setError(e?.message || String(e)); }
  };
  useEffect(() => { load(); }, [actionType, onlyErrors, dateFrom, dateTo, contractFilter?.id]);

  const filteredTrash = useMemo(() => trash.filter((row) => {
    if (type && row.entityType !== type) return false;
    const text = `${TYPE_LABELS[row.entityType] || row.entityType} ${row.item?.client_name || row.item?.name || row.item?.note || ""}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  }), [trash, type, query]);
  const oldDraftCount = useMemo(() => drafts.filter((draft) => Date.now() - logTime(draft.updated_at) > 30 * 86400000).length, [drafts]);

  // Старые версии приложения записывали одно изменение дважды: общей строкой
  // «Изменение платежа» и второй, более точной строкой. В журнале объединяем их,
  // не удаляя исходные аудиторские записи из SQLite.
  const visibleActions = useMemo(() => actions.filter((action) => {
    if (action.action_type !== "update_payment") return true;
    return !actions.some((candidate) => candidate.id !== action.id
      && SPECIALIZED_PAYMENT_ACTIONS.has(candidate.action_type)
      && candidate.contract_id && candidate.contract_id === action.contract_id
      && Math.abs(logTime(candidate.occurred_at) - logTime(action.occurred_at)) <= 2000);
  }), [actions]);

  const restore = async (row) => {
    await localData.restore(row.entityType, row.id);
    await load(); onRestored?.();
  };
  const removeForever = async () => {
    if (!permanent || confirmWord !== "УДАЛИТЬ") return;
    try {
      await localData.createBackup("Перед безвозвратным удалением");
      await localData.permanentlyDelete(permanent.entityType, permanent.id);
      setPermanent(null); setConfirmWord(""); await load();
    } catch (e) { setError(e?.message || String(e)); }
  };

  const exportBackup = async (backup) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Куда сохранить резервную копию" });
      if (!selected) return;
      const target = await localData.exportBackup(backup.name, selected);
      setBackupMessage(`Копия выгружена: ${target}`);
      await load();
    } catch (e) { setError(e?.message || String(e)); }
  };
  const confirmRestore = async () => {
    if (!restoreBackup || restoreWord !== "ВОССТАНОВИТЬ") return;
    try {
      setError("");
      await localData.stageBackupRestore(restoreBackup.name);
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) { setError(e?.message || String(e)); setRestoreBackup(null); setRestoreWord(""); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet data-center-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">{cloud ? "История изменений" : "Данные приложения"}</div>
          <div className="data-header-actions">{cloud ? <button className="btn ghost btn-sm" onClick={load}><RotateCcw size={14}/> Обновить</button> : <button className="btn ghost btn-sm" onClick={async () => { try { const path = await localData.createBackup(); setBackupMessage(`Копия создана: ${path}`); await load(); } catch (e) { setError(e?.message || String(e)); } }}><Download size={14}/> Резервная копия</button>}<button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></div>
        </div>
        {!cloud && <div className="data-center-tabs">
          <button className={section === "journal" ? "on" : ""} onClick={() => setSection("journal")}><History size={15}/> Журнал</button>
          <button className={section === "trash" ? "on" : ""} onClick={() => setSection("trash")}><Trash2 size={15}/> Корзина <span>{trash.length}</span></button>
          <button className={section === "drafts" ? "on" : ""} onClick={() => setSection("drafts")}><FileClock size={15}/> Черновики <span>{drafts.length}</span></button>
          <button className={section === "backups" ? "on" : ""} onClick={() => setSection("backups")}><ShieldCheck size={15}/> Копии <span>{backups.length}</span></button>
        </div>}
        <div className="sheet-body">
          {error && <div className="storage-warn">{error}</div>}
          {backupMessage && <div className="backup-ok">{backupMessage}</div>}
          {section === "journal" && <>
            <div className="data-toolbar">
              {contractFilter && <button className="btn ghost btn-sm" onClick={() => setContractFilter(null)} title="Показать все изменения">Договор: {contractFilter.name || contractFilter.id} <X size={13}/></button>}
              <div className="search-box"><Search size={15}/><input value={actionQuery} onChange={(e) => setActionQuery(e.target.value)} placeholder="Договор или вкладчик…" /></div>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Все объекты</option><option value="contracts">Договоры</option><option value="payments">Платежи</option><option value="contacts">Контакты</option><option value="investors">Вкладчики</option><option value="withdrawals">Выводы</option><option value="receipts">Чеки</option><option value="backup">Резервные копии</option><option value="export">Экспорт</option>
              </select>
              <select value={actionType} onChange={(e) => setActionType(e.target.value)}><option value="">Все действия</option>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Начало периода" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Конец периода" />
              <label><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Только ошибки</label>
            </div>
            <div className="data-list">
              {visibleActions.filter((a) => (!type || a.entity_type === type) && (!actionQuery || `${a.entity_name || ""} ${a.contract_id || ""} ${a.investor_id || ""}`.toLowerCase().includes(actionQuery.toLowerCase()))).map((a) => <div className="data-row journal-row" key={a.id}>
                <div><b>{ACTION_LABELS[a.action_type] || a.action_type}</b><span>{a.entity_name || TYPE_LABELS[a.entity_type] || a.entity_type}</span><small className="action-description">{actionDescription(a)}</small></div>
                <div><span className={`badge ${a.result === "error" ? "b-clay" : "b-emerald"}`}>{a.result === "error" ? "Ошибка" : "Успешно"}</span><small>{formatDateTime(a.occurred_at)} · {a.actor_name || a.source}</small></div>
              </div>)}
              {!visibleActions.length && <div className="empty">{cloud ? "Изменений пока нет. История записывается с 26 октября 2026 года: каждое создание, правка, оплата и удаление появится здесь." : "Журнал пока пуст."}</div>}
            </div>
          </>}
          {section === "trash" && <>
            <div className="data-toolbar">
              <div className="search-box"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск в корзине…" /></div>
              <select value={type} onChange={(e) => setType(e.target.value)}><option value="">Все типы</option><option value="contracts">Договоры</option><option value="investors">Вкладчики</option><option value="withdrawals">Выводы</option><option value="receipts">Чеки</option></select>
            </div>
            <div className="data-list">
              {filteredTrash.map((row) => <div className="data-row" key={`${row.entityType}-${row.id}`}>
                <div><b>{row.item?.client_name || row.item?.name || row.item?.note || "Без названия"}</b><span>{TYPE_LABELS[row.entityType]} · удалено {formatDateTime(row.deleted_at)}</span></div>
                <div className="data-row-actions"><button className="btn ghost btn-sm" onClick={() => restore(row)}><RotateCcw size={13}/> Восстановить</button><button className="icon-btn-ghost" onClick={() => setPermanent(row)} aria-label="Удалить навсегда"><Trash2 size={14}/></button></div>
              </div>)}
              {!filteredTrash.length && <div className="empty">Корзина пуста.</div>}
            </div>
          </>}
          {section === "drafts" && <>
            {oldDraftCount > 0 && <div className="data-toolbar"><span className="muted">Черновиков старше 30 дней: {oldDraftCount}</span><button className="btn ghost btn-sm" onClick={() => setDeleteOldDraftsConfirm(true)}><Trash2 size={13}/> Удалить старые</button></div>}
            <div className="data-list">
            {drafts.map((draft) => <div className="data-row" key={draft.id}>
              <div><b>{draft.title || "Без названия"}</b><span>{draft.draft_type} · заполнено {draft.completion}% · {formatDateTime(draft.updated_at)}</span></div>
              <div className="data-row-actions"><button className="btn ghost btn-sm" onClick={() => onContinueDraft?.(draft)}><ArchiveRestore size={13}/> Продолжить</button><button className="btn ghost btn-sm" onClick={async () => { await localData.saveDraft({ id: `${draft.id}-copy-${Date.now()}`, draftType: draft.draft_type, title: `${draft.title} — копия`, data: draft.data, completion: draft.completion }); await load(); }}>Создать копию</button><button className="icon-btn-ghost" onClick={() => setDraftDelete(draft)} aria-label="Удалить черновик"><Trash2 size={14}/></button></div>
            </div>)}
            {!drafts.length && <div className="empty">Черновиков пока нет.</div>}
            </div>
          </>}
          {section === "backups" && <>
            <div className="data-toolbar backup-toolbar">
              <button className="btn ghost btn-sm" onClick={async () => { try { await localData.revealBackups(); } catch (e) { setError(e?.message || String(e)); } }}><FolderOpen size={14}/> Полные копии</button>
              <button className="btn ghost btn-sm" onClick={async () => { try { await localData.revealExcelBackups(); } catch (e) { setError(e?.message || String(e)); } }}><FileClock size={14}/> Excel-копии</button>
              <span className="muted">Ежедневно при работающем приложении: база, черновики, журнал и вложения, включая корзину. Полные копии сохраняются без автоматического удаления. Excel — последние 90 дней.</span>
            </div>
            <div className="data-list">
              {backups.map((backup) => <div className="data-row" key={backup.name}>
                <div><b>{formatDateTime(backup.createdAt)}</b><span>{backup.reason} · {(backup.size / 1024).toFixed(0)} КБ</span><small>{backup.verified ? "Проверена при создании" : "Старая копия — без файла проверки"}</small></div>
                <div className="data-row-actions"><button className="btn ghost btn-sm" onClick={() => exportBackup(backup)}><HardDriveDownload size={13}/> Сохранить вне Mac</button><button className="btn ghost btn-sm" onClick={() => { setRestoreBackup(backup); setRestoreWord(""); }}><RotateCcw size={13}/> Восстановить</button></div>
              </div>)}
              {!backups.length && <div className="empty">Резервных копий пока нет.</div>}
            </div>
          </>}
        </div>
      </div>
      {permanent && <div className="overlay nested-overlay" onClick={() => setPermanent(null)}>
        <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
          <h3>Удалить навсегда?</h3><p>Объект нельзя будет восстановить. Введите <b>УДАЛИТЬ</b>.</p>
          <input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} autoFocus />
          <div className="sheet-actions"><button className="btn ghost" onClick={() => setPermanent(null)}>Отмена</button><button className="btn danger" disabled={confirmWord !== "УДАЛИТЬ"} onClick={removeForever}>Удалить навсегда</button></div>
        </div>
      </div>}
      {draftDelete && <div className="overlay nested-overlay" onClick={() => setDraftDelete(null)}>
        <div className="confirm-card" onClick={(e) => e.stopPropagation()}><h3>Удалить черновик?</h3><p>Черновик «{draftDelete.title}» будет удалён без влияния на сохранённые договоры.</p><div className="sheet-actions"><button className="btn ghost" onClick={() => setDraftDelete(null)}>Отмена</button><button className="btn danger" onClick={async () => { await localData.deleteDraft(draftDelete.id); setDraftDelete(null); await load(); }}>Удалить черновик</button></div></div>
      </div>}
      {deleteOldDraftsConfirm && <div className="overlay nested-overlay" onClick={() => setDeleteOldDraftsConfirm(false)}>
        <div className="confirm-card" onClick={(e) => e.stopPropagation()}><h3>Удалить старые черновики?</h3><p>Будут удалены черновики, которые не изменялись более 30 дней: {oldDraftCount}. Рабочие договоры не изменятся.</p><div className="sheet-actions"><button className="btn ghost" onClick={() => setDeleteOldDraftsConfirm(false)}>Отмена</button><button className="btn danger" onClick={async () => { await localData.deleteOldDrafts(30); setDeleteOldDraftsConfirm(false); await load(); }}>Удалить старые</button></div></div>
      </div>}
      {restoreBackup && <div className="overlay nested-overlay" onClick={() => setRestoreBackup(null)}>
        <div className="confirm-card" onClick={(e) => e.stopPropagation()}><h3>Восстановить старую копию?</h3><p>Текущая база сначала будет сохранена в новую контрольную копию. Затем приложение закроется. При следующем запуске база и чеки будут восстановлены на состояние от {formatDateTime(restoreBackup.createdAt)}.</p><p className="danger-text">Новые записи, сделанные после этой даты, исчезнут из рабочей базы, но останутся в контрольной копии.</p><p>Введите <b>ВОССТАНОВИТЬ</b>.</p><input value={restoreWord} onChange={(e) => setRestoreWord(e.target.value)} autoFocus/><div className="sheet-actions"><button className="btn ghost" onClick={() => setRestoreBackup(null)}>Отмена</button><button className="btn danger" disabled={restoreWord !== "ВОССТАНОВИТЬ"} onClick={confirmRestore}>Подготовить восстановление</button></div></div>
      </div>}
    </div>
  );
}
