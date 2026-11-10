import React, { useEffect, useMemo, useState } from "react";
import {
  Home, ScrollText, Plus, Wallet, Menu, X, Phone, MessageCircle, Banknote, Check,
  ChevronRight, AlertTriangle, Landmark, Users, History, Upload, Download, FileText,
  UserCog, LogOut, Receipt, HardDriveDownload,
} from "lucide-react";
import { expectedPayments, dateInPeriod } from "./expectedPayments";
import { receivedSummary } from "./finance";
import { waReminderLink } from "./whatsapp";
import { normalizePhone } from "./phone";

/*
 * Телефонный вид (ширина до 760px). Здесь только раскладка: все расчёты берутся из тех же
 * функций, что и в широкой версии, а действия (оплата, напоминание, открытие договора)
 * передаются из основного приложения без изменений.
 */

const money = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, days) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return isoDay(d); };
const dayLabel = (iso) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));
const weekdayLabel = (iso) => {
  const text = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const plural = (n, one, few, many) => {
  const v = Math.abs(n) % 100, l = v % 10;
  if (v > 10 && v < 20) return many;
  if (l === 1) return one;
  if (l >= 2 && l <= 4) return few;
  return many;
};

const PERIODS = [["today", "Сегодня"], ["tomorrow", "Завтра"], ["week", "7 дней"]];

/* ---------------- шапка ---------------- */

export function MobileTopBar({ title = "Eppaz", subtitle, children }) {
  return (
    <header className="m-topbar">
      <span className="m-brand" aria-hidden="true">Р</span>
      <div className="m-topbar-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="m-topbar-side">{children}</div>}
    </header>
  );
}

/* ---------------- нижняя панель ---------------- */

export function MobileTabBar({ tab, onTab, onAdd, onMore, moreActive }) {
  const item = (key, Icon, label) => (
    <button type="button" className={tab === key && !moreActive ? "on" : ""} aria-current={tab === key && !moreActive ? "page" : undefined} onClick={() => onTab(key)}>
      <Icon size={22} aria-hidden="true" />{label}
    </button>
  );
  return (
    <nav className="m-tabbar" aria-label="Разделы">
      {item("dashboard", Home, "Главная")}
      {item("contracts", ScrollText, "Договоры")}
      <button type="button" className="m-tab-add" onClick={onAdd} aria-label="Новый договор">
        <span className="m-plus" aria-hidden="true"><Plus size={26} /></span>Договор
      </button>
      {item("cash", Wallet, "Касса")}
      <button type="button" className={moreActive ? "on" : ""} aria-current={moreActive ? "page" : undefined} onClick={onMore}>
        <Menu size={22} aria-hidden="true" />Ещё
      </button>
    </nav>
  );
}

/* ---------------- шторка «Ещё» ---------------- */

export function MSheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("m-no-scroll");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("m-no-scroll"); };
  }, [onClose]);
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <section className="m-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" aria-hidden="true" />
        <header className="m-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="m-icon-btn" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        </header>
        <div className="m-sheet-body">{children}</div>
        {footer && <footer className="m-sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function MobileMoreSheet({ onClose, groups, footer }) {
  return (
    <MSheet title="Ещё" onClose={onClose}>
      {groups.filter((g) => g.items.some(Boolean)).map((group) => (
        <div key={group.title} className="m-menu-group">
          <h3>{group.title}</h3>
          <div className="m-list">
            {group.items.filter(Boolean).map((it) => (
              <button type="button" key={it.key} className={`m-menu-row ${it.tone || ""}`} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
                <span className="m-menu-icon" aria-hidden="true">{it.icon}</span>
                <span className="m-menu-text"><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
                <ChevronRight size={18} className="m-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {footer && <p className="m-foot-note">{footer}</p>}
    </MSheet>
  );
}

export const moreIcons = { Landmark, Users, History, Upload, Download, FileText, UserCog, LogOut, Receipt, HardDriveDownload };

/* ---------------- главная (Сводка) ---------------- */

export function MobileHome({ contracts, getStats, totals, capital, received, monthlyStats, onOpenContract, onPay, onRemind, onSection, onReceived, onProfitTotal }) {
  const today = isoDay(new Date());
  const [period, setPeriod] = useState("today");
  const [showAll, setShowAll] = useState(false);
  const [months, setMonths] = useState("past");
  const range = period === "today" ? { from: today, to: today }
    : period === "tomorrow" ? { from: addDays(today, 1), to: addDays(today, 1) }
    : { from: today, to: addDays(today, 6) };

  const due = useMemo(() => expectedPayments(contracts, getStats, range.from, range.to), [contracts, getStats, range.from, range.to]);
  const collected = useMemo(() => (range.from > today ? 0
    : receivedSummary(contracts, getStats, "", { from: range.from, to: range.to > today ? today : range.to }).received), [contracts, getStats, range.from, range.to, today]);
  const statsById = useMemo(() => new Map(contracts.map((c) => [c.id, getStats(c)])), [contracts, getStats]);
  const contacts = useMemo(() => {
    const rows = [];
    contracts.forEach((contract) => {
      const list = Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : [];
      list.forEach((contact) => {
        const promised = dateInPeriod(contact.promisedDate, range.from, range.to);
        const callback = dateInPeriod(contact.nextContactDate, range.from, range.to);
        if (promised || callback) rows.push({ ...contact, contract, promised, callback });
      });
    });
    return rows.sort((a, b) => String(a.promisedDate || a.nextContactDate).localeCompare(String(b.promisedDate || b.nextContactDate)));
  }, [contracts, range.from, range.to]);

  const word = period === "today" ? "сегодня" : period === "tomorrow" ? "завтра" : "за 7 дней";
  const visible = showAll ? due.rows : due.rows.slice(0, 6);
  const rest = Math.max(0, totals.remaining - totals.overdue);
  const bars = months === "past" ? monthlyStats.past.map((m) => ({ key: m.key, label: m.label.split(" ")[0], value: m.received }))
    : monthlyStats.future.map((m) => ({ key: m.key, label: m.label.split(" ")[0], value: m.expected }));
  const maxBar = Math.max(1, ...bars.map((b) => b.value));

  return (
    <main className="m-screen m-home">
      <section className="m-today" aria-label="Ожидаемые платежи">
        <div className="m-segmented" role="tablist" aria-label="Период">
          {PERIODS.map(([key, label]) => (
            <button type="button" role="tab" key={key} aria-selected={period === key} className={period === key ? "on" : ""} onClick={() => { setPeriod(key); setShowAll(false); }}>{label}</button>
          ))}
        </div>
        <p className="m-today-label">Ждём {word}</p>
        <div className="m-today-sum">{money(due.remaining)}</div>
        <p className="m-today-caption">
          {due.rows.length
            ? `${due.rows.length} ${plural(due.rows.length, "платёж", "платежа", "платежей")} от ${due.clients} ${plural(due.clients, "клиента", "клиентов", "клиентов")}${collected ? ` · уже получено ${money(collected)}` : ""}`
            : collected ? `Получено ${word}: ${money(collected)}` : `Платежей ${word} по графику нет`}
        </p>
        {(due.remaining > 0 || collected > 0) && (
          <>
            <MRibbon parts={[[collected, "paid"], [due.remaining, "rest"]]} />
            <div className="m-legend"><span><i className="paid" />получено</span><span><i className="rest" />ожидается</span></div>
          </>
        )}
        {due.rows.length > 0 && (
          <div className="m-due-list">
            {visible.map((r) => {
              const stats = statsById.get(r.contractId);
              const row = stats?.rows[r.paymentNo - 1];
              const overdueRows = stats ? stats.rows.filter((x) => x.status === "overdue") : [];
              const tel = normalizePhone(r.phone);
              const wa = waReminderLink(r.phone, r.clientName, r.item, r.remaining, row?.dueDate || r.dueDate, r.status, overdueRows);
              return (
                <div className="m-due-row" key={`${r.contractId}:${r.paymentNo}`}>
                  <button type="button" className="m-due-main" onClick={() => onOpenContract(r.contractId)}>
                    <b>{r.clientName}</b>
                    <small>{r.item || "Без товара"}</small>
                    <small className="m-due-flag">
                      {period !== "today" ? `${dayLabel(r.dueDate)} · ` : ""}платёж №{r.paymentNo}
                      {r.status === "overdue" ? <span className="m-bad"> · просрочен</span> : r.paidAmount > 0 ? <span className="m-warn"> · частично</span> : r.notifiedAt ? <span className="m-ok"> · уведомлён</span> : ""}
                    </small>
                  </button>
                  <div className="m-due-amount">{money(r.remaining)}</div>
                  <div className="m-due-actions">
                    {tel
                      ? <a className="m-act" href={`tel:+${tel}`} aria-label={`Позвонить: ${r.clientName}`}><Phone size={18} /></a>
                      : <span className="m-act" aria-hidden="true" data-off="1"><Phone size={18} /></span>}
                    {wa
                      ? <a className={`m-act wa ${r.notifiedAt ? "done" : ""}`} href={wa} target="_blank" rel="noreferrer"
                          aria-label={r.notifiedAt ? `Уведомлён. Напомнить ещё раз в WhatsApp: ${r.clientName}` : `Напомнить в WhatsApp: ${r.clientName}`}
                          onClick={(e) => { e.preventDefault(); onRemind(r.contractId, r.paymentNo - 1, e.currentTarget.href); }}>
                          {r.notifiedAt ? <Check size={18} /> : <MessageCircle size={18} />}
                        </a>
                      : <span className="m-act" aria-hidden="true" data-off="1"><MessageCircle size={18} /></span>}
                    <button type="button" className="m-act pay" aria-label={`Принять оплату: ${r.clientName}`} onClick={() => onPay(r.contractId)}><Banknote size={18} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {due.rows.length > 6 && <button type="button" className="m-today-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Свернуть" : `Показать все ${due.rows.length}`}</button>}
      </section>

      {totals.overdue > 0 && (
        <button type="button" className="m-alert" onClick={() => onSection("debtors")}>
          <AlertTriangle size={22} aria-hidden="true" />
          <span className="m-alert-text">
            <small>Просрочено всего</small>
            <b>{money(totals.overdue)}</b>
            <small>{totals.debtors} {plural(totals.debtors, "должник", "должника", "должников")} — открыть список</small>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      )}

      {contacts.length > 0 && (
        <>
          <h2 className="m-section-h">Обещания и звонки <small>{word}</small></h2>
          <div className="m-list">
            {contacts.map((c) => (
              <button type="button" className="m-list-row" key={`${c.contract.id}:${c.id}`} onClick={() => onOpenContract(c.contract.id)}>
                <span className="m-list-main"><b>{c.contract.clientName}</b><small>{c.note || c.contract.item || ""}</small></span>
                <span className="m-list-end">
                  {c.promised
                    ? <><b>{c.promisedAmount ? money(c.promisedAmount) : "Обещал"}</b><small>оплата {dayLabel(String(c.promisedDate).slice(0, 10))}</small></>
                    : <><b>Связаться</b><small>{dayLabel(String(c.nextContactDate).slice(0, 10))}</small></>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="m-section-h">Портфель</h2>
      <div className="m-metrics">
        <button type="button" className="m-metric wide" onClick={() => onSection("remaining")}>
          <span>Остаток к получению</span>
          <b>{money(totals.remaining)}</b>
          <MRibbon parts={[[totals.paid, "paid"], [totals.overdue, "over"], [rest, "rest"]]} thin />
          <small>Оплачено {money(totals.paid)} · просрочено {money(totals.overdue)}</small>
        </button>
        <button type="button" className="m-metric" onClick={() => onReceived("received")}><span>Получено всего</span><b>{money(received.received)}</b></button>
        <button type="button" className="m-metric" onClick={() => onSection("financed")}><span>Выдано в рассрочку</span><b>{money(totals.financed)}</b></button>
        <button type="button" className="m-metric" onClick={onProfitTotal}><span>Общая прибыль</span><b>{money(capital.profitTotal)}</b></button>
        <button type="button" className="m-metric ok" onClick={() => onReceived("profit")}><span>Прибыль получена</span><b>{money(capital.profitRealized)}</b></button>
        <button type="button" className="m-metric" onClick={() => onSection("active")}><span>Активных договоров</span><b>{totals.active}</b></button>
        <button type="button" className={`m-metric ${totals.debtors ? "bad" : ""}`} onClick={() => onSection("debtors")}><span>Должников</span><b>{totals.debtors}</b></button>
      </div>

      <section className="m-panel">
        <h2>{months === "past" ? "Получено по месяцам" : "Ожидается по месяцам"}</h2>
        <div className="m-segmented" role="tablist" aria-label="Месяцы">
          {[["past", "Полгода назад"], ["future", "Полгода вперёд"]].map(([key, label]) => (
            <button type="button" role="tab" key={key} aria-selected={months === key} className={months === key ? "on" : ""} onClick={() => setMonths(key)}>{label}</button>
          ))}
        </div>
        <div className="m-bars" role="img" aria-label={bars.map((b) => `${b.label}: ${money(b.value)}`).join(", ")}>
          {bars.map((b) => (
            <div className="m-bar-col" key={b.key}>
              <span className="m-bar-val">{b.value ? shortMoney(b.value) : ""}</span>
              <div className={`m-bar ${months === "future" ? "future" : ""}`} style={{ height: `${Math.max(2, (b.value / maxBar) * 80)}%` }} />
              <small>{b.label}</small>
            </div>
          ))}
        </div>
      </section>

      {!contracts.length && <p className="m-empty">Договоров пока нет. Нажмите «+ Договор» внизу экрана, чтобы добавить первый.</p>}
      <p className="m-foot-note">{weekdayLabel(today)}</p>
    </main>
  );
}

const shortMoney = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("ru-RU")} тыс`;
  return String(Math.round(n));
};

export function MRibbon({ parts, thin = false }) {
  const total = Math.max(1, parts.reduce((s, [v]) => s + Math.max(0, v), 0));
  return (
    <div className={`m-ribbon ${thin ? "thin" : ""}`} aria-hidden="true">
      {parts.map(([v, tone]) => <span key={tone} className={tone} style={{ width: `${(Math.max(0, v) / total) * 100}%` }} />)}
    </div>
  );
}

export { weekdayLabel, money as mMoney, plural as mPlural, dayLabel as mDayLabel, isoDay as mIsoDay };
