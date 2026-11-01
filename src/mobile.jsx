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
  LayoutGrid, ScrollText, Plus, Landmark, Menu, X, ChevronLeft, Wallet,
} from "lucide-react";
// временно, пока не все окна переведены на мобильный вид
import { css as desktopCss, Field } from "./rassrochki.jsx";

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
  const active = more ? "more" : tab;

  const go = (key) => {
    if (key === "add") { setAdding(true); return; }
    if (key === "more") setMore(true);
    else { setMore(false); setTab(key); }
    window.scrollTo(0, 0);
  };

  const screen = { title: "", sub: null, actions: null, body: null };
  if (active === "dashboard") {
    screen.title = "Сводка";
    screen.body = <Placeholder />;
  } else if (active === "contracts") {
    screen.title = "Договоры";
    screen.sub = contracts.length ? `${contracts.length} всего` : null;
    screen.body = <Placeholder />;
  } else if (active === "capital") {
    screen.title = "Капитал";
    screen.body = <Placeholder />;
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
    </MobileRoot>
  );
}

const Placeholder = () => <div className="m-empty">Экран в работе</div>;

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
.m-sh-sub{font-size:13px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.m-sh-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  padding:4px 16px calc(20px + env(safe-area-inset-bottom))}
.m-sh-ft ~ .m-sh-body,.m-sheet:has(.m-sh-ft) .m-sh-body{padding-bottom:16px}
.m-sh-ft{flex-shrink:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--surface);
  border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px}

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
