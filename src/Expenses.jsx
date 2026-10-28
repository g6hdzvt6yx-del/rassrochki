import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Search, Pencil, Trash2, Paperclip, FileText, Wallet, Landmark, ArrowRightLeft,
  Tags, Archive, ArchiveRestore, Receipt, TrendingDown,
} from 'lucide-react';
import {
  BUILTIN_CATEGORIES, ACCOUNT_KINDS, allCategories, categoryName, isTransfer, countsForProfit,
  localDay, localTime, periodRange, validateExpense, filterExpenses, summarizeExpenses, balanceAfter,
  recentRecipients, loadExpenseData, reloadAccounts, saveExpense, deleteExpense, saveAccount, deleteAccount,
  addCategory, removeCategory, attachExpenseReceipt, detachExpenseReceipt, receiptUrl, checkReceiptFile,
} from './expenses';
import './expenses.css';

const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n || 0) + ' ₽';
const fmtDay = (day) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }).format(new Date(`${day}T00:00:00`));
const fmtDateTime = (iso) => iso ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';
const LAST_ACCOUNT_KEY = 'rassrochki-expense-account';
const readLastAccount = () => { try { return localStorage.getItem(LAST_ACCOUNT_KEY) || ''; } catch { return ''; } };
const rememberAccount = (id) => { try { localStorage.setItem(LAST_ACCOUNT_KEY, id); } catch { /* только удобство */ } };

const PERIODS = [['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['prevMonth', 'Прошлый месяц'], ['all', 'Всё время'], ['custom', 'Период…']];
const CATEGORY_TONE = { purchase: 'b-brass', salary: 'b-emerald', collection: 'b-amber', other: 'b-line' };

export default function Expenses({ db, ownerId, requestConfirm, directoryItems = [] }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tick, setTick] = useState(0);
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState(() => periodRange('month'));
  const [category, setCategory] = useState('');
  const [recipient, setRecipient] = useState('');
  const [accountId, setAccountId] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null); // null | { expense?: existing }
  const [viewId, setViewId] = useState(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let live = true;
    setLoadError('');
    loadExpenseData(db).then((d) => { if (live) setData(d); }, (e) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [db, tick]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const accounts = data?.accounts || [];
  const categories = data?.categories || [];
  const expenses = data?.expenses || [];
  const accountName = (id) => accounts.find((a) => a.id === id)?.name || '';
  const range = preset === 'custom' ? custom : periodRange(preset);
  const rangeError = range.from && range.to && range.from > range.to ? 'Начало периода позже окончания.' : '';

  const filtered = useMemo(() => rangeError ? [] : filterExpenses(expenses, { ...range, category, recipient, accountId, query }, { categories, accountName }),
    [expenses, range.from, range.to, category, recipient, accountId, query, categories, accounts, rangeError]);
  const summary = useMemo(() => summarizeExpenses(filtered, categories), [filtered, categories]);
  const recipients = useMemo(() => recentRecipients(expenses), [expenses]);
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const e of filtered) {
      const day = localDay(e.occurredAt);
      if (!groups.has(day)) groups.set(day, { day, list: [], total: 0 });
      const g = groups.get(day);
      g.list.push(e);
      if (!isTransfer(e)) g.total += e.amount;
    }
    return [...groups.values()];
  }, [filtered]);

  const refreshAccounts = async () => {
    try { const fresh = await reloadAccounts(db); setData((d) => ({ ...d, accounts: fresh })); }
    catch (e) { setNotice({ tone: 'error', text: e.message }); }
  };
  const putExpense = (saved) => setData((d) => ({
    ...d,
    expenses: [saved, ...d.expenses.filter((e) => e.id !== saved.id)].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))),
  }));

  const removeExpense = async (expense) => {
    const back = isTransfer(expense)
      ? `${money(expense.amount)} вернутся в «${accountName(expense.accountId)}» и спишутся из «${accountName(expense.toAccountId)}».`
      : `${money(expense.amount)} вернутся в остаток «${accountName(expense.accountId)}».`;
    if (!await requestConfirm({ title: 'Удалить операцию?', message: `${categoryName(expense.category, categories)} от ${fmtDateTime(expense.occurredAt)}. ${back} Действие нельзя отменить.`, confirmLabel: 'Удалить операцию', danger: true })) return;
    try {
      await deleteExpense(db, expense);
      setData((d) => ({ ...d, expenses: d.expenses.filter((e) => e.id !== expense.id) }));
      setViewId(null);
      setNotice({ tone: 'ok', text: 'Операция удалена, остаток пересчитан.' });
      await refreshAccounts();
    } catch (e) { setNotice({ tone: 'error', text: e.message }); }
  };

  if (loadError) return <main className="wrap expenses"><section className="panel"><div className="empty" role="alert">
    Раздел «Расходы» недоступен: {loadError}
    <p className="muted">Если это первый запуск — в базе нужно применить supabase/006_expenses.sql.</p>
    <button className="btn primary btn-sm" onClick={() => setTick((t) => t + 1)}>Повторить</button>
  </div></section></main>;
  if (!data) return <main className="wrap expenses"><div className="loading">Загрузка расходов…</div></main>;

  const activeAccounts = accounts.filter((a) => !a.archived);
  const viewed = expenses.find((e) => e.id === viewId) || null;
  const openAdd = () => { if (!activeAccounts.length) { setAccountsOpen(true); setNotice({ tone: 'ok', text: 'Сначала добавьте кассу или счёт, откуда списываются деньги.' }); return; } setForm({}); };

  return <main className="wrap expenses">
    <div className="exp-head">
      <h1>Расходы</h1>
      <button className="btn ghost btn-sm" onClick={() => setCategoriesOpen(true)}><Tags size={14} /> Категории</button>
      <button className="btn primary exp-add-top" onClick={openAdd}><Plus size={16} /> Добавить расход</button>
    </div>

    {notice && <p className={`exp-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

    <section className="exp-accounts" aria-label="Кассы и счета">
      {accounts.filter((a) => !a.archived).map((a) => (
        <button key={a.id} type="button" className={`stat stat-btn exp-account ${accountId === a.id ? 'on' : ''}`} onClick={() => setAccountId(accountId === a.id ? '' : a.id)} title="Показать операции этой кассы или счёта">
          <div className="stat-ic">{a.kind === 'cash' ? <Wallet size={15} /> : <Landmark size={15} />}</div>
          <div className="stat-label">{ACCOUNT_KINDS[a.kind]} · {a.name}</div>
          <div className={`stat-val num ${a.balance < 0 ? 'clay' : ''}`}>{money(a.balance)}</div>
        </button>
      ))}
      <button type="button" className="stat stat-btn exp-account exp-account-add" onClick={() => setAccountsOpen(true)}>
        <div className="stat-ic"><Plus size={15} /></div>
        <div className="stat-label">{accounts.length ? 'Кассы и счета' : 'Добавить кассу или счёт'}</div>
      </button>
    </section>

    <section className="exp-filters">
      <div className="search-box">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: получатель, комментарий, сумма…" aria-label="Поиск операций" />
        {query && <button className="search-clear" onClick={() => setQuery('')} title="Очистить"><X size={13} /></button>}
      </div>
      <div className="filter-chips exp-periods" role="group" aria-label="Период">
        {PERIODS.map(([key, label]) => <button key={key} className={preset === key ? 'on' : ''} onClick={() => setPreset(key)}>{label}</button>)}
      </div>
      {preset === 'custom' && <div className="exp-range">
        <label>С <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
        <label>По <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
      </div>}
      <div className="exp-selects">
        <select className="toolbar-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>
          {allCategories(categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="transfer">Перемещения</option>
        </select>
        <select className="toolbar-select" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Получатель">
          <option value="">Все получатели</option>
          {recipients.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {accountId && <button className="btn ghost btn-sm" onClick={() => setAccountId('')}><X size={13} /> {accountName(accountId)}</button>}
      </div>
      {rangeError && <p className="exp-notice error" role="alert">{rangeError}</p>}
    </section>

    <section className="hero exp-summary">
      <div className="hero-label">Списано за период{range.from ? ` · ${range.from.split('-').reverse().join('.')} — ${range.to.split('-').reverse().join('.')}` : ''}</div>
      <div className="hero-num num">{money(summary.outflow)}</div>
      <div className="exp-summary-grid">
        <div><span>Расходы (уменьшают прибыль)</span><b className="num">{money(summary.profitExpenses)}</b></div>
        <div><span>Инкассация (не расход)</span><b className="num">{money(summary.collection)}</b></div>
        <div><span>Перемещения между кассами и счетами</span><b className="num">{money(summary.transfers)}</b></div>
      </div>
      {summary.byCategory.length > 0 && <div className="exp-breakdown">
        {summary.byCategory.map((c) => (
          <button type="button" key={c.id} className={`exp-break-row ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(category === c.id ? '' : c.id)}>
            <span className="exp-break-name">{c.name}{!c.forProfit && <small> · не в прибыль</small>}</span>
            <span className="month-bar"><span className="month-bar-fill fill-expected" style={{ width: `${summary.outflow ? (c.total / summary.outflow) * 100 : 0}%` }} /></span>
            <span className="num exp-break-sum">{money(c.total)}</span>
            <span className="muted exp-break-count">{c.count}</span>
          </button>
        ))}
      </div>}
    </section>

    <section className="panel exp-history">
      <div className="panel-hd"><TrendingDown size={15} /> История операций · {filtered.length}</div>
      {!filtered.length ? <div className="empty">{expenses.length ? 'По выбранным фильтрам операций нет.' : 'Операций пока нет — нажмите «Добавить расход».'}</div> : byDay.map((g) => (
        <div key={g.day} className="exp-day">
          <div className="exp-day-hd"><span>{fmtDay(g.day)}</span><span className="num">{money(g.total)}</span></div>
          {g.list.map((e) => (
            <button key={e.id} type="button" className="exp-row" onClick={() => setViewId(e.id)}>
              <span className="exp-row-main">
                <span className="exp-row-title">
                  <span className={`badge ${isTransfer(e) ? 'b-line' : CATEGORY_TONE[e.category] || 'b-brass'}`}>{isTransfer(e) ? 'Перемещение' : categoryName(e.category, categories)}</span>
                  {e.receipt && <Paperclip size={12} className="exp-clip" aria-label="Есть чек" />}
                </span>
                <span className="exp-row-who">{isTransfer(e) ? `${accountName(e.accountId)} → ${accountName(e.toAccountId)}` : e.recipient || e.comment || 'Без получателя'}</span>
                <span className="muted">{localTime(e.occurredAt)} · {isTransfer(e) ? 'без списания из прибыли' : accountName(e.accountId)}{e.createdByName ? ` · ${e.createdByName}` : ''}</span>
              </span>
              <span className={`num exp-row-sum ${isTransfer(e) ? 'transfer' : ''}`}>{isTransfer(e) ? '' : '−'}{money(e.amount)}</span>
            </button>
          ))}
        </div>
      ))}
    </section>

    <button className="exp-fab btn primary" onClick={openAdd} aria-label="Добавить расход"><Plus size={20} /> Добавить расход</button>

    {form && <ExpenseForm
      db={db} ownerId={ownerId} expense={form.expense} accounts={accounts} categories={categories} recipients={recipients}
      onCategoriesChange={(next) => setData((d) => ({ ...d, categories: next }))}
      onClose={() => setForm(null)}
      onSaved={async (saved, warning) => {
        putExpense(saved);
        setForm(null);
        setNotice(warning ? { tone: 'error', text: warning } : { tone: 'ok', text: form.expense ? 'Операция изменена, остатки пересчитаны.' : 'Расход добавлен.' });
        await refreshAccounts();
      }}
    />}
    {viewed && !form && <ExpenseView
      db={db} expense={viewed} categories={categories} accountName={accountName}
      onClose={() => setViewId(null)} onEdit={() => setForm({ expense: viewed })} onDelete={() => removeExpense(viewed)}
    />}
    {accountsOpen && <AccountsSheet
      db={db} accounts={accounts} expenses={expenses} requestConfirm={requestConfirm} directoryItems={directoryItems}
      onChange={(next) => setData((d) => ({ ...d, accounts: next }))} onClose={() => setAccountsOpen(false)}
    />}
    {categoriesOpen && <CategoriesSheet
      db={db} categories={categories} expenses={expenses} requestConfirm={requestConfirm}
      onChange={(next) => setData((d) => ({ ...d, categories: next }))} onClose={() => setCategoriesOpen(false)}
    />}
  </main>;
}

/* --------------------------- Форма операции --------------------------- */

function ExpenseForm({ db, ownerId, expense, accounts, categories, recipients, onCategoriesChange, onClose, onSaved }) {
  const now = new Date();
  const active = accounts.filter((a) => !a.archived || a.id === expense?.accountId || a.id === expense?.toAccountId);
  const lastAccount = readLastAccount();
  const [f, setF] = useState(() => ({
    amount: expense ? String(expense.amount) : '',
    category: expense?.category || 'purchase',
    day: localDay(expense?.occurredAt || now),
    time: localTime(expense?.occurredAt || now),
    accountId: expense?.accountId || (active.some((a) => a.id === lastAccount) ? lastAccount : active[0]?.id || ''),
    target: expense?.toAccountId ? 'internal' : 'external',
    toAccountId: expense?.toAccountId || '',
    recipient: expense?.recipient || '',
    comment: expense?.comment || '',
  }));
  const [file, setFile] = useState(null);
  const [dropReceipt, setDropReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCategory, setNewCategory] = useState(null);
  const amountRef = useRef(null);
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));
  const pick = (key, value) => setF((prev) => ({ ...prev, [key]: value }));
  useEffect(() => { amountRef.current?.focus(); }, []);

  const collection = f.category === 'collection';
  const transfer = collection && f.target === 'internal';
  let preview = null;
  try { preview = validateExpense(f, { accounts, categories }); } catch { /* ошибки покажем при сохранении */ }
  const after = preview ? balanceAfter(accounts, expense, preview) : null;
  const touched = preview ? [...new Set([preview.account_id, preview.to_account_id, expense?.accountId, expense?.toAccountId].filter(Boolean))] : [];

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    let row;
    try { row = validateExpense(f, { accounts, categories }); checkReceiptFile(file); }
    catch (err) { setError(err.message); return; }
    setBusy(true);
    try {
      let saved = await saveExpense(db, expense?.id, row);
      rememberAccount(row.account_id);
      let warning = '';
      try {
        if (file) saved = await attachExpenseReceipt(db, ownerId, saved, file);
        else if (dropReceipt && saved.receipt) saved = await detachExpenseReceipt(db, saved);
      } catch (err) { warning = `Операция сохранена, но чек не прикреплён: ${err.message}`; }
      await onSaved(saved, warning);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const createCategory = async () => {
    try {
      const added = await addCategory(db, newCategory, categories);
      onCategoriesChange([...categories, added]);
      pick('category', added.id);
      setNewCategory(null);
    } catch (err) { setError(err.message); }
  };

  return <div className="overlay" onClick={busy ? undefined : onClose}>
    <form className="sheet exp-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <div className="sheet-hd">
        <div className="sheet-name">{expense ? 'Изменить операцию' : 'Новый расход'}</div>
        <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={18} /></button>
      </div>
      <div className="sheet-body">
        <label className="field exp-amount"><span>Сумма, ₽</span>
          <input ref={amountRef} value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="0" autoComplete="off" enterKeyHint="next" />
        </label>

        <div className="field"><span>Категория</span>
          <div className="exp-chips" role="radiogroup" aria-label="Категория">
            {allCategories(categories).map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={f.category === c.id} className={f.category === c.id ? 'on' : ''} title={c.hint} onClick={() => pick('category', c.id)}>{c.name}</button>
            ))}
            {newCategory === null
              ? <button type="button" className="exp-chip-add" onClick={() => setNewCategory('')}><Plus size={13} /> Своя</button>
              : <span className="exp-chip-new">
                  <input autoFocus value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder="Например: Аренда"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategory(); } if (e.key === 'Escape') setNewCategory(null); }} />
                  <button type="button" className="btn primary btn-sm" onClick={createCategory} disabled={!newCategory.trim()}>Добавить</button>
                  <button type="button" className="btn ghost btn-sm" onClick={() => setNewCategory(null)}>Отмена</button>
                </span>}
          </div>
          {collection && <small className="exp-hint">Инкассация уменьшает остаток кассы, но не считается расходом при расчёте прибыли.</small>}
        </div>

        <div className="field"><span>Откуда списать</span>
          <AccountChips accounts={active} value={f.accountId} onPick={(id) => pick('accountId', id)} />
        </div>

        {collection && <div className="field"><span>Куда</span>
          <div className="seg-toggle">
            <button type="button" className={f.target === 'external' ? 'on' : ''} onClick={() => pick('target', 'external')}>Человеку или в место</button>
            <button type="button" className={f.target === 'internal' ? 'on' : ''} onClick={() => pick('target', 'internal')}><ArrowRightLeft size={13} /> В свою кассу / счёт</button>
          </div>
          {transfer && <>
            <AccountChips accounts={active.filter((a) => a.id !== f.accountId)} value={f.toAccountId} onPick={(id) => pick('toAccountId', id)} empty="Добавьте вторую кассу или счёт, чтобы оформить перемещение." />
            <small className="exp-hint">Это перемещение: деньги спишутся отсюда и зачислятся туда, без повторного списания.</small>
          </>}
        </div>}

        {!transfer && <label className="field"><span>{collection ? 'Получатель или место перевода' : 'Получатель'}</span>
          <input value={f.recipient} onChange={set('recipient')} list="exp-recipients" maxLength={200}
            placeholder={collection ? 'Например: владелец, банк, сейф' : f.category === 'salary' ? 'Сотрудник' : 'Поставщик, сотрудник, организация'} autoComplete="off" />
          <datalist id="exp-recipients">{recipients.map((r) => <option key={r} value={r} />)}</datalist>
        </label>}

        <div className="frow">
          <label className="field"><span>Дата</span><input type="date" value={f.day} onChange={set('day')} /></label>
          <label className="field"><span>Время</span><input type="time" value={f.time} onChange={set('time')} /></label>
        </div>

        <label className="field"><span>Комментарий</span>
          <textarea value={f.comment} onChange={set('comment')} rows={2} maxLength={2000} placeholder="Необязательно" />
        </label>

        <div className="field"><span>Чек или фото (необязательно)</span>
          <div className="exp-receipt">
            {expense?.receipt && !dropReceipt && !file && <span className="exp-receipt-name"><FileText size={13} /> {expense.receipt.name}
              <button type="button" className="receipt-remove" onClick={() => setDropReceipt(true)} title="Убрать чек"><X size={13} /></button></span>}
            {file && <span className="exp-receipt-name"><FileText size={13} /> {file.name}
              <button type="button" className="receipt-remove" onClick={() => setFile(null)} title="Не прикреплять"><X size={13} /></button></span>}
            <label className="receipt-btn">
              <Paperclip size={13} /> {file || (expense?.receipt && !dropReceipt) ? 'Заменить' : 'Сфотографировать или выбрать'}
              <input type="file" accept="image/*,application/pdf" className="hidden-file-input" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} />
            </label>
          </div>
        </div>

        {after && <div className="exp-after">
          {touched.map((id) => {
            const a = accounts.find((x) => x.id === id);
            if (!a) return null;
            return <div key={id} className={after[id] < 0 ? 'neg' : ''}><span>{a.name}</span><b className="num">{money(a.balance)} → {money(after[id])}</b></div>;
          })}
          {touched.some((id) => after[id] < 0) && <small role="alert">Остаток станет отрицательным — проверьте сумму или источник.</small>}
        </div>}

        {error && <p className="exp-notice error" role="alert">{error}</p>}
        <div className="sheet-actions exp-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Сохраняем…' : expense ? 'Сохранить изменения' : 'Сохранить расход'}</button>
        </div>
      </div>
    </form>
  </div>;
}

function AccountChips({ accounts, value, onPick, empty = 'Нет касс и счетов.' }) {
  if (!accounts.length) return <small className="exp-hint">{empty}</small>;
  return <div className="exp-chips exp-account-chips" role="radiogroup">
    {accounts.map((a) => (
      <button key={a.id} type="button" role="radio" aria-checked={value === a.id} className={value === a.id ? 'on' : ''} onClick={() => onPick(a.id)}>
        {a.kind === 'cash' ? <Wallet size={13} /> : <Landmark size={13} />} {a.name}
        <small className="num">{money(a.balance)}</small>
      </button>
    ))}
  </div>;
}

/* --------------------------- Просмотр операции --------------------------- */

function ExpenseView({ db, expense, categories, accountName, onClose, onEdit, onDelete }) {
  const [error, setError] = useState('');
  const openReceipt = async () => {
    setError('');
    const win = window.open('about:blank', '_blank'); // открываем по клику, иначе Safari заблокирует
    try { const url = await receiptUrl(db, expense.receipt); if (win) win.location.href = url; else window.open(url, '_blank'); }
    catch (e) { win?.close(); setError(e.message); }
  };
  const transfer = isTransfer(expense);
  return <div className="overlay" onClick={onClose}>
    <div className="sheet exp-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="sheet-hd">
        <div><div className="sheet-name num">{money(expense.amount)}</div><div className="sheet-phone">{transfer ? 'Перемещение' : categoryName(expense.category, categories)}</div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      </div>
      <div className="sheet-body">
        <div className="det-grid exp-det">
          <div><span>Дата и время</span><b>{fmtDateTime(expense.occurredAt)}</b></div>
          <div><span>Категория</span><b>{categoryName(expense.category, categories)}</b></div>
          <div><span>Откуда</span><b>{accountName(expense.accountId) || '—'}</b></div>
          <div><span>{transfer ? 'Куда' : 'Получатель'}</span><b>{transfer ? accountName(expense.toAccountId) : expense.recipient || '—'}</b></div>
          <div><span>В расчёте прибыли</span><b>{countsForProfit(expense) ? 'Да, расход' : transfer ? 'Нет — перемещение' : 'Нет — инкассация'}</b></div>
          <div><span>Добавил</span><b>{expense.createdByName || '—'}<small className="muted"> {fmtDateTime(expense.createdAt)}</small></b></div>
          {expense.updatedAt && <div><span>Изменил</span><b>{expense.updatedByName || '—'}<small className="muted"> {fmtDateTime(expense.updatedAt)}</small></b></div>}
        </div>
        {expense.comment && <p className="exp-comment">{expense.comment}</p>}
        {expense.receipt && <button type="button" className="receipt-link" onClick={openReceipt}><Receipt size={13} /> {expense.receipt.name}</button>}
        {error && <p className="exp-notice error" role="alert">{error}</p>}
        <div className="sheet-actions exp-actions">
          <button className="btn ghost" onClick={onDelete}><Trash2 size={14} /> Удалить</button>
          <button className="btn primary" onClick={onEdit}><Pencil size={14} /> Изменить</button>
        </div>
      </div>
    </div>
  </div>;
}

/* --------------------------- Кассы и счета --------------------------- */

function AccountsSheet({ db, accounts, expenses, requestConfirm, directoryItems, onChange, onClose }) {
  const empty = { name: '', kind: 'cash', balance: '' };
  const [edit, setEdit] = useState(accounts.length ? null : { values: empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggestions = directoryItems.filter((i) => i.kind === 'cashboxes' || i.kind === 'accounts').map((i) => i.data?.name).filter(Boolean);
  const used = (id) => expenses.some((e) => e.accountId === id || e.toAccountId === id);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const { account, values } = edit;
    if (account && values.balance !== '' && Number(String(values.balance).replace(',', '.')) !== account.balance
      && !await requestConfirm({ title: 'Изменить остаток вручную?', message: `Остаток «${account.name}» будет установлен ${money(Number(String(values.balance).replace(',', '.')))} вместо ${money(account.balance)}. Используйте это для сверки с фактическими деньгами.`, confirmLabel: 'Изменить остаток', danger: false })) return;
    setBusy(true);
    try {
      const saved = await saveAccount(db, account, values);
      onChange(account ? accounts.map((a) => (a.id === saved.id ? saved : a)) : [...accounts, saved]);
      setEdit(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const toggleArchive = async (a) => {
    setError('');
    try { const saved = await saveAccount(db, a, { name: a.name, kind: a.kind, archived: !a.archived }); onChange(accounts.map((x) => (x.id === saved.id ? saved : x))); }
    catch (err) { setError(err.message); }
  };
  const remove = async (a) => {
    if (!await requestConfirm({ title: 'Удалить кассу или счёт?', message: `«${a.name}» будет удалена. Операций по ней нет.`, confirmLabel: 'Удалить', danger: true })) return;
    try { await deleteAccount(db, a.id); onChange(accounts.filter((x) => x.id !== a.id)); }
    catch (err) { setError(err.message); }
  };

  return <div className="overlay" onClick={busy ? undefined : onClose}>
    <div className="sheet exp-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="sheet-hd"><div className="sheet-name">Кассы и счета</div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></div>
      <div className="sheet-body">
        <p className="muted exp-sheet-note">Остаток меняется автоматически при добавлении, изменении и удалении операций. Ручная правка остатка — только для сверки.</p>
        {accounts.map((a) => (
          <div key={a.id} className={`exp-acc-row ${a.archived ? 'archived' : ''}`}>
            <span>{a.kind === 'cash' ? <Wallet size={14} /> : <Landmark size={14} />}</span>
            <span className="exp-acc-name"><b>{a.name}</b><small className="muted">{ACCOUNT_KINDS[a.kind]}{a.archived ? ' · в архиве' : ''}</small></span>
            <b className={`num ${a.balance < 0 ? 'exp-neg' : ''}`}>{money(a.balance)}</b>
            <span className="exp-acc-actions">
              <button className="icon-btn-ghost" title="Изменить" onClick={() => setEdit({ account: a, values: { name: a.name, kind: a.kind, balance: String(a.balance) } })}><Pencil size={13} /></button>
              <button className="icon-btn-ghost" title={a.archived ? 'Вернуть из архива' : 'Скрыть в архив'} onClick={() => toggleArchive(a)}>{a.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}</button>
              {!used(a.id) && <button className="icon-btn-ghost" title="Удалить" onClick={() => remove(a)}><Trash2 size={13} /></button>}
            </span>
          </div>
        ))}
        {edit ? <form className="exp-acc-form" onSubmit={save}>
          <label className="field"><span>Название</span>
            <input autoFocus value={edit.values.name} maxLength={100} list="exp-acc-suggest" placeholder="Например: Касса магазина, Сбер счёт"
              onChange={(e) => setEdit((s) => ({ ...s, values: { ...s.values, name: e.target.value } }))} />
            <datalist id="exp-acc-suggest">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <div className="field"><span>Тип</span>
            <div className="seg-toggle">
              {Object.entries(ACCOUNT_KINDS).map(([k, label]) => <button key={k} type="button" className={edit.values.kind === k ? 'on' : ''} onClick={() => setEdit((s) => ({ ...s, values: { ...s.values, kind: k } }))}>{label}</button>)}
            </div>
          </div>
          <label className="field"><span>{edit.account ? 'Остаток, ₽' : 'Начальный остаток, ₽'}</span>
            <input value={edit.values.balance} inputMode="decimal" placeholder="0" onChange={(e) => setEdit((s) => ({ ...s, values: { ...s.values, balance: e.target.value } }))} />
          </label>
          <div className="sheet-actions">
            {accounts.length > 0 && <button type="button" className="btn ghost" onClick={() => setEdit(null)} disabled={busy}>Отмена</button>}
            <button className="btn primary" disabled={busy || !edit.values.name.trim()}>{busy ? 'Сохраняем…' : edit.account ? 'Сохранить' : 'Добавить'}</button>
          </div>
        </form> : <button className="btn ghost exp-wide" onClick={() => setEdit({ values: empty })}><Plus size={14} /> Касса или счёт</button>}
        {error && <p className="exp-notice error" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}

/* --------------------------- Категории --------------------------- */

function CategoriesSheet({ db, categories, expenses, requestConfirm, onChange, onClose }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const c = await addCategory(db, name, categories); onChange([...categories, c]); setName(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    if (expenses.some((e) => e.category === c.id)) { setError(`По категории «${c.name}» есть операции — сначала измените или удалите их.`); return; }
    if (!await requestConfirm({ title: 'Удалить категорию?', message: `Категория «${c.name}» будет удалена.`, confirmLabel: 'Удалить', danger: true })) return;
    try { await removeCategory(db, c.id); onChange(categories.filter((x) => x.id !== c.id)); }
    catch (err) { setError(err.message); }
  };
  return <div className="overlay" onClick={onClose}>
    <div className="sheet exp-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="sheet-hd"><div className="sheet-name">Категории расходов</div><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></div>
      <div className="sheet-body">
        {BUILTIN_CATEGORIES.map((c) => <div key={c.id} className="exp-acc-row"><span className="exp-acc-name"><b>{c.name}</b><small className="muted">{c.hint}{c.id === 'collection' ? ' · не входит в расчёт прибыли' : ''}</small></span></div>)}
        {categories.map((c) => <div key={c.id} className="exp-acc-row">
          <span className="exp-acc-name"><b>{c.name}</b><small className="muted">Своя категория</small></span>
          <span className="exp-acc-actions"><button className="icon-btn-ghost" title="Удалить" onClick={() => remove(c)}><Trash2 size={13} /></button></span>
        </div>)}
        <form className="exp-cat-form" onSubmit={add}>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Новая категория, например «Аренда»" aria-label="Новая категория" />
          <button className="btn primary" disabled={busy || !name.trim()}><Plus size={14} /> Добавить</button>
        </form>
        {error && <p className="exp-notice error" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}
