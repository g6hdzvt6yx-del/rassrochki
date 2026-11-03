import React, { useState } from "react";
import {
  Search, X, SlidersHorizontal, CheckSquare, Phone, MessageCircle, Check, Users,
  AlertTriangle, CalendarDays, CheckCircle2, History, ScrollText, Download, RotateCcw, ChevronRight,
} from "lucide-react";
import { MSheet, MRibbon, mMoney as money, mPlural as plural, mDayLabel as dayLabel, mIsoDay as isoDay } from "./MobileShell";
import { waReminderLink } from "./whatsapp";
import { normalizePhone } from "./phone";
import { overdueDays, daysLabel } from "./contractWorkbench";
import { MARK_FILTER_OPTIONS, MARK_TONE, markLabel, toggleMarkStatus } from "./operatorMarks";
import { SORT_OPTIONS, DIRECTIONAL_SORTS } from "./contractSort";

/*
 * Экран «Договоры» на телефоне (до 760px). Список, фильтры, сортировка, выбор и напоминания —
 * те же самые, что в широкой версии: состояние и действия приходят из основного приложения.
 * Здесь только раскладка.
 */

const STATUSES = [["all", "Все"], ["active", "Активные"], ["overdue", "Просрочка"], ["done", "Закрытые"]];
const VIEWS = [["calls", "Сегодня звонить"], ["large", "Крупные долги"], ["promised", "Обещали оплатить"]];
const VIEW_HINTS = {
  calls: "Контакты и обещания на сегодня или раньше; просрочки без уведомления за 72 часа",
  large: "Просрочка от 100 000 ₽, по убыванию остатка долга",
  promised: "Незакрытые договоры с обещанием на сегодня или будущую дату",
};
const CONTACT_OPTIONS = [["all", "Все"], ["has", "Есть история"], ["none", "Без контактов"]];
const NOTIFY_OPTIONS = [["all", "Все уведомления"], ["notified", "Текущий платёж уведомлён"], ["unnotified", "Текущий платёж не уведомлён"], ["stale", "Не уведомлены за 3 дня"]];
const DEFERRAL_OPTIONS = [["all", "Все"], ["active", "Действует"], ["expired", "Срок прошёл"], ["none", "Без отсрочки"]];

const markDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d);
};

export default function MobileContracts({
  total, list, groups, getStats, investors, counts, summary, periodPanel, f, marks, onMarksHistory,
  selection, onOpen, onPay, onRemind, onExport, onAdd,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const extraFilters = [f.investorFilter, f.contactFilter, f.notificationFilter, f.deferralFilter, f.markAuthor].filter((v) => v !== "all").length
    + (f.markStatuses.length ? 1 : 0) + (f.sortBy !== "created" ? 1 : 0);
  const selectedCount = selection.visibleSelected.length;
  const remindable = selection.visibleSelected.filter(selection.reminderFor).length;
  const allSelected = list.length > 0 && selectedCount === list.length;
  const stopSelecting = () => { setSelecting(false); selection.setSelectedIds(new Set()); };

  if (!total) {
    return (
      <main className="m-screen m-contracts">
        <div className="m-empty-card">
          <b>Договоров пока нет</b>
          <p>Добавьте первый договор — кнопка «+ Договор» внизу экрана.</p>
          <button type="button" className="m-btn primary" onClick={onAdd}>Создать договор</button>
        </div>
      </main>
    );
  }

  return (
    <main className={`m-screen m-contracts ${selecting ? "selecting" : ""}`}>
      <div className="m-toolbar">
        <div className="m-search-row">
          <label className="m-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" value={f.search} onChange={(e) => f.setSearch(e.target.value)} placeholder="Имя, телефон, товар, заметка" aria-label="Поиск договоров" enterKeyHint="search" />
            {f.search && <button type="button" onClick={() => f.setSearch("")} aria-label="Очистить поиск"><X size={18} /></button>}
          </label>
          <button type="button" className={`m-tool-btn ${extraFilters ? "on" : ""}`} aria-label={`Сортировка и фильтры${extraFilters ? `, включено: ${extraFilters}` : ""}`} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={20} />{extraFilters > 0 && <span className="m-dot-count">{extraFilters}</span>}
          </button>
          <button type="button" className={`m-tool-btn ${selecting ? "on" : ""}`} aria-pressed={selecting} aria-label={selecting ? "Закончить выбор" : "Выбрать договоры для напоминания"} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            {selecting ? <X size={20} /> : <CheckSquare size={20} />}
          </button>
        </div>
      </div>
      <div className="m-toolbar-chips">
        <div className="m-chips m-chips-scroll" role="group" aria-label="Статус">
          {STATUSES.map(([key, label]) => (
            <button type="button" key={key} className={`m-chip ${f.statusFilter === key ? "on" : ""}`} aria-pressed={f.statusFilter === key} onClick={() => f.setStatusFilter(key)}>
              {label}<span className="m-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="m-chips m-chips-scroll" role="group" aria-label="Быстрые подборки">
          {VIEWS.map(([key, label]) => (
            <button type="button" key={key} className={`m-chip view ${f.workView === key ? "on" : ""}`} aria-pressed={f.workView === key} onClick={() => f.chooseWorkView(key)}>{label}</button>
          ))}
        </div>
      </div>

      {f.workView && <p className="m-hint">{VIEW_HINTS[f.workView]}</p>}

      {periodPanel}
      <button type="button" className="m-summary" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>
        <span><b>{list.length}</b> {plural(list.length, "договор", "договора", "договоров")}</span>
        <span>Остаток <b>{money(summary.remaining)}</b></span>
        {summary.overdue > 0 && <span>Просрочка <b className="m-bad">{money(summary.overdue)}</b></span>}
        <ChevronRight size={16} className={`m-summary-chev ${summaryOpen ? "on" : ""}`} aria-hidden="true" />
      </button>
      {summaryOpen && (
        <dl className="m-summary-more">
          <dt>Сумма договоров</dt><dd>{money(summary.financed)}</dd>
          <dt>Остаток</dt><dd>{money(summary.remaining)}</dd>
          <dt>Прибыль получена</dt><dd className="m-ok">{money(summary.profitReceived)}</dd>
          <dt>Прибыль ожидается</dt><dd>{money(summary.profitExpected)}</dd>
          {summary.overdue > 0 && <><dt>Просрочка</dt><dd className="m-bad">{money(summary.overdue)}</dd></>}
        </dl>
      )}

      {list.length === 0 ? (
        <div className="m-empty-card">
          <b>Ничего не найдено</b>
          <p>Измените поиск или фильтры.</p>
          {f.anyActive && <button type="button" className="m-btn" onClick={f.reset}><RotateCcw size={16} /> Сбросить фильтры</button>}
        </div>
      ) : groups.map((g) => {
        const cards = g.list.map((c) => (
          <ContractCard key={c.id} contract={c} stats={getStats(c)} investors={investors} marks={marks[c.id]}
            selecting={selecting} selected={selection.selectedIds.has(c.id)}
            onToggle={() => selection.toggleSelected(c.id)} onOpen={() => onOpen(c.id)} onPay={() => onPay(c.id)}
            onRemind={onRemind} onMarksHistory={() => onMarksHistory(c.id)} />
        ));
        if (g.list.length === 1) return cards[0];
        return (
          <section key={`g-${g.key}`} className="m-cgroup" aria-label={`Клиент ${g.list[0].clientName}`}>
            <header className="m-cgroup-hd">
              <Users size={16} aria-hidden="true" />
              <b>{g.list[0].clientName}</b>
              <small>{g.list.length} {plural(g.list.length, "договор", "договора", "договоров")} · {money(g.remaining)}</small>
            </header>
            {cards}
          </section>
        );
      })}

      {selecting && (
        <div className="m-select-bar" role="region" aria-label="Выбранные договоры">
          <span className="m-select-info">
            <b>Выбрано: {selectedCount}</b>
            {selectedCount > remindable && <small>без номера или платежа: {selectedCount - remindable}</small>}
          </span>
          <button type="button" className="m-btn sm" onClick={() => selection.setSelectedIds(allSelected ? new Set() : new Set(list.map((c) => c.id)))}>{allSelected ? "Снять" : "Все"}</button>
          <button type="button" className="m-btn sm primary" disabled={!remindable} onClick={selection.beginReminders}><MessageCircle size={17} /> Напомнить{remindable ? ` (${remindable})` : ""}</button>
        </div>
      )}

      {filtersOpen && (
        <MSheet title="Сортировка и фильтры" onClose={() => setFiltersOpen(false)}
          footer={<button type="button" className="m-btn primary block" onClick={() => setFiltersOpen(false)}>Показать {list.length} {plural(list.length, "договор", "договора", "договоров")}</button>}>
          <div className="m-field">
            <span className="m-field-label">Сортировать</span>
            <div className="m-chips">
              {SORT_OPTIONS.map(([key, label]) => (
                <button type="button" key={key} className={`m-chip ${f.sortBy === key ? "on" : ""}`} aria-pressed={f.sortBy === key} onClick={() => { f.setSortBy(key); f.setSortDir("desc"); }}>{label}</button>
              ))}
            </div>
            {DIRECTIONAL_SORTS.has(f.sortBy) && (
              <div className="m-segmented m-mt8" role="group" aria-label="Направление">
                <button type="button" className={f.sortDir === "desc" ? "on" : ""} aria-pressed={f.sortDir === "desc"} onClick={() => f.setSortDir("desc")}>↓ По убыванию</button>
                <button type="button" className={f.sortDir === "asc" ? "on" : ""} aria-pressed={f.sortDir === "asc"} onClick={() => f.setSortDir("asc")}>↑ По возрастанию</button>
              </div>
            )}
          </div>
          <label className="m-field">
            <span className="m-field-label">Источник финансирования</span>
            <select className="m-select" value={f.investorFilter} onChange={(e) => f.setInvestorFilter(e.target.value)}>
              <option value="all">Все источники</option>
              <option value="">Общий пул</option>
              {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
            </select>
          </label>
          <ChipField label="История контактов" options={CONTACT_OPTIONS} value={f.contactFilter} onChange={f.setContactFilter} />
          <label className="m-field">
            <span className="m-field-label">Уведомления в WhatsApp</span>
            <select className="m-select" value={f.notificationFilter} onChange={(e) => f.setNotificationFilter(e.target.value)}>
              {NOTIFY_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <ChipField label="Отсрочка" options={DEFERRAL_OPTIONS} value={f.deferralFilter} onChange={f.setDeferralFilter} />
          <div className="m-field">
            <span className="m-field-label">Отметки оператора — можно выбрать несколько</span>
            <div className="m-chips">
              <button type="button" className={`m-chip ${!f.markStatuses.length ? "on" : ""}`} aria-pressed={!f.markStatuses.length} onClick={() => f.setMarkStatuses([])}>Все</button>
              {MARK_FILTER_OPTIONS.map(([key, label]) => (
                <button type="button" key={key} className={`m-chip ${f.markStatuses.includes(key) ? "on" : ""}`} aria-pressed={f.markStatuses.includes(key)} onClick={() => f.setMarkStatuses((prev) => toggleMarkStatus(prev, key))}>{label}</button>
              ))}
            </div>
            {f.markStatuses.length > 1 && <small className="m-field-hint">Показаны договоры, где последняя отметка подходит под любой из выбранных вариантов.</small>}
          </div>
          <label className="m-field">
            <span className="m-field-label">Сотрудник, поставивший отметку</span>
            <select className="m-select" value={f.markAuthor} onChange={(e) => f.setMarkAuthor(e.target.value)}>
              <option value="all">Все сотрудники</option>
              {f.markAuthorOptions.map((a) => <option key={a.key} value={a.key}>{a.name} ({a.count})</option>)}
              {f.markAuthor !== "all" && !f.markAuthorOptions.some((a) => a.key === f.markAuthor) && <option value={f.markAuthor}>Сотрудник без отметок</option>}
            </select>
          </label>
          <div className="m-sheet-actions">
            <button type="button" className="m-btn block" disabled={!list.length} onClick={onExport}><Download size={18} /> Скачать список в Excel ({list.length})</button>
            {f.anyActive && <button type="button" className="m-btn block" onClick={f.reset}><RotateCcw size={18} /> Сбросить фильтры</button>}
          </div>
        </MSheet>
      )}
    </main>
  );
}

function ChipField({ label, options, value, onChange }) {
  return (
    <div className="m-field">
      <span className="m-field-label">{label}</span>
      <div className="m-chips">
        {options.map(([key, text]) => (
          <button type="button" key={key} className={`m-chip ${value === key ? "on" : ""}`} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function ContractCard({ contract: c, stats: st, investors, marks = [], selecting, selected, onToggle, onOpen, onPay, onRemind, onMarksHistory }) {
  const overdueRows = st.rows.filter((r) => r.status === "overdue");
  const today = isoDay(new Date());
  const tel = normalizePhone(c.phone);
  const reminderUrl = st.next ? waReminderLink(c.phone, c.clientName, c.item, st.next.remainingDue ?? st.next.amountDue, st.next.dueDate, st.next.status, st.rows) : null;
  const investorName = c.investorId ? (investors.find((i) => i.id === c.investorId)?.name || "") : "";
  const latest = marks[0];
  const nextDay = st.next ? isoDay(st.next.dueDate) : "";
  const deferral = st.deferrals[0];
  const mainClick = selecting ? onToggle : onOpen;

  return (
    <article className={`m-ccard ${overdueRows.length ? "overdue" : ""} ${st.done ? "done" : ""} ${selected ? "selected" : ""}`}>
      <button type="button" className="m-ccard-main" onClick={mainClick} aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? "Убрать из выбора" : "Выбрать"}: ${c.clientName}` : undefined}>
        <span className="m-ccard-top">
          {selecting && <span className={`m-check ${selected ? "on" : ""}`} aria-hidden="true">{selected && <Check size={16} />}</span>}
          <span className="m-ccard-who">
            <b>{c.clientName}</b>
            <small>{c.item || "Без товара"}{investorName ? ` · ${investorName}` : ""}</small>
          </span>
          <span className="m-ccard-sum">
            <b>{money(st.remaining)}</b>
            <small>{st.done ? "погашен" : "остаток"}</small>
          </span>
        </span>
        <MRibbon parts={[[st.paidSum, "paid"], [st.overdueSum, "over"], [Math.max(0, st.remaining - st.overdueSum), "rest"]]} thin />
        <span className="m-ccard-status">
          {overdueRows.length > 0 ? (
            <span className="m-state bad"><AlertTriangle size={15} aria-hidden="true" />Просрочка {daysLabel(overdueDays(st.rows))} · <b>{money(st.overdueSum)}</b></span>
          ) : st.done ? (
            <span className="m-state ok"><CheckCircle2 size={15} aria-hidden="true" />Договор полностью закрыт</span>
          ) : st.next ? (
            <span className={`m-state ${nextDay === today ? "warn" : ""}`}><CalendarDays size={15} aria-hidden="true" />{nextDay === today ? "Сегодня к оплате" : `Платёж ${dayLabel(nextDay)}`} · <b>{money(st.next.remainingDue)}</b></span>
          ) : <span className="m-state">Платежей нет</span>}
        </span>
        {(overdueRows.length > 1 || deferral || st.next?.notifiedAt) && (
          <span className="m-tags">
            {overdueRows.length > 1 && <span className="m-tag bad">{overdueRows.length} {plural(overdueRows.length, "платёж", "платежа", "платежей")} с {dayLabel(isoDay(overdueRows[0].dueDate))}</span>}
            {deferral && <span className="m-tag warn">Отсрочка до {dayLabel(isoDay(deferral.dueDate))}{st.deferrals.length > 1 ? ` · ${st.deferrals.length} плат.` : ""}</span>}
            {st.next?.notifiedAt && <span className="m-tag ok">Уведомлён {markDate(st.next.notifiedAt)}</span>}
          </span>
        )}
        {c.comment?.trim() && <span className="m-ccard-note"><ScrollText size={14} aria-hidden="true" />{c.comment.trim()}</span>}
      </button>

      {latest && !selecting && (
        <div className="m-mark">
          <span className={`m-mark-tag ${MARK_TONE[latest.result] || ""}`}>{markLabel(latest)}</span>
          <span className="m-mark-by">{[markDate(latest.at), latest.authorName].filter(Boolean).join(" · ")}</span>
          <button type="button" className="m-mark-history" onClick={onMarksHistory} aria-label={`История отметок: ${c.clientName}`}>
            <History size={16} />{marks.length > 1 ? marks.length : ""}
          </button>
          {latest.note && <p className="m-mark-note">{latest.note}</p>}
        </div>
      )}

      {!selecting && (
        <div className="m-ccard-actions">
          {tel
            ? <a className="m-act" href={`tel:+${tel}`} aria-label={`Позвонить: ${c.clientName}`}><Phone size={18} /></a>
            : <span className="m-act" data-off="1" aria-hidden="true"><Phone size={18} /></span>}
          {reminderUrl
            ? <a className={`m-act wa ${st.next?.notifiedAt ? "done" : ""}`} href={reminderUrl} target="_blank" rel="noreferrer"
                aria-label={st.next?.notifiedAt ? `Уведомлён. Напомнить ещё раз в WhatsApp: ${c.clientName}` : `Напомнить в WhatsApp: ${c.clientName}`}
                onClick={(e) => { e.preventDefault(); onRemind(c.id, st.next.index, e.currentTarget.href); }}>
                {st.next?.notifiedAt ? <Check size={18} /> : <MessageCircle size={18} />}
              </a>
            : <span className="m-act" data-off="1" aria-hidden="true"><MessageCircle size={18} /></span>}
          {!st.done && st.next
            ? <button type="button" className="m-btn primary grow" onClick={onPay}>Принять платёж</button>
            : <button type="button" className="m-btn grow" onClick={onOpen}>Открыть договор</button>}
        </div>
      )}
    </article>
  );
}
