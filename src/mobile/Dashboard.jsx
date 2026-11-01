/* Мобильная «Сводка». Данные и действия — из App (объект app). */

import React, { useState } from "react";
import { Wallet, TrendingUp, CheckCircle2, Users, AlertTriangle, ChevronRight, CalendarDays } from "lucide-react";
import { money, fmtDate, toIsoDate, contractStats, Badge, Ribbon } from "../rassrochki.jsx";
import { formatPhone } from "../phone";
import { waReminderLink } from "../whatsapp";
import { Sheet, SecHd } from "./kit";
import { QuickActions, MStat } from "./parts";

export default function Dashboard({ app }) {
  const {
    totals, received, capital, monthlyStats, contracts, setOpenId, openQuickPay, notifyPayment,
    setSectionModal, setReceivedView, setReceivedOpen, setProfitTotalOpen,
    dailyPayments, dailyError, dailyContacts, daily, visibleUpcoming, showAllUpcoming, setShowAllUpcoming,
  } = app;
  const [periodOpen, setPeriodOpen] = useState(false);
  const today = toIsoDate(new Date());
  const periodLabel = daily.range
    ? `${fmtDate(daily.date)} — ${fmtDate(daily.to)}`
    : daily.date === today ? "сегодня" : fmtDate(daily.date);
  const periodWord = daily.range ? "период" : "день";

  // ссылка WhatsApp и номер платежа для строки «Кто должен оплатить»
  const dailyReminder = (row) => {
    const c = contracts.find((x) => x.id === row.contractId);
    if (!c) return null;
    const st = contractStats(c);
    const pay = st.rows.find((r) => r.n === row.paymentNo);
    if (!pay) return null;
    const url = waReminderLink(row.phone, row.clientName, row.item, pay.remainingDue ?? pay.amountDue, pay.dueDate, pay.status, st.rows);
    return url ? { url, idx: pay.index } : null;
  };

  return (
    <>
      <button type="button" className="m-hero m-press" onClick={() => setSectionModal("remaining")}>
        <span className="m-hero-label">Остаток к получению <ChevronRight size={16} /></span>
        <span className="m-hero-num num">{money(totals.remaining)}</span>
        <Ribbon paid={totals.paid} overdue={totals.overdue} remaining={totals.remaining} />
        <span className="m-legend">
          <span><i className="m-dot s-paid" />Оплачено<b className="num">{money(totals.paid)}</b></span>
          <span><i className="m-dot s-over" />Просрочено<b className="num">{money(totals.overdue)}</b></span>
          <span><i className="m-dot s-rem" />Остаток<b className="num">{money(totals.remaining - totals.overdue)}</b></span>
        </span>
      </button>

      <div className="m-stats">
        <MStat icon={<Wallet size={18} />} label="Получено всего" value={money(received.received)} onClick={() => { setReceivedView("received"); setReceivedOpen(true); }} />
        <MStat icon={<Wallet size={18} />} label="Выдано в рассрочку" value={money(totals.financed)} onClick={() => setSectionModal("financed")} />
        <MStat icon={<TrendingUp size={18} />} label="Общая прибыль" value={money(capital.profitTotal)} onClick={() => setProfitTotalOpen(true)} />
        <MStat icon={<CheckCircle2 size={18} />} label="Прибыль получена" value={money(capital.profitRealized)} onClick={() => { setReceivedView("profit"); setReceivedOpen(true); }} />
        <MStat icon={<Users size={18} />} label="Активных договоров" value={totals.active} onClick={() => setSectionModal("active")} />
        <MStat icon={<AlertTriangle size={18} />} label="Должников (просрочка)" value={totals.debtors}
          tone={totals.debtors ? "clay" : ""} onClick={() => setSectionModal("debtors")} />
      </div>

      <SecHd
        title="Кто должен оплатить"
        count={dailyPayments.rows.length}
        sub={periodLabel}
        action={<button type="button" className="m-btn ghost sm" onClick={() => setPeriodOpen(true)}><CalendarDays size={17} /> {daily.range ? "Период" : "Дата"}</button>}
      />
      {dailyError ? <div className="m-empty" role="alert">{dailyError}</div> : (
        <>
          <div className="m-trio">
            <div><span>Клиентов</span><b className="num">{dailyPayments.clients}</b></div>
            <div><span>Платежей</span><b className="num">{dailyPayments.rows.length}</b></div>
            <div><span>К оплате</span><b className="num">{money(dailyPayments.remaining)}</b></div>
          </div>
          {dailyPayments.rows.length ? (
            <div className="m-list">
              {dailyPayments.rows.map((row) => {
                const rem = dailyReminder(row);
                return (
                  <div key={`${row.contractId}-${row.paymentNo}`} className="m-card m-press" role="button" tabIndex={0} onClick={() => setOpenId(row.contractId)}>
                    <div className="m-row1">
                      <span className="m-name">{row.clientName}</span>
                      <Badge s={row.status} />
                    </div>
                    <div className="m-meta">
                      {row.phone ? formatPhone(row.phone) : "Номер не указан"} · {row.item || "Без товара"} · платёж №{row.paymentNo}{row.dueDate ? ` · срок ${fmtDate(row.dueDate)}` : ""}
                    </div>
                    <div className="m-row2">
                      <span className="m-meta">Текущий платёж</span>
                      <span className="m-amt num">{money(row.remaining)}</span>
                    </div>
                    <div className="m-kv">
                      <span>Общий долг <b className="num">{money(row.totalDebt)}</b></span>
                      {row.overdueDebt > 0 && <span className="clay">из них просрочено <b className="num">{money(row.overdueDebt)}</b></span>}
                    </div>
                    {row.paidAmount > 0 && <div className="m-note amber">Частично внесено {money(row.paidAmount)} из {money(row.amount)}</div>}
                    <div className={`m-note ${row.notifiedAt ? "emerald" : ""}`}>
                      {row.notifiedAt ? `WhatsApp: уведомлён ${fmtDate(row.notifiedAt)}` : "WhatsApp: не уведомлён"}
                    </div>
                    <QuickActions
                      phone={row.phone}
                      waUrl={rem?.url}
                      notified={!!row.notifiedAt}
                      onNotify={(url) => notifyPayment(row.contractId, rem.idx, url)}
                      onPay={() => openQuickPay(row.contractId)}
                    />
                  </div>
                );
              })}
            </div>
          ) : <div className="m-empty">За выбранный {periodWord} неоплаченных платежей по графику нет.</div>}
        </>
      )}

      <SecHd title="Связаться и проверить обещания" count={dailyContacts.length} sub={periodLabel} />
      {dailyContacts.length ? (
        <div className="m-list">
          {dailyContacts.map((row) => (
            <div key={`${row.contractId}-${row.id}`} className="m-card m-press" role="button" tabIndex={0} onClick={() => setOpenId(row.contractId)}>
              <div className="m-row1">
                <span className="m-name">{row.clientName}</span>
                {row.promisedAmount > 0 && <span className="m-amt num m-amt-sm">{money(row.promisedAmount)}</span>}
              </div>
              <div className="m-meta">{row.phone ? formatPhone(row.phone) : "Номер не указан"} · {row.item || "Без товара"}</div>
              {row.note && <div className="m-quote">{row.note}</div>}
              <div className="m-chips m-chips-tight">
                {row.nextContact && <span className="badge b-brass">Связаться · {fmtDate(row.nextContactDate)}</span>}
                {row.promised && <span className="badge b-emerald">Обещал оплатить · {fmtDate(row.promisedDate)}</span>}
              </div>
              <QuickActions phone={row.phone} />
            </div>
          ))}
        </div>
      ) : <div className="m-empty">За выбранный {periodWord} контактов и обещаний нет.</div>}

      <SecHd
        title="Ближайшие платежи"
        count={totals.upcoming.length}
        action={totals.upcoming.length > 8 && (
          <button type="button" className="m-link" onClick={() => setShowAllUpcoming((v) => !v)}>
            {showAllUpcoming ? "Свернуть" : `Все (${totals.upcoming.length})`}
          </button>
        )}
      />
      {totals.upcoming.length === 0 ? (
        <div className="m-empty">Всё оплачено — открытых платежей нет.</div>
      ) : (
        <div className="m-list">
          {visibleUpcoming.map((r) => {
            const url = waReminderLink(r.phone, r.client, r.item, r.remainingDue ?? r.amountDue, r.dueDate, r.status, r.overdueRows);
            return (
              <div key={r.cid + "-" + r.index} className="m-card m-press" role="button" tabIndex={0} onClick={() => setOpenId(r.cid)}>
                <div className="m-row1">
                  <span className="m-name">{r.client}</span>
                  <Badge s={r.status} />
                </div>
                <div className="m-row2">
                  <span className="m-meta">
                    {fmtDate(r.dueDate)}
                    {r.phone && <><br />{formatPhone(r.phone)}</>}
                  </span>
                  <span className="m-amt num">{money(r.amountDue)}</span>
                </div>
                {r.paidAmount > 0 && <div className="m-note amber">Внесено {money(r.paidAmount)} — осталось {money(r.remainingDue)}</div>}
                <QuickActions
                  phone={r.phone}
                  waUrl={url}
                  notified={!!r.notifiedAt}
                  onNotify={(href) => notifyPayment(r.cid, r.index, href)}
                  onPay={() => openQuickPay(r.cid)}
                />
              </div>
            );
          })}
        </div>
      )}

      <SecHd title="По месяцам" sub="Под суммой — прибыль (наценка) в её составе" />
      <div className="m-card m-month">
        <div className="m-mini-hd emerald">Получено</div>
        {monthlyStats.past.map((m) => (
          <MonthRow key={m.key} label={m.label} value={m.received} profit={m.receivedProfit} max={monthlyStats.maxPast} cls="fill-received" />
        ))}
        <div className="m-mini-hd brand m-mini-gap">Ожидается</div>
        {monthlyStats.future.map((m) => (
          <MonthRow key={m.key} label={m.label} value={m.expected} profit={m.expectedProfit} max={monthlyStats.maxFuture} cls="fill-expected" />
        ))}
      </div>

      {periodOpen && <PeriodSheet daily={daily} onClose={() => setPeriodOpen(false)} />}
    </>
  );
}

const MonthRow = ({ label, value, profit, max, cls }) => (
  <div className="m-mrow">
    <span className="m-mlabel">{label}</span>
    <span className="m-mbar"><span className={cls} style={{ width: `${(value / max) * 100}%` }} /></span>
    <span className="m-mval">
      <b className="num">{money(value)}</b>
      <small className="num">приб. {money(profit)}</small>
    </span>
  </div>
);

// выбор дня или периода для «Кто должен оплатить» и «Связаться»
function PeriodSheet({ daily, onClose }) {
  const { date, setDate, range, setRange, to, setTo } = daily;
  return (
    <Sheet
      title="Дата или период"
      onClose={onClose}
      footer={<button type="button" className="m-btn primary block" onClick={onClose}>Готово</button>}
    >
      <div className="m-seg m-gap-b">
        <button type="button" className={!range ? "on" : ""} onClick={() => setRange(false)}>Один день</button>
        <button type="button" className={range ? "on" : ""} onClick={() => { setRange(true); if (to < date) setTo(date); }}>Период</button>
      </div>
      <label className="m-field">
        <span>{range ? "С даты" : "Дата"}</span>
        <input type="date" value={date || ""} max={range ? to || undefined : undefined} onChange={(e) => setDate(e.target.value)} />
      </label>
      {range && (
        <label className="m-field">
          <span>По дату включительно</span>
          <input type="date" value={to || ""} min={date || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
      )}
      <button type="button" className="m-btn ghost block" onClick={() => { const t = toIsoDate(new Date()); setDate(t); setTo(t); setRange(false); }}>
        Сегодня
      </button>
    </Sheet>
  );
}
