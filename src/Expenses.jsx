import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Download, X } from "lucide-react";
import {
  buildExpensesWorkbook, categoryOptions, expensePeriod, expenseTotals, filterExpenses, monthOf, paidFromOptions, parseAmount,
  periodLabel, periodOptions, validateExpense,
} from "./expenses";
import { buildJournalWorkbook, filterJournal, journalTotals, moneyJournal } from "./moneyJournal";
import "./expenses.css";

const money = (n) => Number(n || 0).toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ruDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const quickPeriods = () => {
  const now = new Date(), today = localDay(now);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1), prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return [
    ["month", "Этот месяц", today.slice(0, 8) + "01", today],
    ["prev", "Прошлый месяц", localDay(prevStart), localDay(prevEnd)],
    ["year", "Этот год", `${now.getFullYear()}-01-01`, today],
    ["all", "Всё время", "", ""],
  ];
};
const emptyForm = () => { const date = localDay(new Date()); return { id: "", date, period: monthOf(date), amount: "", category: "", paidFrom: "", note: "" }; };
const forPeriod = (e) => `за ${periodLabel(expensePeriod(e)).toLowerCase()}`;
const BASES = [["paid", "По дате оплаты"], ["period", "По периоду расхода"]];

function ExpenseForm({ initial, categories, sources, onCancel, onSave }) {
  const [f, setF] = useState(initial);
  // Пока период не выбран вручную, он следует за месяцем даты оплаты. У сохранённой записи период уже выбран.
  const [periodTouched, setPeriodTouched] = useState(Boolean(initial.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const problem = validateExpense(f);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try { await onSave({ ...f, amount: parseAmount(f.amount) }); }
    catch (err) { setError(err.message || String(err)); setBusy(false); }
  };
  return (
    <form className="exp-form" onSubmit={submit}>
      <div className="exp-form-hd"><b>{f.id ? "Изменить расход" : "Новый расход"}</b>
        <button type="button" className="icon-btn-ghost" onClick={onCancel} aria-label="Закрыть"><X size={16} /></button></div>
      <div className="exp-form-grid">
        <label>Дата оплаты<input type="date" value={f.date} required
          onChange={(e) => { const date = e.target.value; setF((p) => ({ ...p, date, ...(periodTouched || !date ? {} : { period: monthOf(date) }) })); }} /></label>
        <label>Период расхода
          <select value={f.period} required onChange={(e) => { setPeriodTouched(true); setF((p) => ({ ...p, period: e.target.value })); }}>
            {periodOptions(f.date, f.period).map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
          </select>
          <small className="exp-field-hint">Месяц, к которому относится расход. Может отличаться от месяца оплаты</small></label>
        <label>Сумма, ₽<input inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="0" autoFocus={!f.id} required /></label>
        <label>Статья<input list="exp-categories" value={f.category} onChange={set("category")} maxLength={100} placeholder="Аренда, зарплата…" />
          <datalist id="exp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
        <label>Оплачено из<input list="exp-sources" value={f.paidFrom} onChange={set("paidFrom")} maxLength={100} placeholder="Наличные или карта" />
          <datalist id="exp-sources">{sources.map((c) => <option key={c} value={c} />)}</datalist></label>
        <label className="exp-wide">Комментарий<input value={f.note} onChange={set("note")} maxLength={2000} placeholder="Кому и за что" /></label>
      </div>
      <p className="exp-hint">Закупку товара сюда не вносите — она записывается в «Капитал» → «Выводы» → «Закупка товара», иначе вычтется дважды.</p>
      {error && <p role="alert" className="exp-error">{error}</p>}
      <div className="exp-form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="btn primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
      </div>
    </form>
  );
}

const VIEWS = [["all", "Всё"], ["in", "Поступления"], ["expenses", "Расходы"]];

function BasisSwitch({ basis, onChange }) {
  return (
    <div className="exp-basis" role="radiogroup" aria-label="Как считать расходы">
      {BASES.map(([key, label]) => <button type="button" role="radio" key={key} aria-checked={basis === key} className={basis === key ? "on" : ""} onClick={() => onChange(key)}>{label}</button>)}
    </div>
  );
}

export default function Expenses({ expenses, cards = [], loadError = "", onAdd, onUpdate, onRemove, contracts = [], withdrawals = [], investors = [], purposes = {}, onOpenContract }) {
  const periods = quickPeriods();
  const [from, setFrom] = useState(periods[0][2]);
  const [to, setTo] = useState(periods[0][3]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [view, setView] = useState("all");
  const [basis, setBasis] = useState("paid");
  const isJournal = view !== "expenses";

  const rows = useMemo(() => filterExpenses(expenses, { from, to, category, search, basis }), [expenses, from, to, category, search, basis]);
  const totals = useMemo(() => expenseTotals(rows), [rows]);
  const categories = useMemo(() => categoryOptions(expenses), [expenses]);
  const sources = useMemo(() => paidFromOptions(expenses, cards), [expenses, cards]);
  const usedCategories = useMemo(() => [...new Set(expenses.map((e) => e.category))].sort((a, b) => a.localeCompare(b, "ru")), [expenses]);
  const invalid = from && to && from > to;
  const journal = useMemo(() => moneyJournal({ contracts, expenses, withdrawals, investors, purposes }), [contracts, expenses, withdrawals, investors, purposes]);
  const journalBasis = view === "all" ? basis : "paid";
  const journalRows = useMemo(() => isJournal ? filterJournal(journal, { from, to, kind: view === "in" ? "in" : "all", search, basis: journalBasis }) : [], [journal, isJournal, view, from, to, search, journalBasis]);
  // Деньги (пришло, выводы, «пришло − ушло») — всегда по датам движения, независимо от переключателя.
  const cashRows = useMemo(() => journalBasis === "paid" ? journalRows : filterJournal(journal, { from, to, kind: "all", search }), [journal, journalRows, journalBasis, from, to, search]);
  const jt = useMemo(() => journalTotals(journalRows), [journalRows]);
  const cashTotals = useMemo(() => journalTotals(cashRows), [cashRows]);

  const save = async (data) => {
    if (data.id) await onUpdate(data); else await onAdd(data);
    setForm(null);
  };
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const end = to || localDay(new Date());
    if (isJournal) XLSX.writeFile(buildJournalWorkbook(XLSX, journalRows, { from, to, basis: journalBasis, cashRows }), `Журнал_денег_${from || "всё"}_${end}.xlsx`);
    else XLSX.writeFile(buildExpensesWorkbook(XLSX, rows, { from, to, basis }), `Расходы_${from || "всё"}_${end}.xlsx`);
  };

  return (
    <section className="card cash-desk expenses-desk">
      <div className="exp-head">
        <h2>Расходы</h2>
        <button className="btn primary" onClick={() => setForm(emptyForm())}><Plus size={16} /> Добавить расход</button>
      </div>
      <div className="exp-views" role="tablist" aria-label="Что показать">
        {VIEWS.map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={view === key} className={view === key ? "on" : ""} onClick={() => setView(key)}>{label}</button>)}
      </div>
      <p>{isJournal
        ? "Журнал денег: оплаты от клиентов (вместе с первоначальными взносами), расходы и выводы из «Капитала». Расходы добавляются и правятся здесь, выводы — в «Капитале»."
        : "Реестр оплат: аренда, зарплата, реклама и другие траты. Расходы вычитаются из вашей прибыли (вкладчиков не касаются) и уменьшают «Свободно» в «Капитале»."}</p>
      {loadError && <p role="alert" className="exp-error">{loadError}</p>}
      {form && <ExpenseForm key={form.id || "new"} initial={form} categories={categories} sources={sources} onCancel={() => setForm(null)} onSave={save} />}

      <div className="exp-chips" role="group" aria-label="Период">
        {periods.map(([key, label, f, t]) => (
          <button type="button" key={key} className={`exp-chip ${from === f && to === t ? "on" : ""}`} aria-pressed={from === f && to === t}
            onClick={() => { setFrom(f); setTo(t); }}>{label}</button>
        ))}
      </div>
      <div className="cash-filters exp-filters">
        <label>С <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>По <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {!isJournal && <select aria-label="Статья" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все статьи</option>
          {usedCategories.map((c) => <option key={c}>{c}</option>)}
        </select>}
        <input className="exp-search" type="search" aria-label="Поиск" placeholder={isJournal ? "Поиск: клиент, статья, карта, комментарий" : "Поиск по комментарию"} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {view !== "in" && <BasisSwitch basis={basis} onChange={setBasis} />}
      {invalid && <p role="alert">Начало периода должно быть раньше окончания.</p>}

      {isJournal ? <>
        {view === "all" ? (
          <div className="cash-summary journal-summary">
            <p className="in">Пришло от клиентов<b>{money(cashTotals.incoming)}</b></p>
            <p className="out">{basis === "period" ? "Расходы за период (по месяцу расхода)" : "Расходы оплачено"}<b>{money(jt.expenses)}</b></p>
            <p className="out">Выводы<b>{money(cashTotals.withdrawals)}</b></p>
            <p className={cashTotals.balance < 0 ? "total bad" : "total"}>Пришло − ушло (деньги за эти даты)<b>{money(cashTotals.balance)}</b></p>
          </div>
        ) : <h3 className="journal-in-total">Пришло от клиентов: {money(jt.incoming)} <small>· оплат {journalRows.length}</small></h3>}
        <div className="exp-list-hd">
          <span>{view === "in" ? "Поступления" : "Движение денег"}</span>
          <button className="btn ghost btn-sm" disabled={!journalRows.length} onClick={exportExcel}><Download size={14} /> Excel</button>
        </div>
        {journalRows.length === 0 ? <p className="exp-empty">За выбранный период движений нет.</p> : (
          <div className="exp-list">
            {journalRows.map((e) => (
              <div key={e.key} className={`exp-row journal-row ${e.kind}`}>
                <span className="exp-date">{ruDate(e.date)}</span>
                <span className="exp-main">
                  {e.kind === "in" && onOpenContract ? <button type="button" className="journal-client" onClick={() => onOpenContract(e.contractId)}>{e.title}</button> : <b>{e.title}</b>}
                  <span className="exp-note">{[e.detail, e.note].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="exp-from">{e.via}</span>
                <span className="exp-sum">{e.kind === "in" ? "+" : "−"}{money(e.amount)}</span>
                <span className="exp-actions">
                  {e.kind === "expense" && <>
                    <button className="icon-btn-ghost" onClick={() => setForm({ ...e.expense, amount: String(e.expense.amount) })} aria-label="Изменить" title="Изменить"><Pencil size={14} /></button>
                    <button className="icon-btn-ghost" onClick={() => onRemove(e.expense.id)} aria-label="Удалить" title="Удалить"><Trash2 size={14} /></button>
                  </>}
                </span>
              </div>
            ))}
          </div>
        )}
      </> : <>
      <h3>{basis === "period" ? "Расходы за период (по месяцу расхода)" : "Оплачено расходов"}: {money(totals.total)} <small>· записей {totals.count}</small></h3>
      {totals.byCategory.length > 0 && (
        <div className="cash-summary">
          {totals.byCategory.map((t) => (
            <p key={t.category} className={category === t.category ? "on" : ""}>
              <button type="button" className="exp-cat-btn" onClick={() => setCategory(category === t.category ? "" : t.category)}>
                {t.category}<b>{money(t.amount)}</b>
              </button>
            </p>
          ))}
        </div>
      )}

      <div className="exp-list-hd">
        <span>Оплаты</span>
        <button className="btn ghost btn-sm" disabled={!rows.length} onClick={exportExcel}><Download size={14} /> Excel</button>
      </div>
      {rows.length === 0 ? (
        <p className="exp-empty">{expenses.length ? "За выбранный период расходов нет." : "Расходов пока нет. Нажмите «Добавить расход»."}</p>
      ) : (
        <div className="exp-list">
          <div className="exp-cols" aria-hidden="true"><span>Дата оплаты</span><span>Статья · период расхода</span><span>Оплачено из</span><span>Сумма</span><span /></div>
          {rows.map((e) => (
            <div key={e.id} className="exp-row">
              <span className="exp-date"><span className="exp-date-lbl">Оплата </span>{ruDate(e.date)}</span>
              <span className="exp-main"><b>{e.category}</b><span className={`exp-period ${expensePeriod(e) !== monthOf(e.date) ? "shifted" : ""}`}>{forPeriod(e)}</span>{e.note && <span className="exp-note">{e.note}</span>}</span>
              <span className="exp-from">{e.paidFrom || "—"}</span>
              <span className="exp-sum">{money(e.amount)}</span>
              <span className="exp-actions">
                <button className="icon-btn-ghost" onClick={() => setForm({ ...e, amount: String(e.amount) })} aria-label="Изменить" title="Изменить"><Pencil size={14} /></button>
                <button className="icon-btn-ghost" onClick={() => onRemove(e.id)} aria-label="Удалить" title="Удалить"><Trash2 size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      </>}
    </section>
  );
}
