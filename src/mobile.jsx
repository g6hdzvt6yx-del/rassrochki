/* ------------------------------------------------------------------ */
/*  Мобильная версия (экран ≤ 768 px)                                  */
/*                                                                     */
/*  Здесь только внешний вид и навигация. Все расчёты, загрузка и      */
/*  сохранение остаются в rassrochki.jsx — сюда приходят готовые       */
/*  данные и обработчики. Компьютерная версия этот файл не использует. */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  LayoutGrid, ScrollText, Plus, Landmark, Menu, X, ChevronLeft, ChevronRight, Wallet,
  Phone, MessageCircle, Check, TrendingUp, CheckCircle2, Users, AlertTriangle,
  Search, SlidersHorizontal, ChevronDown, MoreHorizontal, Clock, Pencil, Printer, Trash2, Undo2, Paperclip, FileText,
} from "lucide-react";
import {
  money, fmtDate, fmtPhone, waReminderLink, contractStats, Badge, Ribbon, Field, DateFields, WITHDRAWAL_PURPOSES,
  css as desktopCss, // временно, пока не все окна переведены на мобильный вид
} from "./rassrochki.jsx";

const todayIso = () => new Date().toISOString().slice(0, 10);

// только цифры (и одна точка для дробных) — для полей сумм с цифровой клавиатурой
export const cleanNum = (v, decimal) => {
  let s = String(v || "").replace(",", ".");
  if (!decimal) return s.replace(/\D/g, "");
  s = s.replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
};

export const MOBILE_QUERY = "(max-width: 768px)";

/* ------------------------- Определение телефона -------------------- */

export function useIsMobile() {
  const get = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/* ------------------------- Тема: авто / светлая / тёмная ------------ */

const THEME_KEY = "rassrochki-theme";
const themeSubs = new Set();
const readThemePref = () => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch { return "auto"; }
};
let themePref = typeof window !== "undefined" ? readThemePref() : "auto";

export const setThemePref = (v) => {
  themePref = v;
  try { localStorage.setItem(THEME_KEY, v); } catch { /* приватный режим — просто не запоминаем */ }
  themeSubs.forEach((f) => f());
};

const subscribeTheme = (f) => {
  themeSubs.add(f);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", f);
  return () => { themeSubs.delete(f); mq.removeEventListener("change", f); };
};

export const useThemePref = () => useSyncExternalStore(subscribeTheme, () => themePref, () => "auto");

// итоговая тема с учётом настроек телефона: "light" | "dark"
export const useTheme = () => useSyncExternalStore(
  subscribeTheme,
  () => (themePref === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : themePref),
  () => "light",
);

// цвет системной строки браузера под тему (только пока открыта мобильная версия)
function useThemeColorMeta(theme) {
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]');
    const created = !meta;
    if (created) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme === "dark" ? "#0E1714" : "#EEF1EB";
    return () => { if (created) meta.remove(); };
  }, [theme]);
}

/* ------------------------- Кнопка «Назад» и шторки ------------------ */
/*  Каждая открытая шторка — запись в истории браузера. Системная       */
/*  кнопка «Назад» (Android, жест iOS) закрывает верхнюю шторку, а не   */
/*  уводит со страницы. Синхронизация отложенная, поэтому замена одной  */
/*  шторки другой за один кадр не трогает историю.                      */

const sheetStack = [];
let ownedEntries = 0;  // сколько записей истории добавили мы
let pendingGo = 0;     // сколько записей сейчас убираем сами через history.go
let syncTimer = null;
let popListening = false;

const syncHistory = () => {
  syncTimer = null;
  if (pendingGo) return; // досинхронизируемся после popstate
  const want = sheetStack.length;
  while (ownedEntries < want) {
    window.history.pushState({ ...(window.history.state || {}), mSheet: ownedEntries + 1 }, "");
    ownedEntries += 1;
  }
  if (ownedEntries > want) {
    pendingGo = ownedEntries - want;
    window.history.go(-pendingGo);
  }
  document.body.style.overflow = want ? "hidden" : "";
};

const scheduleSync = () => {
  if (syncTimer) return;
  syncTimer = setTimeout(syncHistory, 0);
};

const ensurePopListener = () => {
  if (popListening) return;
  popListening = true;
  window.addEventListener("popstate", () => {
    if (pendingGo) {
      ownedEntries -= pendingGo;
      pendingGo = 0;
      scheduleSync();
      return;
    }
    if (ownedEntries > 0) {
      ownedEntries -= 1;
      const top = sheetStack.pop();
      if (top) top.close();
      scheduleSync();
    }
  });
};

function useBackClose(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    ensurePopListener();
    const entry = { close: () => ref.current && ref.current() };
    sheetStack.push(entry);
    scheduleSync();
    return () => {
      const i = sheetStack.indexOf(entry);
      if (i !== -1) sheetStack.splice(i, 1);
      scheduleSync();
    };
  }, []);
}

/* ------------------------- Базовые элементы ------------------------ */

// Шторка снизу (или на весь экран — full). Рендерится поверх всего приложения.
export function Sheet({ title, subtitle, onClose, children, footer, full, left, right, className = "" }) {
  useBackClose(onClose);
  const theme = useTheme();
  const sheetRef = useRef(null);
  const drag = useRef(null);

  // свайп вниз за «ручку» или заголовок закрывает шторку
  const onTouchStart = (e) => {
    if (full) return;
    drag.current = { y: e.touches[0].clientY, dy: 0 };
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  };
  const onTouchMove = (e) => {
    if (!drag.current || !sheetRef.current) return;
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onTouchEnd = () => {
    if (!drag.current || !sheetRef.current) return;
    const { dy } = drag.current;
    drag.current = null;
    sheetRef.current.style.transition = "";
    sheetRef.current.style.transform = "";
    if (dy > 90) onClose();
  };

  return createPortal(
    <div className="m-app m-portal" data-theme={theme}>
      <div className="m-ov" onClick={onClose}>
        <div
          ref={sheetRef}
          className={`m-sheet ${full ? "full" : ""} ${className}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
        >
          <div className="m-sh-top" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            {!full && <div className="m-grab" />}
            <div className="m-sh-hd">
              {left}
              <div className="m-sh-titles">
                <div className="m-sh-title">{title}</div>
                {subtitle && <div className="m-sh-sub">{subtitle}</div>}
              </div>
              {right}
              {!full && (
                <button type="button" className="m-ib" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
              )}
            </div>
          </div>
          <div className="m-sh-body">{children}</div>
          {footer && <div className="m-sh-ft">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// кнопка «Назад» для шапки шторки на весь экран
export const BackBtn = ({ onClick }) => (
  <button type="button" className="m-ib m-back" onClick={onClick} aria-label="Назад"><ChevronLeft size={22} /></button>
);

/* ------------------------- Корневая обёртка ------------------------ */

function MobileRoot({ children, className = "" }) {
  const theme = useTheme();
  useThemeColorMeta(theme);
  return (
    <div className={`m-app m-root ${className}`} data-theme={theme}>
      <style>{mcss}</style>
      {children}
    </div>
  );
}

// экраны «Загрузка…», «Ошибка» и т. п.
export function MobileStatus({ text, onRetry }) {
  return (
    <MobileRoot>
      <div className="m-status">
        <div className="m-logo"><Wallet size={22} /></div>
        <div className="m-status-text">{text}</div>
        {onRetry && <button type="button" className="m-btn primary" onClick={onRetry}>Повторить</button>}
      </div>
    </MobileRoot>
  );
}

/* --------------------------- Вход --------------------------------- */

export function MLogin({ email, setEmail, password, setPassword, submit, busy, error }) {
  return (
    <MobileRoot>
      <div className="m-login">
        <form className="m-login-card" onSubmit={submit}>
          <div className="m-logo"><Wallet size={22} /></div>
          <div className="m-login-title">Рассрочки</div>
          <div className="m-login-sub">Войдите, чтобы продолжить</div>
          <Field label="Email">
            <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Пароль">
            <input type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div className="m-alert">{error}</div>}
          <button className="m-btn primary block" type="submit" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
      </div>
    </MobileRoot>
  );
}

/* --------------------------- Приложение ---------------------------- */

const TABS = [
  { key: "dashboard", label: "Сводка", icon: LayoutGrid },
  { key: "contracts", label: "Договоры", icon: ScrollText },
  { key: "add" },
  { key: "capital", label: "Капитал", icon: Landmark },
  { key: "more", label: "Ещё", icon: Menu },
];

export function MobileApp({ app, children }) {
  const { tab, setTab, setAdding, storageError, contracts } = app;
  const [more, setMore] = useState(false);
  const [quickPay, setQuickPay] = useState(null); // { cid, idx }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const onQuickPay = (cid, idx) => setQuickPay({ cid, idx });
  const active = more ? "more" : tab;

  const go = (key) => {
    if (key === "add") { setAdding(true); return; }
    if (key === "more") setMore(true);
    else { setMore(false); setTab(key); }
    window.scrollTo(0, 0);
  };

  const screen = { title: "", sub: null, actions: null, extra: null, body: null };
  if (active === "dashboard") {
    screen.title = "Сводка";
    screen.sub = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    screen.body = <Dashboard app={app} onQuickPay={onQuickPay} />;
  } else if (active === "contracts") {
    screen.title = "Договоры";
    screen.sub = contracts.length ? `${contracts.length} всего` : null;
    if (contracts.length) {
      const filtersOn = app.sortBy !== "created" || app.investorFilter !== "all";
      screen.actions = (
        <button type="button" className="m-ib" onClick={() => setFiltersOpen(true)} aria-label="Сортировка и фильтры">
          <SlidersHorizontal size={20} />{filtersOn && <i className="m-dot" />}
        </button>
      );
      screen.extra = <ContractsToolbar app={app} />;
    }
    screen.body = <Contracts app={app} onQuickPay={onQuickPay} openFilters={() => setFiltersOpen(true)} />;
  } else if (active === "capital") {
    screen.title = "Капитал";
    screen.sub = "вкладчики, прибыль и выводы";
    screen.body = <Capital app={app} />;
  } else {
    screen.title = "Ещё";
    screen.body = <Placeholder />;
  }

  return (
    <MobileRoot>
      <style>{desktopCss}</style>
      <header className="m-top">
        <div className="m-top-row">
          <div className="m-top-titles">
            <h1 className="m-title">{screen.title}</h1>
            {screen.sub && <div className="m-top-sub">{screen.sub}</div>}
          </div>
          {screen.actions}
        </div>
        {screen.extra}
      </header>

      {storageError && (
        <div className="m-alert m-alert-wide">
          Не удалось сохранить последние изменения в базе данных. Изменения видны сейчас,
          но пропадут после перезагрузки страницы.
          <span className="m-alert-detail">Ошибка: {storageError}</span>
        </div>
      )}

      <main className="m-main">{screen.body}</main>

      <nav className="m-tabbar" aria-label="Разделы">
        {TABS.map((t) => (t.key === "add" ? (
          <div key="add" className="m-tab-fab-wrap">
            <button type="button" className="m-fab" onClick={() => go("add")} aria-label="Новый договор">
              <Plus size={26} />
            </button>
          </div>
        ) : (
          <button
            key={t.key}
            type="button"
            className={`m-tab ${active === t.key ? "on" : ""}`}
            onClick={() => go(t.key)}
            aria-current={active === t.key ? "page" : undefined}
          >
            <t.icon size={22} />
            <span>{t.label}</span>
          </button>
        )))}
      </nav>

      {children}
      {quickPay && <QuickPay app={app} target={quickPay} onClose={() => setQuickPay(null)} />}
      {filtersOpen && <FiltersSheet app={app} onClose={() => setFiltersOpen(false)} />}
    </MobileRoot>
  );
}

const Placeholder = () => <div className="m-empty">Экран в работе</div>;

/* --------------------------- Общие кусочки ------------------------- */

const SecHd = ({ title, sub, action }) => (
  <div className="m-sec-hd">
    <div className="m-sec-titles">
      <h2>{title}</h2>
      {sub && <div className="m-sec-sub">{sub}</div>}
    </div>
    {action}
  </div>
);

const MStat = ({ icon, label, value, tone, onClick, wide }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`m-stat ${wide ? "wide" : ""} ${tone || ""} ${onClick ? "m-press" : ""}`} onClick={onClick}>
      <span className="m-stat-ic">{icon}</span>
      <span className="m-stat-label">{label}</span>
      <span className="m-stat-val num">{value}</span>
      {onClick && wide && <ChevronRight size={18} className="m-stat-chev" />}
    </Tag>
  );
};

// быстрые кнопки в строке: позвонить, WhatsApp, принять оплату
export function QuickActions({ phone, waLink, onPay, payLabel = "Принять оплату" }) {
  return (
    <div className="m-qa" onClick={(e) => e.stopPropagation()}>
      {phone && (
        <a className="m-ib call" href={`tel:${phone}`} aria-label="Позвонить"><Phone size={19} /></a>
      )}
      {waLink && (
        <a className="m-ib wa" href={waLink} target="_blank" rel="noreferrer" aria-label="Напомнить в WhatsApp">
          <MessageCircle size={19} />
        </a>
      )}
      {onPay && (
        <button type="button" className="m-btn success sm" onClick={onPay}><Check size={18} /> {payLabel}</button>
      )}
    </div>
  );
}

/* --------------------------- Оплата платежа ------------------------ */

// шторка ввода оплаты: дата и сумма (можно часть); mode "edit" — только дата
export function PaySheet({ title, subtitle, row, mode = "new", date, setDate, amount, setAmount, onConfirm, onClose }) {
  const canConfirm = mode === "edit" ? !!date : +amount > 0;
  return (
    <Sheet
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <button type="button" className="m-btn success block" disabled={!canConfirm} onClick={onConfirm}>
          <Check size={19} /> {mode === "edit" ? "Сохранить дату" : "Подтвердить оплату"}
        </button>
      }
    >
      {row && mode === "new" && (
        <div className="m-card m-paybox">
          <div><span>Платёж по графику</span><b className="num">{money(row.amountDue)}</b></div>
          {row.paidAmount > 0 && <div><span>Уже оплачено</span><b className="num">{money(row.paidAmount)}</b></div>}
          <div><span>Осталось внести</span><b className="num strong">{money(row.remainingDue)}</b></div>
        </div>
      )}
      <Field label="Дата оплаты">
        <DateFields value={date} onChange={setDate} />
      </Field>
      {mode === "new" && (
        <>
          <Field label="Сумма, ₽">
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={amount}
              onChange={(e) => setAmount(cleanNum(e.target.value))} placeholder="0" />
          </Field>
          {row && (
            <div className="m-chips">
              <button type="button" className={`m-chip ${+amount === row.remainingDue ? "on" : ""}`}
                onClick={() => setAmount(String(row.remainingDue))}>
                Весь остаток · {money(row.remainingDue)}
              </button>
            </div>
          )}
          <div className="m-hint">Можно внести часть суммы — остаток останется в графике.</div>
        </>
      )}
    </Sheet>
  );
}

// «Принять оплату» прямо из списка — ближайший неоплаченный платёж договора
function QuickPay({ app, target, onClose }) {
  const c = app.contracts.find((x) => x.id === target.cid);
  const row = c ? contractStats(c).rows.find((r) => r.index === target.idx) : null;
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(row ? String(row.remainingDue) : "");
  if (!c || !row) return null;
  return (
    <PaySheet
      title="Принять оплату"
      subtitle={`${c.clientName} · №${row.n} от ${fmtDate(row.dueDate)}`}
      row={row}
      date={date}
      setDate={setDate}
      amount={amount}
      setAmount={setAmount}
      onClose={onClose}
      onConfirm={() => { app.payPayment(c.id, row.index, date, +amount || 0); onClose(); }}
    />
  );
}

/* --------------------------- Сводка -------------------------------- */

function Dashboard({ app, onQuickPay }) {
  const { totals, capital, monthlyStats, setSectionModal, setOpenId } = app;
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
        <MStat icon={<Wallet size={18} />} label="Выдано в рассрочку" value={money(totals.financed)} onClick={() => setSectionModal("financed")} />
        <MStat icon={<TrendingUp size={18} />} label="Общая прибыль" value={money(capital.profitTotal)} onClick={() => setSectionModal("profit")} />
        <MStat icon={<CheckCircle2 size={18} />} label="Прибыль получена" value={money(capital.profitRealized)} onClick={() => setSectionModal("profitRealized")} />
        <MStat icon={<Users size={18} />} label="Активных договоров" value={totals.active} onClick={() => setSectionModal("active")} />
        <MStat wide icon={<AlertTriangle size={18} />} label="Должников (просрочка)" value={totals.debtors}
          tone={totals.debtors ? "clay" : ""} onClick={() => setSectionModal("debtors")} />
      </div>

      <SecHd title="Ближайшие платежи" />
      {totals.upcoming.length === 0 ? (
        <div className="m-empty">Всё оплачено — открытых платежей нет.</div>
      ) : (
        <div className="m-list">
          {totals.upcoming.map((r) => (
            <div key={r.cid + "-" + r.index} className="m-card m-press" role="button" tabIndex={0}
              onClick={() => setOpenId(r.cid)}>
              <div className="m-row1">
                <span className="m-name">{r.client}</span>
                <Badge s={r.status} />
              </div>
              <div className="m-row2">
                <span className="m-meta">
                  {fmtDate(r.dueDate)}
                  {r.phone && <><br />{fmtPhone(r.phone)}</>}
                </span>
                <span className="m-amt num">{money(r.amountDue)}</span>
              </div>
              {r.paidAmount > 0 && (
                <div className="m-note amber">Оплачено {money(r.paidAmount)} — осталось {money(r.remainingDue)}</div>
              )}
              <QuickActions
                phone={r.phone}
                waLink={waReminderLink(r.phone, r.client, r.amountDue, r.dueDate)}
                onPay={() => onQuickPay(r.cid, r.index)}
              />
            </div>
          ))}
        </div>
      )}

      <SecHd title="По месяцам" sub="Под суммой — прибыль (наценка) в её составе" />
      <div className="m-card m-month">
        <div className="m-mini-hd emerald">Получено</div>
        {monthlyStats.past.map((m) => (
          <MonthRow key={m.key} label={m.label} value={m.received} profit={m.receivedProfit} max={monthlyStats.maxPast} cls="fill-received" />
        ))}
        <div className="m-mini-hd m-mini-gap">Ожидается</div>
        {monthlyStats.future.map((m) => (
          <MonthRow key={m.key} label={m.label} value={m.expected} profit={m.expectedProfit} max={monthlyStats.maxFuture} cls="fill-expected" />
        ))}
      </div>
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

/* --------------------------- Договоры ------------------------------ */

const SORTS = [
  ["created", "Сначала новые"], ["dueDate", "По ближайшему платежу"],
  ["name", "По имени (А-Я)"], ["remaining", "По остатку долга"],
];
const STATUS_CHIPS = [["all", "Все"], ["active", "Активные"], ["overdue", "Просрочка"], ["done", "Закрытые"]];

const investorLabelOf = (c, investors) => (c.investorId
  ? (investors.find((i) => i.id === c.investorId)?.name || "—")
  : "Общий пул");

function ContractsToolbar({ app }) {
  const { search, setSearch, statusFilter, setStatusFilter } = app;
  return (
    <div className="m-toolbar">
      <div className="m-search">
        <Search size={18} />
        <input type="search" enterKeyHint="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Имя, телефон, товар" aria-label="Поиск договоров" />
        {search && (
          <button type="button" className="m-search-clear" onClick={() => setSearch("")} aria-label="Очистить"><X size={16} /></button>
        )}
      </div>
      <div className="m-chips m-chips-scroll">
        {STATUS_CHIPS.map(([key, label]) => (
          <button key={key} type="button" className={`m-chip ${statusFilter === key ? "on" : ""}`} onClick={() => setStatusFilter(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContractCard({ c, app, onQuickPay }) {
  const st = contractStats(c);
  const badge = st.done ? "done" : st.overdueSum ? "overdue" : "active";
  const expanded = app.expandedId === c.id;
  const next = st.next;
  const waLink = next ? waReminderLink(c.phone, c.clientName, next.remainingDue ?? next.amountDue, next.dueDate) : null;
  const overdueRows = st.rows.filter((r) => r.status === "overdue");
  const upcomingRows = st.rows.filter((r) => !r.paid && r.status !== "overdue");
  const paidRows = st.rows.filter((r) => r.paid);
  return (
    <div className="m-card m-ccard">
      <div className="m-cc-main" role="button" tabIndex={0} onClick={() => app.setOpenId(c.id)}>
        <div className="m-row1">
          <span className="m-name">{c.clientName}</span>
          <Badge s={badge} />
        </div>
        <div className="m-meta m-cc-sub">{[c.item, investorLabelOf(c, app.investors)].filter(Boolean).join(" · ")}</div>
        <div className="m-row2">
          <span className="m-cc-lbl">Остаток</span>
          {st.overdueSum > 0
            ? <span className="m-note clay m-cc-right">просрочено <b className="num">{money(st.overdueSum)}</b></span>
            : <span className="m-meta m-cc-right">из <span className="num">{money(st.financed)}</span></span>}
        </div>
        <div className="m-amt num m-cc-amt">{money(st.remaining)}</div>
        <Ribbon paid={st.paidSum} overdue={st.overdueSum} remaining={st.remaining} />
        {next && (
          <div className="m-cc-next">
            <span>Следующий платёж</span>
            <span><b className="num">{money(next.remainingDue)}</b> · {fmtDate(next.dueDate)}</span>
          </div>
        )}
      </div>
      {(c.phone || waLink || next) && (
        <QuickActions phone={c.phone} waLink={waLink} onPay={next ? () => onQuickPay(c.id, next.index) : null} />
      )}
      <button type="button" className="m-cc-toggle" onClick={() => app.setExpandedId(expanded ? null : c.id)} aria-expanded={expanded}>
        График платежей <ChevronDown size={18} className={`m-chev ${expanded ? "on" : ""}`} />
      </button>
      {expanded && (
        <div className="m-cc-exp">
          <div className="m-mini-row"><span>Дата составления договора</span><b className="num">{fmtDate(c.startDate)}</b></div>
          {overdueRows.length > 0 && (
            <>
              <div className="m-mini-hd clay m-mini-gap">Просрочено</div>
              {overdueRows.map((r) => (
                <div key={r.index} className="m-mini-row"><span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.remainingDue)}</span></div>
              ))}
            </>
          )}
          {upcomingRows.length > 0 && (
            <>
              <div className="m-mini-hd m-mini-gap">Предстоящие</div>
              {upcomingRows.map((r) => (
                <div key={r.index} className="m-mini-row"><span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.remainingDue)}</span></div>
              ))}
            </>
          )}
          {paidRows.length > 0 && (
            <>
              <div className="m-mini-hd emerald m-mini-gap">История платежей</div>
              {paidRows.map((r) => (
                <div key={r.index} className="m-mini-row"><span>{fmtDate(r.dueDate)}</span><span className="num">{money(r.amountDue)}</span></div>
              ))}
            </>
          )}
          <button type="button" className="m-btn ghost block m-cc-open" onClick={() => app.setOpenId(c.id)}>Открыть договор</button>
        </div>
      )}
    </div>
  );
}

function Contracts({ app, onQuickPay, openFilters }) {
  const { contracts, filteredContracts, groupedContracts, sortBy, setSortBy, investorFilter, setInvestorFilter, investors, setAdding } = app;
  if (contracts.length === 0) {
    return (
      <div className="m-empty">
        Договоров пока нет — добавьте первый.
        <button type="button" className="m-btn primary block m-empty-btn" onClick={() => setAdding(true)}><Plus size={18} /> Новый договор</button>
      </div>
    );
  }
  const filtersOn = [];
  if (sortBy !== "created") filtersOn.push(SORTS.find(([k]) => k === sortBy)?.[1]);
  if (investorFilter !== "all") {
    filtersOn.push(investorFilter === "" ? "Общий пул" : (investors.find((i) => i.id === investorFilter)?.name || "Источник"));
  }
  return (
    <>
      {filtersOn.length > 0 && (
        <div className="m-filter-line">
          <button type="button" className="m-filter-what" onClick={openFilters}><SlidersHorizontal size={15} /> {filtersOn.join(" · ")}</button>
          <button type="button" className="m-link" onClick={() => { setSortBy("created"); setInvestorFilter("all"); }}>Сбросить</button>
        </div>
      )}
      {filteredContracts.length === 0 ? (
        <div className="m-empty">Ничего не найдено по этому запросу или фильтру.</div>
      ) : (
        <div className="m-list">
          {groupedContracts.map((g) => (g.list.length === 1 ? (
            <ContractCard key={g.list[0].id} c={g.list[0]} app={app} onQuickPay={onQuickPay} />
          ) : (
            <div key={"g-" + g.key} className="m-group">
              <div className="m-group-hd">
                <span className="m-group-name"><Users size={16} /> {g.list[0].clientName}</span>
                <span className="m-group-stats">
                  Договоров: {g.list.length} · Остаток <b className="num">{money(g.remaining)}</b>
                  {g.overdue > 0 && <span className="m-group-over"> · Просрочка <span className="num">{money(g.overdue)}</span></span>}
                </span>
              </div>
              <div className="m-list">
                {g.list.map((c) => <ContractCard key={c.id} c={c} app={app} onQuickPay={onQuickPay} />)}
              </div>
            </div>
          )))}
        </div>
      )}
    </>
  );
}

function FiltersSheet({ app, onClose }) {
  const { sortBy, setSortBy, investorFilter, setInvestorFilter, investors, filteredContracts } = app;
  const sources = [["all", "Все источники"], ["", "Общий пул"], ...investors.map((i) => [i.id, i.name])];
  return (
    <Sheet
      title="Сортировка и фильтры"
      onClose={onClose}
      footer={
        <div className="m-ft-row">
          <button type="button" className="m-btn ghost" onClick={() => { setSortBy("created"); setInvestorFilter("all"); }}>Сбросить</button>
          <button type="button" className="m-btn primary" onClick={onClose}>Показать · {filteredContracts.length}</button>
        </div>
      }
    >
      <div className="m-mini-hd">Сортировка</div>
      <div className="m-options">
        {SORTS.map(([key, label]) => (
          <button key={key} type="button" className={`m-option ${sortBy === key ? "on" : ""}`} onClick={() => setSortBy(key)}>
            {label}{sortBy === key && <Check size={19} />}
          </button>
        ))}
      </div>
      <div className="m-mini-hd m-mini-gap">Источник финансирования</div>
      <div className="m-options">
        {sources.map(([key, label]) => (
          <button key={key || "pool"} type="button" className={`m-option ${investorFilter === key ? "on" : ""}`} onClick={() => setInvestorFilter(key)}>
            {label}{investorFilter === key && <Check size={19} />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* --------------------------- Карточка договора --------------------- */
/*  Состояние и действия приходят из Detail (rassrochki.jsx) — здесь     */
/*  только разметка под телефон.                                         */

export function MDetail(p) {
  const {
    contract, st, investorName, comment, setComment,
    payingIdx, setPayingIdx, payMode, payDate, setPayDate, payAmount, setPayAmount,
    startPay, startEditDate, confirmPay, handleFile, printContract, openReceipt,
    onClose, onToggle, onRemoveReceipt, onEarlyPayoff, onDelete, onUpdateComment, onEdit,
  } = p;
  const [menu, setMenu] = useState(false);
  const next = st.next;
  const waLink = contract.phone && next
    ? waReminderLink(contract.phone, contract.clientName, next.remainingDue ?? next.amountDue, next.dueDate)
    : null;
  const payingRow = payingIdx !== null ? st.rows.find((r) => r.index === payingIdx) : null;

  const earlyPayoff = () => {
    if (window.confirm("Отметить все оставшиеся платежи оплаченными сегодняшним числом?")) onEarlyPayoff(contract.id);
  };
  const undoPay = (r) => {
    if (window.confirm(`Отменить отметку об оплате платежа №${r.n}?`)) onToggle(contract.id, r.index);
  };
  const menuAction = (fn) => () => { setMenu(false); fn(); };

  return (
    <Sheet
      full
      title={contract.clientName}
      subtitle={contract.item || null}
      onClose={onClose}
      left={<BackBtn onClick={onClose} />}
      right={
        <>
          {waLink && (
            <a className="m-ib wa" href={waLink} target="_blank" rel="noreferrer" aria-label="Напомнить в WhatsApp">
              <MessageCircle size={20} />
            </a>
          )}
          <button type="button" className="m-ib" onClick={() => setMenu(true)} aria-label="Действия с договором">
            <MoreHorizontal size={20} />
          </button>
        </>
      }
    >
      <div className="m-hero m-hero-static">
        <span className="m-hero-label">Остаток долга</span>
        <span className="m-hero-num num">{money(st.remaining)}</span>
        <Ribbon paid={st.paidSum} overdue={st.overdueSum} remaining={st.remaining} />
        <span className="m-legend">
          <span><i className="m-dot s-paid" />Оплачено<b className="num">{money(st.paidSum)}</b></span>
          <span><i className="m-dot s-over" />Просрочено<b className="num">{money(st.overdueSum)}</b></span>
          <span><i className="m-dot s-rem" />К оплате<b className="num">{money(st.financed)}</b></span>
        </span>
      </div>

      <div className="m-card m-contacts">
        <div className="m-contact">
          <div className="m-contact-info">
            <span className="m-contact-lbl">Клиент</span>
            <span className="m-contact-val">{contract.phone ? fmtPhone(contract.phone) : "телефон не указан"}</span>
          </div>
          {contract.phone && <a className="m-ib call" href={`tel:${contract.phone}`} aria-label="Позвонить клиенту"><Phone size={19} /></a>}
          {waLink && (
            <a className="m-ib wa" href={waLink} target="_blank" rel="noreferrer" aria-label="WhatsApp клиенту"><MessageCircle size={19} /></a>
          )}
        </div>
        <div className="m-contact">
          <div className="m-contact-info">
            <span className="m-contact-lbl">Поручитель</span>
            <span className="m-contact-val">
              {contract.guarantorName || "не указан"}
              {contract.guarantorPhone ? ` · ${fmtPhone(contract.guarantorPhone)}` : ""}
            </span>
          </div>
          {contract.guarantorPhone && (
            <a className="m-ib call" href={`tel:${contract.guarantorPhone}`} aria-label="Позвонить поручителю"><Phone size={19} /></a>
          )}
        </div>
      </div>

      <div className="m-grid2">
        <div><span>Цена</span><b className="num">{money(contract.totalPrice)}</b></div>
        <div><span>Взнос</span><b className="num">{money(contract.downPayment)}</b></div>
        <div><span>Наценка</span><b className="num">{money(contract.markup)}{contract.markupPercent ? ` (${contract.markupPercent}%)` : ""}</b></div>
        <div><span>Срок</span><b className="num">{contract.termMonths} мес</b></div>
        <div><span>К оплате</span><b className="num">{money(st.financed)}</b></div>
        <div><span>Остаток</span><b className="num strong">{money(st.remaining)}</b></div>
        <div><span>Источник</span><b>{investorName}</b></div>
        <div><span>Первый платёж</span><b className="num">{fmtDate(contract.startDate)}</b></div>
      </div>

      <div className="m-ft-row m-det-btns">
        <button type="button" className="m-btn ghost" onClick={() => onEdit(contract)}><Pencil size={17} /> Изменить</button>
        <button type="button" className="m-btn ghost" onClick={printContract}><Printer size={17} /> Печать</button>
      </div>

      <Field label="Комментарий">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Заметки по договору…" rows={2} />
      </Field>
      {comment !== (contract.comment || "") && (
        <button type="button" className="m-btn primary block m-comment-save" onClick={() => onUpdateComment(contract.id, comment)}>
          Сохранить комментарий
        </button>
      )}

      <SecHd
        title="График платежей"
        sub={`${st.rows.filter((r) => r.paid).length} из ${st.rows.length} оплачено`}
        action={!st.done && (
          <button type="button" className="m-btn ghost sm" onClick={earlyPayoff}><CheckCircle2 size={17} /> Досрочно</button>
        )}
      />
      <div className="m-list">
        {st.rows.map((r) => (
          <div key={r.index} className={`m-card m-lrow ${r.status}`}>
            <div className="m-lrow-top">
              <span className="m-lnum num">{r.n}</span>
              <span className="m-lrow-info">
                <span className="m-ldate">{fmtDate(r.dueDate)}</span>
                {r.paidDate && <span className="m-lsub">{r.paid ? "Оплачен" : "Внесено"} {fmtDate(r.paidDate)}</span>}
              </span>
              <span className="m-lrow-right">
                <b className="num">{money(r.amountDue)}</b>
                <Badge s={r.status} />
              </span>
            </div>
            {r.paidAmount > 0 && !r.paid && (
              <div className="m-note amber">Оплачено {money(r.paidAmount)} из {money(r.amountDue)} — остаток {money(r.remainingDue)}</div>
            )}
            <div className="m-lrow-acts">
              {r.paid ? (
                <>
                  <button type="button" className="m-btn ghost sm" onClick={() => undoPay(r)}><Undo2 size={17} /> Отменить</button>
                  <button type="button" className="m-btn ghost sm" onClick={() => startEditDate(r.index, r.paidDate)}><Pencil size={16} /> Дата</button>
                </>
              ) : r.paidAmount > 0 ? (
                <>
                  <button type="button" className="m-btn success sm m-grow" onClick={() => startPay(r.index, r.remainingDue)}><Check size={18} /> Доплатить</button>
                  <button type="button" className="m-ib" onClick={() => undoPay(r)} aria-label="Сбросить оплату"><Undo2 size={18} /></button>
                </>
              ) : (
                <button type="button" className="m-btn success sm m-grow" onClick={() => startPay(r.index, r.remainingDue)}><Check size={18} /> Оплатить</button>
              )}
              {r.receipt ? (
                <span className="m-receipt">
                  <button type="button" className="m-receipt-link" onClick={() => openReceipt(r.receipt)}>
                    <FileText size={16} /><span>{r.receipt.name}</span>
                  </button>
                  <button type="button" className="m-receipt-x" onClick={() => onRemoveReceipt(contract.id, r.index)} aria-label="Удалить чек">
                    <X size={16} />
                  </button>
                </span>
              ) : (
                <label className="m-btn ghost sm m-receipt-add" htmlFor={`m-receipt-${contract.id}-${r.index}`}>
                  <Paperclip size={16} /> Чек
                  <input id={`m-receipt-${contract.id}-${r.index}`} type="file" accept="image/*,application/pdf"
                    className="m-hidden" onChange={(e) => handleFile(e, r.index)} />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {payingRow && (
        <PaySheet
          title={payMode === "edit" ? "Дата оплаты" : payingRow.paidAmount > 0 ? "Доплата" : "Оплата"}
          subtitle={`Платёж №${payingRow.n} от ${fmtDate(payingRow.dueDate)}`}
          row={payingRow}
          mode={payMode}
          date={payDate}
          setDate={setPayDate}
          amount={payAmount}
          setAmount={setPayAmount}
          onClose={() => setPayingIdx(null)}
          onConfirm={() => confirmPay(payingRow.index)}
        />
      )}

      {menu && (
        <Sheet title="Договор" subtitle={contract.clientName} onClose={() => setMenu(false)}>
          <div className="m-options">
            <button type="button" className="m-option" onClick={menuAction(() => onEdit(contract))}><span><Pencil size={18} /> Изменить договор</span></button>
            <button type="button" className="m-option" onClick={menuAction(printContract)}><span><Printer size={18} /> Печать</span></button>
            {!st.done && (
              <button type="button" className="m-option" onClick={menuAction(earlyPayoff)}><span><CheckCircle2 size={18} /> Досрочное погашение</span></button>
            )}
            <button type="button" className="m-option danger" onClick={menuAction(() => onDelete(contract.id))}><span><Trash2 size={18} /> Удалить договор</span></button>
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}

/* --------------------------- Новый / изменить договор -------------- */

// обёртка обработчика: чистим ввод до цифр и передаём дальше как событие
const numEvt = (handler, decimal) => (e) => handler({ target: { value: cleanNum(e.target.value, decimal) } });

const NumInput = ({ value, onChange, decimal, placeholder = "0" }) => (
  <input type="text" inputMode={decimal ? "decimal" : "numeric"} pattern={decimal ? undefined : "[0-9]*"}
    value={value} onChange={numEvt(onChange, decimal)} placeholder={placeholder} />
);

export function MAddForm({
  f, setF, set, editing, investors, onClose, submit, showGuarantor, setShowGuarantor,
  onMarkupPercent, onMarkupAmount, onMonthlyPayment, onTermMonths, markup, financed, valid,
}) {
  return (
    <Sheet
      title={editing ? "Изменить договор" : "Новый договор"}
      subtitle={editing ? editing.clientName : null}
      onClose={onClose}
      className="m-tall"
      footer={
        <>
          <div className="m-calc">
            <div><span>Наценка</span><b className="num">{money(markup)}</b></div>
            <div><span>К оплате в рассрочку</span><b className="num">{money(financed)}</b></div>
          </div>
          <button type="button" className="m-btn primary block" disabled={!valid} onClick={submit}>
            {editing ? "Сохранить изменения" : "Создать договор"}
          </button>
        </>
      }
    >
      <div className="m-mini-hd">Клиент</div>
      <Field label="ФИО клиента">
        <input value={f.clientName} onChange={set("clientName")} placeholder="Иванов Иван" autoCapitalize="words" autoComplete="off" />
      </Field>
      <Field label="Телефон">
        <input type="tel" inputMode="tel" autoComplete="off" value={f.phone} onChange={set("phone")} placeholder="+7 …" />
      </Field>
      {showGuarantor ? (
        <>
          <Field label="Поручитель, ФИО">
            <input value={f.guarantorName} onChange={set("guarantorName")} placeholder="Иванов Иван" autoCapitalize="words" autoComplete="off" />
          </Field>
          <Field label="Поручитель, телефон">
            <input type="tel" inputMode="tel" autoComplete="off" value={f.guarantorPhone} onChange={set("guarantorPhone")} placeholder="+7 …" />
          </Field>
        </>
      ) : (
        <button type="button" className="m-btn ghost block m-add-guarantor" onClick={() => setShowGuarantor(true)}>
          <Plus size={18} /> Добавить поручителя
        </button>
      )}

      <div className="m-mini-hd m-mini-gap">Товар и расчёт</div>
      <Field label="Товар"><input value={f.item} onChange={set("item")} placeholder="Телефон, техника…" /></Field>
      <div className="m-frow">
        <Field label="Цена товара, ₽"><NumInput value={f.totalPrice} onChange={set("totalPrice")} /></Field>
        <Field label="Первонач. взнос, ₽"><NumInput value={f.downPayment} onChange={set("downPayment")} /></Field>
      </div>
      <Field label="Считать процент наценки от">
        <div className="m-seg" role="group">
          <button type="button" className={f.markupBase === "principal" ? "on" : ""}
            onClick={() => setF((prev) => ({ ...prev, markupBase: "principal" }))}>Цена − взнос</button>
          <button type="button" className={f.markupBase === "full" ? "on" : ""}
            onClick={() => setF((prev) => ({ ...prev, markupBase: "full" }))}>Полная цена</button>
        </div>
      </Field>
      <div className="m-frow">
        <Field label="Наценка, %"><NumInput decimal value={f.markupPercent} onChange={onMarkupPercent} placeholder="20" /></Field>
        <Field label="Наценка, ₽"><NumInput value={f.markupAmount} onChange={onMarkupAmount} /></Field>
      </div>
      <div className="m-frow">
        <Field label="Срок, мес"><NumInput value={f.termMonths} onChange={onTermMonths} placeholder="6" /></Field>
        <Field label="Платёж в месяц, ₽"><NumInput value={f.monthlyPayment} onChange={onMonthlyPayment} /></Field>
      </div>
      <Field label="Дата 1-го платежа">
        <DateFields value={f.startDate} onChange={(v) => setF((prev) => ({ ...prev, startDate: v }))} />
      </Field>

      <div className="m-mini-hd m-mini-gap">Дополнительно</div>
      <Field label="Источник финансирования">
        <select value={f.investorId} onChange={set("investorId")}>
          <option value="">Общий пул (без привязки)</option>
          {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
        </select>
      </Field>
      <Field label="Комментарий (необязательно)">
        <textarea value={f.comment} onChange={set("comment")} placeholder="Заметки по договору…" rows={2} />
      </Field>
    </Sheet>
  );
}

/* --------------------------- Капитал ------------------------------- */

function Capital({ app }) {
  const { capital, investors, withdrawals, setAddingInvestor, setAddingWithdrawal, removeInvestor, removeWithdrawal } = app;
  return (
    <>
      <div className="m-hero m-hero-static">
        <span className="m-hero-label">Капитал вкладчиков</span>
        <span className="m-hero-num num">{money(capital.invested)}</span>
        <Ribbon paid={capital.deployed} overdue={capital.free < 0 ? -capital.free : 0} remaining={Math.max(0, capital.free)} />
        <span className="m-legend m-legend-auto">
          <span><i className="m-dot s-paid" />В обороте<b className="num">{money(capital.deployed)}</b></span>
          {capital.free < 0 && (
            <span><i className="m-dot s-over" />Не хватает вложений<b className="num">{money(-capital.free)}</b></span>
          )}
          <span><i className="m-dot s-rem" />Свободно<b className="num">{money(Math.max(0, capital.free))}</b></span>
          {capital.withdrawnTotal > 0 && (
            <span><i className="m-dot m-dot-none" />Выведено всего<b className="num">{money(capital.withdrawnTotal)}</b></span>
          )}
        </span>
      </div>

      <div className="m-stats">
        <MStat icon={<TrendingUp size={18} />} label="Прибыль получена" value={money(capital.profitRealized)} />
        <MStat icon={<Clock size={18} />} label="Прибыль ожидается" value={money(capital.profitExpected)} />
        <MStat wide icon={<Wallet size={18} />} label="Прибыль всего по договорам" value={money(capital.profitTotal)} />
      </div>

      <SecHd
        title="Вкладчики"
        action={<button type="button" className="m-btn primary sm" onClick={() => setAddingInvestor(true)}><Plus size={18} /> Вкладчик</button>}
      />
      {investors.length === 0 ? (
        <div className="m-empty">Вкладчиков пока нет.</div>
      ) : (
        <div className="m-list">
          {investors.map((inv) => {
            const invDeployed = capital.perInvestor[inv.id] || 0;
            const invWithdrawn = capital.withdrawnByInvestor[inv.id] || 0;
            const invFree = (+inv.amount || 0) - invDeployed - invWithdrawn;
            const pct = capital.invested ? Math.round(((+inv.amount || 0) / capital.invested) * 100) : 0;
            const invProfit = capital.profitByInvestor[inv.id] || { realized: 0, expected: 0 };
            return (
              <div key={inv.id} className="m-card m-inv">
                <div className="m-row1">
                  <span className="m-name">{inv.name}</span>
                  <button type="button" className="m-ib m-ib-danger" onClick={() => removeInvestor(inv.id)} aria-label={`Удалить вкладчика ${inv.name}`}>
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="m-inv-sum">
                  <span className="m-amt num">{money(inv.amount)}</span>
                  <span className="m-meta">вклад · доля <b className="num">{pct}%</b></span>
                </div>
                <div className="m-grid2 m-inv-grid">
                  <div><span>В обороте</span><b className="num">{money(invDeployed)}</b></div>
                  <div><span>Выведено</span><b className="num">{money(invWithdrawn)}</b></div>
                  <div className="m-grid2-wide"><span>Свободно</span><b className="num strong">{money(invFree)}</b></div>
                  <div><span>Прибыль получена</span><b className="num">{money(invProfit.realized)}</b></div>
                  <div><span>Прибыль ожидается</span><b className="num">{money(invProfit.expected)}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {capital.perInvestor[""] > 0 && (
        <div className="m-hint m-unassigned">Без привязки к вкладчику в обороте: <b className="num">{money(capital.perInvestor[""])}</b></div>
      )}

      <SecHd
        title="Выводы"
        action={<button type="button" className="m-btn primary sm" onClick={() => setAddingWithdrawal(true)}><Plus size={18} /> Вывод</button>}
      />
      {withdrawals.length === 0 ? (
        <div className="m-empty">Выводов пока не было.</div>
      ) : (
        <div className="m-list">
          {withdrawals.map((w) => {
            const invName = w.investorId
              ? (investors.find((i) => i.id === w.investorId)?.name || "—")
              : "Общий пул / собственные";
            return (
              <div key={w.id} className="m-card m-wd">
                <div className="m-row1">
                  <span className="m-wd-main">
                    <span className="m-amt num">{money(w.amount)}</span>
                    <span className="m-meta">{fmtDate(w.date)} · {invName}</span>
                  </span>
                  <button type="button" className="m-ib m-ib-danger" onClick={() => removeWithdrawal(w.id)} aria-label="Удалить вывод">
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="m-wd-foot">
                  <span className="badge b-brass">{WITHDRAWAL_PURPOSES[w.purpose] || "Прочее"}</span>
                  {w.note && <span className="m-meta">{w.note}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function MAddInvestorForm({ f, set, valid, onClose, submit }) {
  return (
    <Sheet
      title="Новый вкладчик"
      onClose={onClose}
      footer={<button type="button" className="m-btn primary block" disabled={!valid} onClick={submit}>Добавить</button>}
    >
      <Field label="Имя вкладчика">
        <input value={f.name} onChange={set("name")} placeholder="Иванов Пётр" autoCapitalize="words" autoComplete="off" />
      </Field>
      <Field label="Сумма вклада, ₽"><NumInput value={f.amount} onChange={set("amount")} /></Field>
    </Sheet>
  );
}

export function MAddWithdrawalForm({ f, setF, set, valid, investors, onClose, submit }) {
  return (
    <Sheet
      title="Новый вывод средств"
      onClose={onClose}
      footer={<button type="button" className="m-btn primary block" disabled={!valid} onClick={submit}>Вывести</button>}
    >
      <Field label="Сумма, ₽"><NumInput value={f.amount} onChange={set("amount")} /></Field>
      <Field label="Дата">
        <DateFields value={f.date} onChange={(v) => setF((prev) => ({ ...prev, date: v }))} />
      </Field>
      <Field label="С кем рассчитываемся">
        <select value={f.investorId} onChange={set("investorId")}>
          <option value="">Общий пул / собственные средства</option>
          {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
        </select>
      </Field>
      <Field label="Назначение вывода">
        <select value={f.purpose} onChange={set("purpose")}>
          {Object.entries(WITHDRAWAL_PURPOSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>
      <Field label="Комментарий (необязательно)">
        <input value={f.note} onChange={set("note")} placeholder="Например, модель телефона для закупки" />
      </Field>
    </Sheet>
  );
}

/* --------------------------- Детали раздела сводки ------------------ */

export function MSectionDetail({ title, rows, onClose, onOpenContract }) {
  const [main, sub] = String(title || "").split(" — ");
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Sheet title={main} subtitle={sub} onClose={onClose}>
      {rows.length === 0 ? (
        <div className="m-empty">Пусто.</div>
      ) : (
        <>
          <div className="m-total">
            <span>Итого · {rows.length} {rows.length === 1 ? "договор" : rows.length < 5 ? "договора" : "договоров"}</span>
            <b className="num">{money(total)}</b>
          </div>
          <div className="m-list">
            {rows.map((r) => (
              <button key={r.id} type="button" className="m-card m-srow m-press" onClick={() => onOpenContract(r.id)}>
                <span className="m-row1">
                  <span className="m-name">{r.name}</span>
                  <span className="m-amt num">{money(r.amount)}</span>
                </span>
                <span className="m-row2">
                  <span className="m-meta">{r.item || "—"}</span>
                  <Badge s={r.badge} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Стили мобильной версии — всё внутри .m-app                          */
/* ------------------------------------------------------------------ */

const mcss = `
@import url('https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

body:has(.m-root){margin:0;background:#EEF1EB}
body:has(.m-root[data-theme="dark"]){background:#0E1714}

.m-app{
  --bg:#EEF1EB; --surface:#FBFCF9; --surface-2:#F3F5EF; --ink:#16332E; --ink-2:#4E5C57; --ink-3:#7A8781;
  --line:#DCE1D7; --brand:#8C6A2E; --brand-ink:#fff; --brand-soft:#F1E7D6;
  --emerald:#1E7A54; --emerald-soft:#E1F0E7; --clay:#B4463A; --clay-soft:#F7E3E0;
  --amber:#8A6111; --amber-soft:#F6ECD6; --rem:#C7CEBF; --wa:#1E9E55;
  --hero:#16332E; --hero-ink:#EFF3EC; --hero-soft:#9FB0A6; --hero-accent:#D9B574;
  --shadow:0 1px 2px rgba(18,32,28,.05),0 6px 18px rgba(18,32,28,.06);
  --ov:rgba(10,20,17,.45);
  color-scheme:light;
  font-family:'Golos Text',system-ui,-apple-system,sans-serif;
  color:var(--ink); -webkit-font-smoothing:antialiased; -webkit-tap-highlight-color:transparent;
  font-size:15px; line-height:1.35;
}
.m-app[data-theme="dark"]{
  --bg:#0E1714; --surface:#16211D; --surface-2:#1C2A25; --ink:#E7EDE9; --ink-2:#A6B4AD; --ink-3:#77877F;
  --line:#26352F; --brand:#C9A05A; --brand-ink:#1A140A; --brand-soft:rgba(201,160,90,.16);
  --emerald:#4CC38A; --emerald-soft:rgba(76,195,138,.14); --clay:#EC7B6C; --clay-soft:rgba(236,123,108,.15);
  --amber:#E3B04F; --amber-soft:rgba(227,176,79,.15); --rem:#3A4A43; --wa:#3CCB74;
  --hero:#1C2A25; --hero-ink:#E7EDE9; --hero-soft:#A6B4AD; --hero-accent:#D9B574;
  --shadow:none; --ov:rgba(0,0,0,.6);
  color-scheme:dark;
}
.m-app *{box-sizing:border-box}
.m-root{background:var(--bg);min-height:100vh;min-height:100dvh}
.m-portal{position:relative;z-index:100}
:where(.m-app) :where(button,a){font:inherit;color:inherit}
.m-app .num{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.02em}

/* шапка */
.m-top{position:sticky;top:0;z-index:20;background:var(--bg);
  padding:calc(env(safe-area-inset-top) + 6px) 16px 8px}
@supports (backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px)){
  .m-top{background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
}
.m-top-row{display:flex;align-items:center;gap:8px;min-height:48px}
.m-top-titles{flex:1;min-width:0}
.m-title{margin:0;font-size:26px;font-weight:700;letter-spacing:-.01em;line-height:1.15}
.m-top-sub{font-size:13px;color:var(--ink-2);margin-top:1px}

.m-ib{flex-shrink:0;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;cursor:pointer;
  background:var(--surface);border:1px solid var(--line);color:var(--ink);position:relative;text-decoration:none}
.m-ib:active{transform:scale(.95)}
.m-ib.wa{color:var(--wa)}
.m-ib.call{color:var(--emerald)}
.m-ib .m-dot{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--brand)}
.m-back{background:transparent;border-color:transparent;margin-left:-8px}

/* содержимое */
.m-main{padding:6px 16px calc(96px + env(safe-area-inset-bottom));max-width:720px;margin:0 auto;overflow-x:clip}
.m-empty{padding:28px 16px;text-align:center;color:var(--ink-2);font-size:14px;background:var(--surface);
  border:1px dashed var(--line);border-radius:16px}

/* нижняя панель */
.m-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-template-columns:repeat(5,1fr);
  align-items:end;background:var(--surface);border-top:1px solid var(--line);
  padding:4px 4px env(safe-area-inset-bottom)}
@supports (backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px)){
  .m-tabbar{background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
}
.m-tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:54px;
  border:none;background:transparent;cursor:pointer;color:var(--ink-3);font-size:11px;font-weight:600}
.m-tab.on{color:var(--brand)}
.m-tab:active{opacity:.7}
.m-tab-fab-wrap{display:flex;justify-content:center;align-items:flex-start;min-height:54px}
.m-fab{width:56px;height:56px;border-radius:50%;border:4px solid var(--bg);background:var(--brand);color:var(--brand-ink);
  display:grid;place-items:center;cursor:pointer;margin-top:-20px;box-shadow:0 6px 16px rgba(140,106,46,.35)}
.m-fab:active{transform:scale(.94)}

/* кнопки */
.m-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;
  border-radius:13px;border:1px solid transparent;cursor:pointer;font-size:15.5px;font-weight:600;
  text-decoration:none;white-space:nowrap}
.m-btn:active{transform:scale(.98)}
.m-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.m-btn.block{width:100%}
.m-btn.primary{background:var(--brand);color:var(--brand-ink)}
.m-btn.success{background:var(--emerald);color:#fff}
.m-app[data-theme="dark"] .m-btn.success{color:#0B1A13}
.m-btn.ghost{background:var(--surface);border-color:var(--line);color:var(--ink)}
.m-btn.danger{background:var(--clay-soft);color:var(--clay)}
.m-btn.sm{min-height:44px;padding:0 14px;font-size:14.5px;border-radius:12px}

/* предупреждения */
.m-alert{background:var(--clay-soft);color:var(--clay);border-radius:12px;padding:11px 14px;font-size:13.5px;
  line-height:1.45;margin-bottom:14px}
.m-alert-wide{margin:4px 16px 10px}
.m-alert-detail{display:block;margin-top:4px;font-size:12px;opacity:.85;font-family:'IBM Plex Mono',monospace;overflow-wrap:anywhere}

/* поля ввода */
.m-app .field{display:block;margin-bottom:14px;min-width:0}
.m-app .field>span{display:block;font-size:13px;color:var(--ink-2);margin-bottom:6px;font-weight:500}
.m-app .field input,.m-app .field select,.m-app .field textarea{width:100%;min-height:48px;border:1px solid var(--line);
  background:var(--surface);border-radius:12px;padding:12px 14px;font:inherit;font-size:16px;color:var(--ink);
  -webkit-appearance:none;appearance:none}
.m-app .field textarea{min-height:88px;resize:vertical;line-height:1.4}
.m-app .field select{padding-right:40px;background-repeat:no-repeat;background-position:right 14px center;background-size:16px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238A958F' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")}
.m-app .field input:focus,.m-app .field select:focus,.m-app .field textarea:focus{outline:none;border-color:var(--brand);
  box-shadow:0 0 0 3px var(--brand-soft)}
.m-app .field input::placeholder,.m-app .field textarea::placeholder{color:var(--ink-3)}
.m-app .date-fields{display:flex;align-items:center;gap:2px;width:100%;min-height:48px;border:1px solid var(--line);
  background:var(--surface);border-radius:12px;padding:0 14px}
.m-app .date-fields:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.m-app .date-fields input{border:none;background:transparent;font:inherit;font-size:16px;color:var(--ink);
  text-align:center;padding:12px 0;outline:none;min-height:0;box-shadow:none;border-radius:0}
.m-app .date-fields input:focus{border:none;box-shadow:none}
.m-app .date-fields input:nth-child(1),.m-app .date-fields input:nth-child(3){width:2.1em}
.m-app .date-fields input:nth-child(5){width:3.2em}
.m-app .date-fields span{color:var(--ink-3)}

/* шторки */
.m-ov{position:fixed;inset:0;background:var(--ov);display:flex;align-items:flex-end;justify-content:center;
  animation:m-fade .18s ease;overscroll-behavior:contain}
.m-sheet{background:var(--bg);color:var(--ink);width:100%;max-width:640px;border-radius:22px 22px 0 0;
  max-height:calc(100vh - env(safe-area-inset-top) - 24px);max-height:calc(100dvh - env(safe-area-inset-top) - 24px);
  display:flex;flex-direction:column;animation:m-up .24s cubic-bezier(.2,.8,.2,1);transition:transform .2s ease;
  box-shadow:0 -10px 40px rgba(0,0,0,.18)}
.m-sheet.full{height:100vh;height:100dvh;max-height:none;border-radius:0;max-width:none;padding-top:env(safe-area-inset-top)}
@keyframes m-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes m-fade{from{opacity:0}to{opacity:1}}
.m-sh-top{flex-shrink:0;touch-action:none}
.m-sheet.full .m-sh-top{touch-action:auto}
.m-grab{width:38px;height:5px;border-radius:5px;background:var(--line);margin:8px auto 0}
.m-sh-hd{display:flex;align-items:center;gap:8px;padding:8px 12px 10px 16px;min-height:60px}
.m-sheet.full .m-sh-hd{padding:6px 12px 8px}
.m-sh-titles{flex:1;min-width:0}
.m-sh-title{font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m-sh-sub{font-size:13px;color:var(--ink-2);overflow:hidden;margin-top:1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.m-sh-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  padding:4px 16px calc(20px + env(safe-area-inset-bottom))}
.m-sh-ft ~ .m-sh-body,.m-sheet:has(.m-sh-ft) .m-sh-body{padding-bottom:16px}
.m-sh-ft{flex-shrink:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--surface);
  border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px}

/* общие блоки */
.m-press{transition:transform .12s ease}
.m-press:active{transform:scale(.985)}
.m-card{display:block;width:100%;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:14px 16px;box-shadow:var(--shadow);color:var(--ink);cursor:pointer}
.m-list{display:flex;flex-direction:column;gap:10px}
.m-row1{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.m-row2{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:6px}
.m-name{font-size:16px;font-weight:600;min-width:0;overflow-wrap:anywhere;line-height:1.3}
.m-meta{font-size:13px;color:var(--ink-2);min-width:0;overflow-wrap:anywhere}
.m-amt{font-size:20px;font-weight:600;white-space:nowrap}
.m-note{font-size:13px;margin-top:6px}
.m-note.amber{color:var(--amber)}
.m-note.clay{color:var(--clay)}
.m-hint{font-size:13px;color:var(--ink-3);margin-top:8px;line-height:1.4}
.m-qa{display:flex;gap:8px;margin-top:12px}
.m-qa .m-btn{flex:1}
.m-app .strong{font-weight:700}
.m-sec-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:24px 2px 10px}
.m-sec-titles{min-width:0}
.m-sec-hd h2{margin:0;font-size:18px;font-weight:700}
.m-sec-sub{font-size:12.5px;color:var(--ink-3);margin-top:2px}

/* метки статуса и лента долга */
.m-app .badge{display:inline-block;flex-shrink:0;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;white-space:nowrap;line-height:1.2}
.m-app .b-emerald{background:var(--emerald-soft);color:var(--emerald)}
.m-app .b-clay{background:var(--clay-soft);color:var(--clay)}
.m-app .b-amber{background:var(--amber-soft);color:var(--amber)}
.m-app .b-line{background:var(--surface-2);color:var(--ink-2);box-shadow:inset 0 0 0 1px var(--line)}
.m-app .b-brass{background:var(--brand-soft);color:var(--brand)}
.m-app .ribbon{display:flex;height:8px;border-radius:20px;overflow:hidden;background:var(--rem)}
.m-app .seg{display:block;height:100%}
.m-app .s-paid{background:var(--emerald)}
.m-app .s-over{background:var(--clay)}
.m-app .s-rem{background:var(--rem)}

/* главная карточка */
.m-hero{display:block;width:100%;text-align:left;border:none;cursor:pointer;background:var(--hero);color:var(--hero-ink);
  border-radius:22px;padding:18px 18px 16px;margin:4px 0 12px;box-shadow:0 10px 28px rgba(22,51,46,.22)}
.m-app[data-theme="dark"] .m-hero{box-shadow:none;border:1px solid var(--line)}
.m-hero-label{display:flex;align-items:center;gap:4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--hero-accent);font-weight:600}
.m-hero-num{display:block;font-size:34px;font-weight:600;margin:6px 0 14px;line-height:1.1;overflow-wrap:anywhere}
.m-hero .ribbon{height:10px;background:rgba(255,255,255,.16)}
.m-hero .s-paid{background:#4CC38A}
.m-hero .s-over{background:#EC7B6C}
.m-hero .s-rem{background:rgba(255,255,255,.16)}
.m-legend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}
.m-legend>span{display:flex;flex-direction:column;font-size:12px;color:var(--hero-soft);min-width:0}
.m-legend b{font-size:13px;color:var(--hero-ink);font-weight:600;margin-top:2px;overflow-wrap:anywhere}
.m-dot{display:inline-block;width:8px;height:8px;border-radius:3px;margin-bottom:4px}
.m-hero .m-dot.s-paid{background:#4CC38A}
.m-hero .m-dot.s-over{background:#EC7B6C}
.m-hero .m-dot.s-rem{background:rgba(255,255,255,.4)}

/* плитки */
.m-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.m-stat{display:flex;flex-direction:column;align-items:flex-start;text-align:left;background:var(--surface);
  border:1px solid var(--line);border-radius:16px;padding:14px;min-height:96px;color:var(--ink);box-shadow:var(--shadow);cursor:pointer}
.m-stat-ic{color:var(--brand);display:flex}
.m-stat-label{font-size:12.5px;color:var(--ink-2);margin:8px 0 2px;line-height:1.25}
.m-stat-val{font-size:18px;font-weight:600;overflow-wrap:anywhere}
.m-stat.wide{grid-column:1/-1;flex-direction:row;align-items:center;gap:10px;min-height:60px}
.m-stat.wide .m-stat-label{flex:1;margin:0;font-size:14px;color:var(--ink)}
.m-stat.wide .m-stat-val{font-size:20px}
.m-stat-chev{color:var(--ink-3);flex-shrink:0}
.m-stat.clay{border-color:var(--clay-soft);background:linear-gradient(0deg,var(--clay-soft),var(--clay-soft)),var(--surface)}
.m-stat.clay .m-stat-val,.m-stat.clay .m-stat-ic{color:var(--clay)}

/* по месяцам */
.m-month{cursor:default}
.m-mini-hd{font-size:12px;letter-spacing:.05em;text-transform:uppercase;font-weight:600;color:var(--ink-2);margin:2px 0 6px}
.m-mini-hd.emerald{color:var(--emerald)}
.m-mini-hd.clay{color:var(--clay)}
.m-mini-gap{margin-top:16px}
.m-mrow{display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px 0}
.m-mlabel{font-size:13px;color:var(--ink-2);white-space:nowrap}
.m-mbar{display:block;height:8px;border-radius:6px;background:var(--surface-2);overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)}
.m-mbar>span{display:block;height:100%;border-radius:6px}
.m-mbar .fill-received{background:var(--emerald)}
.m-mbar .fill-expected{background:var(--brand)}
.m-mval{text-align:right;min-width:96px}
.m-mval b{display:block;font-size:14px;font-weight:600;white-space:nowrap}
.m-mval small{display:block;font-size:11.5px;color:var(--ink-3);white-space:nowrap}

/* итог в шторке раздела */
.m-total{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--hero);color:var(--hero-ink);
  border-radius:16px;padding:14px 16px;margin-bottom:12px;font-size:13.5px}
.m-total span{color:var(--hero-soft)}
.m-total b{font-size:20px;font-weight:600;white-space:nowrap}
.m-srow .m-row1{align-items:center}
.m-srow .m-amt{font-size:17px}

/* оплата */
.m-paybox{cursor:default;margin-bottom:16px;display:flex;flex-direction:column;gap:6px}
.m-paybox>div{display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--ink-2)}
.m-paybox b{color:var(--ink);font-size:15px}
.m-chips{display:flex;gap:8px;flex-wrap:wrap}
.m-chip{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--line);background:var(--surface);
  color:var(--ink-2);font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.m-chip.on{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}

/* договоры */
.m-toolbar{margin-top:8px}
.m-search{display:flex;align-items:center;gap:8px;min-height:46px;background:var(--surface);border:1px solid var(--line);
  border-radius:13px;padding:0 6px 0 14px;color:var(--ink-3)}
.m-search:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.m-search input{flex:1;min-width:0;border:none;background:transparent;font:inherit;font-size:16px;color:var(--ink);
  padding:11px 0;outline:none;-webkit-appearance:none;appearance:none}
.m-search input::-webkit-search-cancel-button{display:none}
.m-search input::placeholder{color:var(--ink-3)}
.m-search-clear{width:36px;height:36px;border:none;border-radius:10px;background:var(--surface-2);color:var(--ink-2);
  display:grid;place-items:center;cursor:pointer;flex-shrink:0}
.m-chips-scroll{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:10px -16px 0;padding:0 16px 2px}
.m-chips-scroll::-webkit-scrollbar{display:none}
.m-chips-scroll .m-chip{flex-shrink:0}
.m-filter-line{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 10px}
.m-filter-what{display:inline-flex;align-items:center;gap:6px;min-height:36px;border:none;background:var(--brand-soft);color:var(--brand);
  border-radius:18px;padding:0 12px;font-size:13px;font-weight:600;cursor:pointer;min-width:0;text-align:left}
.m-link{border:none;background:transparent;color:var(--brand);font-weight:600;font-size:14px;cursor:pointer;min-height:44px;padding:0 4px}
.m-empty-btn{margin-top:14px}
.m-ccard{cursor:default;padding:0;overflow:hidden}
.m-cc-main{padding:14px 16px 0;cursor:pointer}
.m-cc-main:active{background:var(--surface-2)}
.m-cc-sub{margin-top:2px}
.m-cc-lbl{font-size:12.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.m-cc-right{text-align:right;margin:0}
.m-cc-amt{font-size:24px;margin:2px 0 10px}
.m-cc-next{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--ink-2);margin-top:10px;padding-bottom:2px}
.m-cc-next b{color:var(--ink)}
.m-ccard .m-qa{padding:0 16px}
.m-cc-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:46px;margin-top:12px;
  border:none;border-top:1px solid var(--line);background:transparent;color:var(--ink-2);font-size:14px;font-weight:600;
  padding:0 16px;cursor:pointer}
.m-chev{transition:transform .15s}
.m-chev.on{transform:rotate(180deg)}
.m-cc-exp{padding:0 16px 16px}
.m-mini-row{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:7px 0;border-bottom:1px dashed var(--line)}
.m-mini-row:last-of-type{border-bottom:none}
.m-mini-row b{font-weight:600}
.m-cc-open{margin-top:14px}
.m-group{background:var(--surface-2);border:1px solid var(--line);border-radius:18px;padding:12px 10px 10px}
.m-group-hd{padding:0 6px 10px}
.m-group-name{display:flex;align-items:center;gap:7px;font-weight:700;font-size:16px}
.m-group-stats{display:block;font-size:13px;color:var(--ink-2);margin-top:3px}
.m-group-stats b{color:var(--ink)}
.m-group-over{color:var(--clay);font-weight:600;white-space:nowrap}
.m-options{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.m-option{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:50px;padding:0 16px;border:none;
  background:transparent;color:var(--ink);font-size:15.5px;text-align:left;cursor:pointer;border-bottom:1px solid var(--line)}
.m-option:last-child{border-bottom:none}
.m-option.on{color:var(--brand);font-weight:600}
.m-option:active{background:var(--surface-2)}
.m-ft-row{display:grid;grid-template-columns:auto 1fr;gap:10px}
.m-option>span{display:inline-flex;align-items:center;gap:12px}
.m-option.danger{color:var(--clay)}

/* капитал */
.m-legend-auto{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}
.m-dot-none{background:transparent}
.m-ib-danger{color:var(--ink-3);background:transparent}
.m-ib-danger:active{color:var(--clay)}
.m-inv,.m-wd{cursor:default}
.m-inv .m-row1,.m-wd .m-row1{align-items:center}
.m-inv-sum{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:2px 0 10px}
.m-inv-grid{margin-bottom:0}
.m-inv-grid>div{background:var(--surface-2)}
.m-grid2-wide{grid-column:1/-1}
.m-unassigned{margin-top:10px}
.m-wd-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.m-wd-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}

/* формы */
.m-sheet.m-tall{height:calc(100vh - env(safe-area-inset-top) - 24px);height:calc(100dvh - env(safe-area-inset-top) - 24px)}
.m-frow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.m-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--surface-2);border:1px solid var(--line);border-radius:13px}
.m-seg.three{grid-template-columns:repeat(3,1fr)}
.m-seg button{min-height:42px;border:none;border-radius:10px;background:transparent;color:var(--ink-2);font-size:14.5px;font-weight:600;cursor:pointer}
.m-seg button.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.m-add-guarantor{margin-bottom:14px;color:var(--ink-2)}
.m-calc{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.m-calc>div{background:var(--hero);color:var(--hero-ink);border-radius:12px;padding:9px 12px;min-width:0}
.m-calc span{display:block;font-size:11.5px;color:var(--hero-soft)}
.m-calc b{display:block;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* карточка договора */
.m-hero-static{cursor:default;margin-top:4px}
.m-contacts{cursor:default;padding:4px 16px;margin-bottom:12px}
.m-contact{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
.m-contact:last-child{border-bottom:none}
.m-contact-info{flex:1;min-width:0;display:flex;flex-direction:column}
.m-contact-lbl{font-size:12.5px;color:var(--ink-3)}
.m-contact-val{font-size:15px;font-weight:500;overflow-wrap:anywhere}
.m-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
.m-grid2>div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0}
.m-grid2 span{display:block;font-size:12px;color:var(--ink-3);margin-bottom:2px}
.m-grid2 b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}
.m-det-btns{grid-template-columns:1fr 1fr;margin-bottom:16px}
.m-comment-save{margin:-4px 0 6px}
.m-lrow{cursor:default;padding:12px 14px}
.m-lrow.overdue{border-color:var(--clay-soft);background:linear-gradient(0deg,var(--clay-soft),var(--clay-soft)),var(--surface)}
.m-lrow.partial{background:linear-gradient(0deg,var(--amber-soft),var(--amber-soft)),var(--surface)}
.m-lrow.paid{background:linear-gradient(0deg,var(--emerald-soft),var(--emerald-soft)),var(--surface);border-color:transparent}
.m-lrow-top{display:flex;align-items:center;gap:12px}
.m-lnum{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;font-size:13px;
  background:var(--surface-2);color:var(--ink-2);box-shadow:inset 0 0 0 1px var(--line)}
.m-lrow-info{flex:1;min-width:0;display:flex;flex-direction:column}
.m-ldate{font-size:15px;font-weight:600}
.m-lsub{font-size:12.5px;color:var(--ink-2)}
.m-lrow-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.m-lrow-right b{font-size:17px;font-weight:600;white-space:nowrap}
.m-lrow-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.m-lrow-acts .m-btn{flex:1}
.m-lrow-acts .m-grow{flex:2}
.m-receipt-add{flex:0 0 auto!important;color:var(--ink-2)}
.m-hidden{display:none}
.m-receipt{display:flex;align-items:center;min-width:0;flex:1 1 100%;min-height:44px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface);overflow:hidden}
.m-receipt-link{flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--emerald);
  font-size:13.5px;font-weight:600;padding:0 4px 0 12px;min-height:44px;cursor:pointer}
.m-receipt-link span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m-receipt-x{width:40px;min-height:44px;border:none;border-left:1px solid var(--line);background:transparent;color:var(--ink-3);
  display:grid;place-items:center;cursor:pointer;flex-shrink:0}

/* вход и статусы */
.m-logo{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(135deg,#8C6A2E,#B0873C)}
.m-status{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:16px;padding:24px;text-align:center}
.m-status-text{color:var(--ink-2);font-size:15px;max-width:320px;overflow-wrap:anywhere}
.m-login{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;
  padding:calc(env(safe-area-inset-top) + 24px) 16px calc(env(safe-area-inset-bottom) + 24px)}
.m-login-card{width:100%;max-width:400px;background:var(--surface);border:1px solid var(--line);border-radius:22px;
  padding:28px 20px 22px;box-shadow:var(--shadow)}
.m-login-card .m-logo{margin-bottom:16px}
.m-login-title{font-size:24px;font-weight:700}
.m-login-sub{color:var(--ink-2);font-size:14.5px;margin:2px 0 22px}
.m-login-card .m-btn{margin-top:6px}
`;
