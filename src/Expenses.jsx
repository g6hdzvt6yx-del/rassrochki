import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Download, X } from "lucide-react";
import {
  buildExpensesWorkbook, categoryOptions, expenseTotals, filterExpenses, paidFromOptions, parseAmount, validateExpense,
} from "./expenses";
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
const emptyForm = () => ({ id: "", date: localDay(new Date()), amount: "", category: "", paidFrom: "", note: "" });

function ExpenseForm({ initial, categories, sources, onCancel, onSave }) {
  const [f, setF] = useState(initial);
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
        <label>Дата оплаты<input type="date" value={f.date} onChange={set("date")} required /></label>
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

export default function Expenses({ expenses, cards = [], loadError = "", onAdd, onUpdate, onRemove }) {
  const periods = quickPeriods();
  const [from, setFrom] = useState(periods[0][2]);
  const [to, setTo] = useState(periods[0][3]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);

  const rows = useMemo(() => filterExpenses(expenses, { from, to, category, search }), [expenses, from, to, category, search]);
  const totals = useMemo(() => expenseTotals(rows), [rows]);
  const categories = useMemo(() => categoryOptions(expenses), [expenses]);
  const sources = useMemo(() => paidFromOptions(expenses, cards), [expenses, cards]);
  const usedCategories = useMemo(() => [...new Set(expenses.map((e) => e.category))].sort((a, b) => a.localeCompare(b, "ru")), [expenses]);
  const invalid = from && to && from > to;

  const save = async (data) => {
    if (data.id) await onUpdate(data); else await onAdd(data);
    setForm(null);
  };
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    XLSX.writeFile(buildExpensesWorkbook(XLSX, rows, { from, to }), `Расходы_${from || "всё"}_${to || localDay(new Date())}.xlsx`);
  };

  return (
    <section className="card cash-desk expenses-desk">
      <div className="exp-head">
        <h2>Расходы</h2>
        <button className="btn primary" onClick={() => setForm(emptyForm())}><Plus size={16} /> Добавить расход</button>
      </div>
      <p>Реестр оплат: аренда, зарплата, реклама и другие траты. Расходы вычитаются из вашей прибыли (вкладчиков не касаются) и уменьшают «Свободно» в «Капитале».</p>
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
        <select aria-label="Статья" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все статьи</option>
          {usedCategories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className="exp-search" type="search" aria-label="Поиск" placeholder="Поиск по комментарию" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {invalid && <p role="alert">Начало периода должно быть раньше окончания.</p>}

      <h3>Потрачено: {money(totals.total)} <small>· записей {totals.count}</small></h3>
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
          {rows.map((e) => (
            <div key={e.id} className="exp-row">
              <span className="exp-date">{ruDate(e.date)}</span>
              <span className="exp-main"><b>{e.category}</b>{e.note && <span className="exp-note">{e.note}</span>}</span>
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
    </section>
  );
}
