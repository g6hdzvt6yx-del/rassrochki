/* Мобильный список договоров. Фильтрация, сортировка и все действия — из App (объект app). */

import React, { useState } from "react";
import {
  Search, X, SlidersHorizontal, AlertTriangle, CalendarDays, CheckCircle2, MessageCircle, Check, ScrollText,
  ChevronDown, Users, Download, RotateCcw, ListChecks, ClipboardList,
} from "lucide-react";
import { money, fmtDate, paymentWord, toIsoDate, contractStats, Badge, Ribbon, ContactEntries } from "../rassrochki.jsx";
import { formatPhone } from "../phone";
import { waReminderLink } from "../whatsapp";
import { overdueDays, daysLabel } from "../contractWorkbench";
import { SORT_OPTIONS, DIRECTIONAL_SORTS } from "../contractSort";
import { MARK_FILTER_OPTIONS, toggleMarkStatus } from "../operatorMarks";
import { OperatorMarkSummary } from "../OperatorMarks.jsx";
import { Sheet } from "./kit";
import { QuickActions } from "./parts";

const STATUS_CHIPS = [["all", "Все"], ["active", "Активные"], ["overdue", "Просрочка"], ["done", "Закрытые"]];
const WORK_VIEWS = [["calls", "Сегодня звонить"], ["large", "Крупные долги"], ["promised", "Обещали оплатить"]];
const WORK_HINTS = {
  large: "Просрочка от 100 000 ₽, по убыванию остатка долга",
  promised: "Незакрытые договоры с обещанием на сегодня или будущую дату",
  calls: "Контакты и обещания на сегодня или раньше; просрочки без уведомления за 72 часа",
};

// сколько дополнительных фильтров включено (как на компьютере)
export const advancedFilterCount = (app) =>
  [app.investorFilter, app.contactFilter, app.notificationFilter, app.deferralFilter, app.markAuthor].filter((v) => v !== "all").length
  + (app.markStatuses.length ? 1 : 0);

export const anyFilterOn = (app) => Boolean(app.workView || app.search || app.statusFilter !== "all" || app.investorFilter !== "all"
  || app.contactFilter !== "all" || app.notificationFilter !== "all" || app.deferralFilter !== "all" || app.markFilterActive || app.sortBy !== "created");

// сброс — те же действия, что у кнопки «Сбросить фильтры» на компьютере
export const resetFilters = (app) => {
  app.setWorkView(""); app.setSearch(""); app.setStatusFilter("all"); app.setInvestorFilter("all"); app.setContactFilter("all");
  app.setNotificationFilter("all"); app.setDeferralFilter("all"); app.setMarkStatuses([]); app.setMarkAuthor("all");
  app.setSortBy("created"); app.setSortDir("desc");
};

// поиск и статусы — в шапке экрана
export function ContractsToolbar({ app }) {
  const { search, setSearch, statusFilter, setStatusFilter, filterCounts } = app;
  return (
    <div className="m-toolbar">
      <div className="m-search">
        <Search size={18} />
        <input type="search" enterKeyHint="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Имя, телефон, товар или заметка" aria-label="Поиск договоров" />
        {search && <button type="button" className="m-search-clear" onClick={() => setSearch("")} aria-label="Очистить"><X size={16} /></button>}
      </div>
      <div className="m-chips m-chips-scroll">
        {STATUS_CHIPS.map(([key, label]) => (
          <button key={key} type="button" className={`m-chip ${statusFilter === key ? "on" : ""}`} onClick={() => setStatusFilter(key)}>
            {label} <i>{filterCounts[key]}</i>
          </button>
        ))}
      </div>
    </div>
  );
}

// иконки справа в шапке: выбор и фильтры
export function ContractsActions({ app, selecting, setSelecting, openFilters }) {
  const n = advancedFilterCount(app) + (app.sortBy !== "created" ? 1 : 0);
  return (
    <>
      <button type="button" className={`m-ib ${selecting ? "on" : ""}`} onClick={() => setSelecting(!selecting)}
        aria-pressed={selecting} aria-label="Выбрать договоры для напоминаний"><ListChecks size={20} /></button>
      <button type="button" className="m-ib" onClick={openFilters} aria-label="Сортировка и фильтры">
        <SlidersHorizontal size={20} />{n > 0 && <i className="m-ib-count">{n}</i>}
      </button>
    </>
  );
}

export default function Contracts({ app, selecting, setSelecting, openFilters }) {
  const {
    contracts, filteredContracts, groupedContracts, filteredSummary, workView, setWorkView, setSearch, setStatusFilter,
    setInvestorFilter, setContactFilter, setNotificationFilter, setDeferralFilter, setMarkStatuses, setMarkAuthor, setSortBy, setSortDir,
    setAdding, selectedIds, setSelectedIds, visibleSelected, reminderFor, beginReminders, exportFilteredContracts,
  } = app;
  const [summaryOpen, setSummaryOpen] = useState(false);

  if (contracts.length === 0) {
    return (
      <div className="m-empty">
        Договоров пока нет — добавьте первый.
        <button type="button" className="m-btn primary block m-empty-btn" onClick={() => setAdding(true)}>Новый договор</button>
      </div>
    );
  }

  // быстрые виды — те же действия, что на компьютере
  const chooseView = (key) => {
    setWorkView(workView === key ? "" : key); setSearch(""); setStatusFilter("all"); setInvestorFilter("all"); setContactFilter("all");
    setNotificationFilter("all"); setDeferralFilter("all"); setMarkStatuses([]); setMarkAuthor("all");
    setSortBy(key === "large" ? "remaining" : "dueDate"); setSortDir("desc");
  };
  const allSelected = filteredContracts.length > 0 && visibleSelected.length === filteredContracts.length;
  const withReminder = visibleSelected.filter(reminderFor).length;
  const withoutReminder = visibleSelected.length - withReminder;

  return (
    <>
      <div className="m-chips m-chips-scroll m-views" aria-label="Сохранённые виды">
        {WORK_VIEWS.map(([key, label]) => (
          <button key={key} type="button" className={`m-chip ${workView === key ? "on" : ""}`} aria-pressed={workView === key} onClick={() => chooseView(key)}>
            {label}
          </button>
        ))}
      </div>
      {workView && <div className="m-hint m-view-hint">{WORK_HINTS[workView]}</div>}
      {anyFilterOn(app) && (
        <div className="m-filter-line">
          <button type="button" className="m-filter-what" onClick={openFilters}><SlidersHorizontal size={15} /> Фильтры и сортировка</button>
          <button type="button" className="m-link" onClick={() => resetFilters(app)}><RotateCcw size={14} /> Сбросить</button>
        </div>
      )}

      <button type="button" className="m-card m-summary" onClick={() => setSummaryOpen(!summaryOpen)} aria-expanded={summaryOpen}>
        <span className="m-row1">
          <span className="m-summary-main">
            <span className="m-meta">Итого по выборке · {filteredContracts.length}</span>
            <b className="num">Остаток {money(filteredSummary.remaining)}</b>
          </span>
          <ChevronDown size={18} className={`m-chev ${summaryOpen ? "on" : ""}`} />
        </span>
        {filteredSummary.overdue > 0 && <span className="m-note clay">Просрочка <b className="num">{money(filteredSummary.overdue)}</b></span>}
        {summaryOpen && (
          <span className="m-grid2 m-summary-grid">
            <span><span>Договоров</span><b className="num">{filteredContracts.length}</b></span>
            <span><span>Сумма договоров</span><b className="num">{money(filteredSummary.financed)}</b></span>
            <span><span>Прибыль получена</span><b className="num">{money(filteredSummary.profitReceived)}</b></span>
            <span><span>Прибыль ожидается</span><b className="num">{money(filteredSummary.profitExpected)}</b></span>
          </span>
        )}
      </button>

      {selecting && (
        <div className="m-select-bar">
          <label className="m-check">
            <input type="checkbox" checked={allSelected} onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredContracts.map((c) => c.id)) : new Set())} />
            Выбрать все в списке ({filteredContracts.length})
          </label>
          {withoutReminder > 0 && <div className="m-hint">Без номера или открытого платежа: {withoutReminder}</div>}
        </div>
      )}

      {filteredContracts.length === 0 ? (
        <div className="m-empty">Ничего не найдено по этому запросу или фильтру.</div>
      ) : (
        <div className="m-list">
          {groupedContracts.map((g) => (g.list.length === 1 ? (
            <ContractCard key={g.list[0].id} c={g.list[0]} app={app} selecting={selecting} />
          ) : (
            <div key={"g-" + g.key} className="m-group">
              <div className="m-group-hd">
                <span className="m-group-name"><Users size={16} /> {g.list[0].clientName}</span>
                <span className="m-group-stats">Договоров: {g.list.length} · Остаток <b className="num">{money(g.remaining)}</b></span>
              </div>
              <div className="m-list">
                {g.list.map((c) => <ContractCard key={c.id} c={c} app={app} selecting={selecting} />)}
              </div>
            </div>
          )))}
        </div>
      )}

      <button type="button" className="m-btn ghost block m-export" disabled={!filteredContracts.length} onClick={exportFilteredContracts}>
        <Download size={17} /> Экспорт списка ({filteredContracts.length})
      </button>

      {selecting && visibleSelected.length > 0 && (
        <div className="m-action-bar">
          <button type="button" className="m-btn ghost sm" onClick={() => setSelectedIds(new Set())}>Снять ({visibleSelected.length})</button>
          <button type="button" className="m-btn primary sm" disabled={!withReminder} onClick={beginReminders}>
            <MessageCircle size={17} /> Напомнить в WhatsApp ({withReminder})
          </button>
        </div>
      )}
    </>
  );
}

function ContractCard({ c, app, selecting }) {
  const { investors, expandedId, setExpandedId, expandedClientContacts, contractMarks, setMarksHistoryId, notifyPayment,
    openQuickPay, setOpenId, selectedIds, toggleSelected } = app;
  const st = contractStats(c);
  const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
  const expanded = expandedId === c.id;
  const overdueRows = st.rows.filter((r) => r.status === "overdue");
  const upcomingRows = st.rows.filter((r) => !r.paid && r.status !== "overdue");
  const paidRows = st.rows.filter((r) => r.paid);
  const investorLabel = c.investorId ? (investors.find((i) => i.id === c.investorId)?.name || "—") : "Общий пул";
  const reminderUrl = st.next
    ? waReminderLink(c.phone, c.clientName, c.item, st.next.remainingDue ?? st.next.amountDue, st.next.dueDate, st.next.status, st.rows)
    : null;
  const selected = selectedIds.has(c.id);
  const today = toIsoDate(new Date());

  return (
    <div className={`m-card m-ccard ${overdueRows.length ? "has-overdue" : ""} ${selected ? "selected" : ""}`}>
      <div className="m-cc-main" role="button" tabIndex={0} onClick={() => (selecting ? toggleSelected(c.id) : setOpenId(c.id))}>
        <div className="m-row1">
          {selecting && <input type="checkbox" className="m-cc-check" checked={selected} onChange={() => toggleSelected(c.id)} onClick={(e) => e.stopPropagation()} aria-label={`Выбрать ${c.clientName}`} />}
          <span className="m-name">{c.clientName}</span>
          {!st.overdueSum && <Badge s={badge} />}
        </div>
        <div className="m-meta m-cc-sub">
          {[c.item, c.phone ? formatPhone(c.phone) : "номер не указан", c.investorId ? investorLabel : null].filter(Boolean).join(" · ")}
        </div>

        {overdueRows.length > 0 ? (
          <div className="m-overdue">
            <span className="m-overdue-hd"><AlertTriangle size={16} /> Просрочка {daysLabel(overdueDays(st.rows))}</span>
            <b className="num">{money(st.overdueSum)}</b>
            <span className="m-overdue-meta">{overdueRows.length} {paymentWord(overdueRows.length)} · с {fmtDate(overdueRows[0].dueDate)}</span>
          </div>
        ) : (
          <div className={`m-next ${st.done ? "closed" : ""}`}>
            {st.done ? <CheckCircle2 size={15} /> : <CalendarDays size={15} />}
            <span>
              {st.done ? "Договор полностью закрыт"
                : st.next && toIsoDate(st.next.dueDate) === today ? "Сегодня к оплате"
                  : st.next ? `Платёж ${fmtDate(st.next.dueDate)}` : "Платежей нет"}
            </span>
            {st.next && <b className="num">{money(st.next.remainingDue)}</b>}
          </div>
        )}

        <div className="m-row2 m-cc-rem">
          <span className="m-meta">Остаток</span>
          <span className="m-amt num">{money(st.remaining)}</span>
        </div>
        <Ribbon paid={st.paidSum} overdue={st.overdueSum} remaining={st.remaining} />

        {(reminderUrl || st.next?.notifiedAt) && (
          <div className={`m-note ${st.next?.notifiedAt ? "emerald" : ""}`}>
            {st.next?.notifiedAt ? <Check size={13} /> : <MessageCircle size={13} />} WhatsApp · {st.next?.notifiedAt ? `уведомлён ${fmtDate(st.next.notifiedAt)}` : "напомнить об оплате"}
          </div>
        )}
        {st.deferrals.length > 0 && (
          <div className="m-note brand">
            <CalendarDays size={13} /> Отсрочка до {fmtDate(st.deferrals[0].dueDate)}
            {st.deferrals[0].deferralReason ? ` · ${st.deferrals[0].deferralReason}` : ""}
            {st.deferrals[0].deferralHistory?.length > 1 ? ` · переносов ${st.deferrals[0].deferralHistory.length}` : ""}
            {st.deferrals.length > 1 ? ` · платежей ${st.deferrals.length}` : ""}
          </div>
        )}
        {c.comment?.trim() && <div className="m-cc-comment"><ScrollText size={13} /><span>{c.comment.trim()}</span></div>}
        <div className="m-cc-marks" onClick={(e) => e.stopPropagation()}>
          <OperatorMarkSummary marks={contractMarks[c.id]} onHistory={() => setMarksHistoryId(c.id)} />
        </div>
      </div>

      {!selecting && (
        <div className="m-cc-acts">
          <QuickActions
            phone={c.phone}
            waUrl={reminderUrl}
            notified={!!st.next?.notifiedAt}
            onNotify={(url) => notifyPayment(c.id, st.next.index, url)}
            onPay={!st.done && st.next ? () => openQuickPay(c.id) : null}
          />
        </div>
      )}
      <button type="button" className="m-cc-toggle" onClick={() => setExpandedId(expanded ? null : c.id)} aria-expanded={expanded}>
        Подробнее: график и контакты <ChevronDown size={18} className={`m-chev ${expanded ? "on" : ""}`} />
      </button>
      {expanded && (
        <div className="m-cc-exp">
          <div className="m-mini-hd">Комментарий</div>
          <p className="m-cc-text">{c.comment?.trim() || "Комментарий не добавлен"}</p>
          <div className="m-mini-hd m-mini-gap">История контактов · {expandedClientContacts.length ? `записей: ${expandedClientContacts.length}` : "контактов пока нет"}</div>
          <ContactEntries contacts={expandedClientContacts} contractId={c.id} />
          <div className="m-mini-row m-mini-gap"><span>Дата составления договора</span><b className="num">{c.contractDate ? fmtDate(c.contractDate) : "не указана"}</b></div>
          {st.deferrals.length > 0 && (
            <>
              <div className="m-mini-hd brand m-mini-gap">Отсрочка</div>
              {st.deferrals.map((r) => (
                <div key={r.index} className="m-mini-row">
                  <span>Платёж №{r.n}: {fmtDate(r.scheduledDueDate)} → {fmtDate(r.dueDate)}<small>{r.deferralReason ? `Причина: ${r.deferralReason}` : "Причина не указана"}</small></span>
                  <span className="num">{money(r.remainingDue)}</span>
                </div>
              ))}
            </>
          )}
          <MiniList title="Просрочено" cls="clay" rows={overdueRows} amount={(r) => r.remainingDue} />
          <MiniList title="Предстоящие" rows={upcomingRows} amount={(r) => r.remainingDue} />
          <MiniList title="История платежей" cls="emerald" rows={paidRows} amount={(r) => r.amountDue} />
          <button type="button" className="m-btn ghost block m-cc-open" onClick={() => setOpenId(c.id)}>Карточка клиента</button>
        </div>
      )}
    </div>
  );
}

const MiniList = ({ title, cls = "", rows, amount }) => (rows.length ? (
  <>
    <div className={`m-mini-hd ${cls} m-mini-gap`}>{title}</div>
    {rows.map((r) => <div key={r.index} className="m-mini-row"><span>{fmtDate(r.dueDate)}</span><span className="num">{money(amount(r))}</span></div>)}
  </>
) : null);

/* --------------------------- Фильтры и сортировка ------------------- */

const Select = ({ label, value, onChange, children }) => (
  <label className="m-field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></label>
);

export function FiltersSheet({ app, onClose }) {
  const {
    sortBy, setSortBy, sortDir, setSortDir, investorFilter, setInvestorFilter, investors, contactFilter, setContactFilter,
    notificationFilter, setNotificationFilter, deferralFilter, setDeferralFilter, markStatuses, setMarkStatuses,
    markAuthor, setMarkAuthor, markAuthorOptions, filteredContracts,
  } = app;
  return (
    <Sheet
      title="Сортировка и фильтры"
      onClose={onClose}
      className="tall"
      footer={
        <div className="m-ft-row">
          <button type="button" className="m-btn ghost" onClick={() => resetFilters(app)}><RotateCcw size={16} /> Сбросить</button>
          <button type="button" className="m-btn primary" onClick={onClose}>Показать · {filteredContracts.length}</button>
        </div>
      }
    >
      <Select label="Сортировка" value={sortBy} onChange={(v) => { setSortBy(v); setSortDir("desc"); }}>
        {SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </Select>
      {DIRECTIONAL_SORTS.has(sortBy) && (
        <div className="m-seg m-gap-b" role="group" aria-label="Направление сортировки">
          <button type="button" className={sortDir === "desc" ? "on" : ""} onClick={() => setSortDir("desc")}>↓ по убыванию</button>
          <button type="button" className={sortDir === "asc" ? "on" : ""} onClick={() => setSortDir("asc")}>↑ по возрастанию</button>
        </div>
      )}
      <Select label="Источник финансирования" value={investorFilter} onChange={setInvestorFilter}>
        <option value="all">Все источники</option>
        <option value="">Общий пул</option>
        {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
      </Select>
      <Select label="Контакты" value={contactFilter} onChange={setContactFilter}>
        <option value="all">Все контакты</option>
        <option value="has">Есть история контактов</option>
        <option value="none">Без контактов</option>
      </Select>
      <Select label="Уведомления" value={notificationFilter} onChange={setNotificationFilter}>
        <option value="all">Все уведомления</option>
        <option value="notified">Текущий платёж уведомлён</option>
        <option value="unnotified">Текущий платёж не уведомлён</option>
        <option value="stale">Не уведомлены за 3 дня</option>
      </Select>
      <Select label="Отсрочка" value={deferralFilter} onChange={setDeferralFilter}>
        <option value="all">Все</option>
        <option value="active">Действует</option>
        <option value="expired">Срок прошёл</option>
        <option value="none">Без отсрочки</option>
      </Select>
      <div className="m-field">
        <span><ClipboardList size={14} /> Отметки оператора · можно несколько</span>
        <div className="m-chips">
          <button type="button" className={`m-chip ${!markStatuses.length ? "on" : ""}`} aria-pressed={!markStatuses.length} onClick={() => setMarkStatuses([])}>Все</button>
          {MARK_FILTER_OPTIONS.map(([key, label]) => (
            <button type="button" key={key} className={`m-chip ${markStatuses.includes(key) ? "on" : ""}`} aria-pressed={markStatuses.includes(key)}
              onClick={() => setMarkStatuses((prev) => toggleMarkStatus(prev, key))}>{label}</button>
          ))}
        </div>
        {markStatuses.length > 1 && <div className="m-field-hint">Показаны договоры, где последняя отметка подходит под любой из выбранных вариантов.</div>}
      </div>
      <Select label="Отметки сотрудника" value={markAuthor} onChange={setMarkAuthor}>
        <option value="all">Все сотрудники</option>
        {markAuthorOptions.map((author) => <option key={author.key} value={author.key}>{author.name} ({author.count})</option>)}
        {markAuthor !== "all" && !markAuthorOptions.some((author) => author.key === markAuthor) && <option value={markAuthor}>Сотрудник без отметок</option>}
      </Select>
    </Sheet>
  );
}
