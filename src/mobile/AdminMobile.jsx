/* ------------------------------------------------------------------ */
/*  Мобильная версия приложения администратора: оболочка и разделы.    */
/*  Данные и обработчики приходят из App (rassrochki.jsx) в объекте    */
/*  app — здесь только разметка под телефон.                            */
/* ------------------------------------------------------------------ */

import React, { useState } from "react";
import {
  LayoutGrid, ScrollText, Plus, Wallet, Menu, X, Landmark, Users, History, FileText, Upload, Download,
  UserCog, HardDriveDownload, LogOut, Moon, Sun, Smartphone, ChevronRight, AlertTriangle,
} from "lucide-react";
import Dashboard from "./Dashboard";
import Capital from "./Capital";
import CashDesk from "../CashDesk";
import Directories from "../Directories.jsx";
import Contracts, { ContractsToolbar, ContractsActions, FiltersSheet } from "./Contracts";
import { ScreenHeader, TabBar, SecHd, useBackClose, useThemePref, useTheme, setThemePref, useThemeColorMeta } from "./kit";

const TABS = (debtors) => [
  { key: "dashboard", label: "Сводка", icon: <LayoutGrid size={22} /> },
  { key: "contracts", label: "Договоры", icon: <ScrollText size={22} />, badge: debtors || null },
  { main: true, icon: <Plus size={26} /> },
  { key: "cash", label: "Касса", icon: <Wallet size={22} /> },
  { key: "more", label: "Ещё", icon: <Menu size={22} /> },
];

// подэкран вкладки «Ещё» (Капитал, Справочники): системная «Назад» возвращает к списку
function SubScreen({ onBack, children }) {
  useBackClose(onBack);
  return children;
}

// корневой блок (.m-app) рисует App — здесь только содержимое
export default function AdminMobile({ app }) {
  useThemeColorMeta(useTheme());
  const { tab, setTab, setAdding, totals, contracts } = app;
  const [moreOpen, setMoreOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);   // режим выбора договоров для напоминаний
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inMore = moreOpen || tab === "capital" || tab === "directories";
  const active = inMore ? "more" : tab;

  const select = (key) => {
    if (key === "more") {
      setMoreOpen(true);
      if (tab === "capital" || tab === "directories") setTab("dashboard");
    } else {
      setMoreOpen(false);
      setTab(key);
    }
    window.scrollTo(0, 0);
  };
  const backToMore = () => { setMoreOpen(true); setTab("dashboard"); window.scrollTo(0, 0); };

  let screen;
  if (tab === "capital") {
    screen = { title: "Капитал", sub: "вкладчики, прибыль и выводы", onBack: backToMore, body: <Capital app={app} /> };
  } else if (tab === "directories") {
    screen = {
      title: "Справочники", sub: "клиенты и товары из договоров", onBack: backToMore,
      body: <div className="m-legacy-screen"><Directories contracts={contracts} onSaveClient={app.updateDirectoryClient} /></div>,
    };
  } else if (moreOpen) {
    screen = { title: "Ещё", body: <More app={app} openSub={(key) => { setTab(key); window.scrollTo(0, 0); }} /> };
  } else if (tab === "contracts") {
    screen = {
      title: "Договоры",
      sub: `${contracts.length} всего`,
      actions: contracts.length > 0 && (
        <ContractsActions app={app} selecting={selecting} setSelecting={setSelecting} openFilters={() => setFiltersOpen(true)} />
      ),
      extra: contracts.length > 0 && <ContractsToolbar app={app} />,
      body: <Contracts app={app} selecting={selecting} setSelecting={setSelecting} openFilters={() => setFiltersOpen(true)} />,
    };
  } else if (tab === "cash") {
    screen = {
      title: "Касса", sub: "поступления от клиентов",
      body: <div className="m-legacy-screen"><CashDesk contracts={contracts} cards={app.cards} onAddCard={app.addCashCard} onOpen={app.setOpenId} /></div>,
    };
  } else {
    screen = {
      title: "Сводка",
      sub: new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date()),
      body: <Dashboard app={app} />,
    };
  }

  const content = (
    <>
      <ScreenHeader title={screen.title} sub={screen.sub} onBack={screen.onBack} actions={screen.actions}>
        {app.syncStatus}
        {screen.extra}
      </ScreenHeader>
      <Notices app={app} />
      <main className="m-main">{screen.body}</main>
    </>
  );

  return (
    <>
      {screen.onBack ? <SubScreen key={tab} onBack={screen.onBack}>{content}</SubScreen> : content}
      <TabBar
        tabs={TABS(totals.debtors)}
        active={active}
        onSelect={select}
        onMain={() => setAdding(true)}
        mainLabel="Новый договор"
      />
      {filtersOpen && <FiltersSheet app={app} onClose={() => setFiltersOpen(false)} />}
    </>
  );
}


/* --------------------------- Предупреждения ------------------------- */

function Notices({ app }) {
  const { storageError, setStorageError, reload, operatorLogsError, appMessage, setAppMessage } = app;
  return (
    <>
      {operatorLogsError && <div className="m-alert m-alert-wide" role="alert">{operatorLogsError}</div>}
      {storageError && (
        <div className="m-alert m-alert-wide" role="alert">
          <b><AlertTriangle size={14} /> Последнее изменение не сохранено в базе данных.</b> Загрузите актуальные данные и повторите действие.
          <span className="m-alert-detail">Ошибка: {storageError}</span>
          <div className="m-alert-actions">
            <button type="button" className="m-btn primary sm" onClick={reload}>Обновить данные</button>
            <button type="button" className="m-btn ghost sm" onClick={() => setStorageError("")}>Скрыть</button>
          </div>
        </div>
      )}
      {appMessage && (
        <button type="button" className={`m-toast ${appMessage.tone || "error"}`} onClick={() => setAppMessage(null)}>
          <span>{appMessage.message}</span><X size={16} />
        </button>
      )}
    </>
  );
}

/* --------------------------- Ещё ------------------------------------ */

function More({ app, openSub }) {
  const pref = useThemePref();
  const { session, cloudDrafts, isDesktopApp, setDraftsOpen, setImporting, exportAll, setDataCenterOpen,
    onOpenTeam, onOpenImport, logout, requestConfirm, contracts, investors, appVersion, buildDate } = app;
  const Row = ({ icon, label, note, onClick, disabled, danger }) => (
    <button type="button" className={`m-option ${danger ? "danger" : ""}`} onClick={onClick} disabled={disabled}>
      <span>{icon} {label}</span>
      {note != null && <small>{note}</small>}
      {!danger && <ChevronRight size={18} className="m-opt-chev" />}
    </button>
  );
  return (
    <>
      <div className="m-card m-account">
        <div className="m-logo"><Wallet size={22} /></div>
        <div className="m-account-info">
          <div className="m-name">Рассрочки · администратор</div>
          <div className="m-meta">{session?.user?.email || "учёт договоров и платежей"}</div>
        </div>
      </div>

      <SecHd title="Разделы" />
      <div className="m-options">
        <Row icon={<Landmark size={20} />} label="Капитал" note={`${investors.length} вкладч.`} onClick={() => openSub("capital")} />
        {!isDesktopApp && <Row icon={<Users size={20} />} label="Справочники" onClick={() => openSub("directories")} />}
        <Row icon={<History size={20} />} label={isDesktopApp ? "Данные" : "История изменений"} onClick={() => setDataCenterOpen(true)} />
        {!isDesktopApp && (
          <Row icon={<FileText size={20} />} label="Черновики" note={cloudDrafts.length || "нет"}
            disabled={!cloudDrafts.length} onClick={() => setDraftsOpen(true)} />
        )}
      </div>

      <SecHd title="Данные" sub={`Договоров: ${contracts.length} · вкладчиков: ${investors.length}`} />
      <div className="m-options">
        <Row icon={<Upload size={20} />} label="Импорт из Excel" onClick={() => setImporting(true)} />
        <Row icon={<Download size={20} />} label="Экспорт в Excel" onClick={exportAll} />
      </div>

      {(onOpenTeam || onOpenImport) && (
        <>
          <SecHd title="Администрирование" />
          <div className="m-options">
            {onOpenTeam && <Row icon={<UserCog size={20} />} label="Операторы и назначения" onClick={onOpenTeam} />}
            {onOpenImport && <Row icon={<HardDriveDownload size={20} />} label="Перенести копию с Mac" onClick={onOpenImport} />}
          </div>
        </>
      )}

      <SecHd title="Тема оформления" />
      <div className="m-seg" role="group" aria-label="Тема оформления">
        {[["dark", "Тёмная", Moon], ["light", "Светлая", Sun], ["auto", "Авто", Smartphone]].map(([key, label, Icon]) => (
          <button key={key} type="button" className={pref === key ? "on" : ""} onClick={() => setThemePref(key)} aria-pressed={pref === key}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <div className="m-hint">«Авто» — как в настройках телефона. Выбор запоминается на этом устройстве.</div>

      <SecHd title="Аккаунт" />
      <div className="m-options">
        <Row danger icon={<LogOut size={20} />} label="Выйти" onClick={async () => {
          if (await requestConfirm({ title: "Выйти из аккаунта?", message: "Чтобы вернуться, понадобятся почта и пароль.", confirmLabel: "Выйти", danger: true })) logout();
        }} />
      </div>
      <div className="m-version">Версия {appVersion} · сборка {buildDate}</div>
    </>
  );
}
