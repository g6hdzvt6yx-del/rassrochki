/* ------------------------------------------------------------------ */
/*  Мобильная версия (экран ≤ 768 px): общие детали                    */
/*                                                                     */
/*  Здесь только внешний вид и навигация. Расчёты, загрузка и          */
/*  сохранение остаются в прежних компонентах — сюда приходят готовые  */
/*  данные и обработчики. Компьютерная версия этот код не использует,  */
/*  а все стили mobile.css действуют только внутри .m-app.             */
/* ------------------------------------------------------------------ */

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, Wallet } from "lucide-react";
import "./mobile.css";

// узкий экран или телефон, повёрнутый горизонтально (сенсорный и невысокий), —
// иначе при повороте телефона приложение переключалось бы на компьютерный вид
export const MOBILE_QUERY = "(max-width: 768px), (pointer: coarse) and (max-height: 500px)";

/* ------------------------- Определение телефона -------------------- */

// приложение для Mac (Tauri) — всегда компьютерная версия, даже в узком окне
const isMacApp = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

export function useIsMobile() {
  const get = () => typeof window !== "undefined" && !isMacApp && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(!isMacApp && mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/* ------------------------- Тема: тёмная / светлая / авто ------------ */
/*  По умолчанию тёмная — как у всего приложения. Выбор хранится только  */
/*  на этом телефоне.                                                    */

const THEME_KEY = "rassrochki-mobile-theme";
const themeSubs = new Set();
const readThemePref = () => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "auto" ? v : "dark";
  } catch { return "dark"; }
};
let themePref = typeof window !== "undefined" ? readThemePref() : "dark";

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

export const useThemePref = () => useSyncExternalStore(subscribeTheme, () => themePref, () => "dark");

// итоговая тема с учётом настроек телефона: "light" | "dark"
export const useTheme = () => useSyncExternalStore(
  subscribeTheme,
  () => (themePref === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : themePref),
  () => "dark",
);

// цвет системной строки браузера под тему (только пока открыта мобильная версия)
export function useThemeColorMeta(theme) {
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]');
    const created = !meta;
    if (created) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme === "dark" ? "#0f172a" : "#f4f5fb";
    return () => { if (created) meta.remove(); };
  }, [theme]);
}

/* ------------------------- Кнопка «Назад» и шторки ------------------ */
/*  Каждая открытая шторка — запись в истории браузера. Системная        */
/*  кнопка «Назад» (Android, жест iOS) закрывает верхнюю шторку, а не    */
/*  уводит со страницы. Синхронизация отложенная, поэтому замена одной   */
/*  шторки другой за один кадр не трогает историю.                       */

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
      if (top && top.close() === false) sheetStack.push(top);
      scheduleSync();
    }
  });
};

// регистрирует открытый слой (шторку, экран) в истории браузера
export function useBackClose(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    ensurePopListener();
    const entry = { close: () => (ref.current ? ref.current() : undefined) };
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
export function Sheet({ title, subtitle, onClose, children, footer, full, left, right, className = "", bodyRef }) {
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
          <div className="m-sh-body" ref={bodyRef}>{children}</div>
          {footer && <div className="m-sh-ft">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// кнопка «Назад» для шапки экрана или шторки на весь экран
export const BackBtn = ({ onClick, label = "Назад" }) => (
  <button type="button" className="m-ib m-back" onClick={onClick} aria-label={label}><ChevronLeft size={24} /></button>
);

// окно подтверждения — шторка с кнопками внизу
export function ConfirmSheet({ title, message, confirmLabel, danger = true, onCancel, onConfirm }) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={
        <div className="m-ft-row m-ft-even">
          <button type="button" className="m-btn ghost" onClick={onCancel}>Отмена</button>
          <button type="button" className={`m-btn ${danger === false ? "primary" : "danger-solid"}`} onClick={onConfirm}>
            {confirmLabel || "Подтвердить"}
          </button>
        </div>
      }
    >
      {message && <p className="m-confirm-text">{message}</p>}
    </Sheet>
  );
}

/* ------------------------- Окна в прежнем оформлении ---------------- */
// Окна, которые ещё не переведены на мобильный вид, показываются поверх
// мобильной версии в прежнем (компьютерном) оформлении.
export function LegacyLayer({ css, children }) {
  return createPortal(<div className="app m-legacy"><style>{css}</style>{children}</div>, document.body);
}

/* ------------------------- Корневая обёртка ------------------------ */

export function MobileRoot({ children, className = "" }) {
  const theme = useTheme();
  useThemeColorMeta(theme);
  return <div className={`m-app m-root ${className}`} data-theme={theme}>{children}</div>;
}

// отдельный экран с «Назад» (системная «Назад» тоже возвращает); onBack может вернуть false — остаться
export function MobileScreen({ title, sub, onBack, actions, children }) {
  useBackClose(onBack);
  return (
    <MobileRoot>
      <ScreenHeader title={title} sub={sub} onBack={() => onBack()} actions={actions} />
      <main className="m-main no-tabbar">{children}</main>
    </MobileRoot>
  );
}

// шапка экрана: «Назад», заголовок, 1–2 действия справа, дополнительная строка снизу
export function ScreenHeader({ title, sub, onBack, actions, children }) {
  return (
    <header className="m-top">
      <div className="m-top-row">
        {onBack && <BackBtn onClick={onBack} />}
        <div className="m-top-titles">
          <h1 className={`m-title ${onBack ? "small" : ""}`}>{title}</h1>
          {sub && <div className="m-top-sub">{sub}</div>}
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}

// нижняя панель разделов с центральной кнопкой основного действия
export function TabBar({ tabs, active, onSelect, onMain, mainLabel }) {
  return (
    <nav className="m-tabbar" aria-label="Разделы">
      {tabs.map((t) => (t.main ? (
        <div key="main" className="m-tab-fab-wrap">
          <button type="button" className="m-fab" onClick={onMain} aria-label={mainLabel}>{t.icon}</button>
        </div>
      ) : (
        <button
          key={t.key}
          type="button"
          className={`m-tab ${active === t.key ? "on" : ""}`}
          onClick={() => onSelect(t.key)}
          aria-current={active === t.key ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
          {t.badge ? <i className="m-tab-badge">{t.badge}</i> : null}
        </button>
      )))}
    </nav>
  );
}

// экраны «Загрузка…», «Ошибка», «Доступ не предоставлен»
export function MobileStatus({ title, text, children }) {
  return (
    <MobileRoot>
      <div className="m-status">
        <div className="m-logo"><Wallet size={22} /></div>
        {title && <div className="m-status-title">{title}</div>}
        {text && <div className="m-status-text">{text}</div>}
        {children && <div className="m-status-actions">{children}</div>}
      </div>
    </MobileRoot>
  );
}

/* --------------------------- Вход --------------------------------- */

// form — обработчик отправки формы (поля называются email и password)
export function MobileLogin({ onSubmit, busy, error, subtitle = "Вход в рабочий кабинет", email, setEmail, password, setPassword }) {
  const controlled = setEmail !== undefined;
  return (
    <MobileRoot>
      <div className="m-login">
        <form className="m-login-card" onSubmit={onSubmit}>
          <div className="m-logo"><Wallet size={22} /></div>
          <div className="m-login-title">Рассрочки</div>
          <div className="m-login-sub">{subtitle}</div>
          <label className="m-field">
            <span>Почта</span>
            <input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" required
              placeholder="you@example.com"
              {...(controlled ? { value: email, onChange: (e) => setEmail(e.target.value) } : {})} />
          </label>
          <label className="m-field">
            <span>Пароль</span>
            <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••"
              {...(controlled ? { value: password, onChange: (e) => setPassword(e.target.value) } : {})} />
          </label>
          {error && <div className="m-alert" role="alert">{error}</div>}
          <button className="m-btn primary block" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
        </form>
      </div>
    </MobileRoot>
  );
}

/* ------------------------- Мелочи ---------------------------------- */

// только цифры (и одна точка для дробных) — для полей сумм с цифровой клавиатурой
export const cleanNum = (v, decimal) => {
  let s = String(v ?? "").replace(",", ".");
  if (!decimal) return s.replace(/\D/g, "");
  s = s.replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
};

// обёртка обработчика: чистим ввод до цифр и передаём дальше как событие
export const numEvt = (handler, decimal) => (e) => handler({ target: { value: cleanNum(e.target.value, decimal) } });

export const NumInput = ({ value, onChange, decimal, placeholder = "0", ...rest }) => (
  <input type="text" inputMode={decimal ? "decimal" : "numeric"} pattern={decimal ? undefined : "[0-9]*"}
    value={value ?? ""} onChange={numEvt(onChange, decimal)} placeholder={placeholder} {...rest} />
);

export const SecHd = ({ title, sub, action, count }) => (
  <div className="m-sec-hd">
    <div className="m-sec-titles">
      <h2>{title}{count != null && <span className="m-count">{count}</span>}</h2>
      {sub && <div className="m-sec-sub">{sub}</div>}
    </div>
    {action}
  </div>
);
