import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutGrid, ScrollText, Plus, Phone, Wallet, Users, AlertTriangle,
  CheckCircle2, Clock, ChevronLeft, X, Check, Undo2, CalendarDays,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Утилиты                                                            */
/* ------------------------------------------------------------------ */

const money = (n) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " \u20BD";

const fmtDate = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));

const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

const addMonths = (isoDate, n) => {
  const d = new Date(isoDate);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  d.setHours(0, 0, 0, 0);
  return d;
};

// разбиваем сумму на равные части, остаток кладём в последний платёж
const splitAmount = (total, parts) => {
  total = Math.round(total);
  const base = Math.round(total / parts);
  const arr = Array(parts).fill(base);
  arr[parts - 1] = total - base * (parts - 1);
  return arr;
};

const buildSchedule = (c) => {
  const financed = Math.max(0, (+c.totalPrice || 0) - (+c.downPayment || 0) + (+c.markup || 0));
  const amounts = splitAmount(financed, Math.max(1, +c.termMonths || 1));
  const today = startOfToday();
  return amounts.map((amt, i) => {
    const due = addMonths(c.startDate, i);
    const paid = !!(c.payments && c.payments[i]);
    let status = "upcoming";
    if (paid) status = "paid";
    else if (due < today) status = "overdue";
    else if ((due - today) / 86400000 <= 7) status = "due";
    return { n: i + 1, index: i, dueDate: due, amountDue: amt, paid, paidDate: paid ? c.payments[i].paidDate : null, status };
  });
};

const contractStats = (c) => {
  const rows = buildSchedule(c);
  const financed = rows.reduce((s, r) => s + r.amountDue, 0);
  const paidSum = rows.filter((r) => r.paid).reduce((s, r) => s + r.amountDue, 0);
  const overdueSum = rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.amountDue, 0);
  const next = rows.find((r) => !r.paid) || null;
  const done = rows.every((r) => r.paid);
  return { rows, financed, paidSum, remaining: financed - paidSum, overdueSum, next, done };
};

/* ------------------------------------------------------------------ */
/*  Демо-данные (относительно сегодняшней даты)                        */
/* ------------------------------------------------------------------ */

const seed = () => {
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const back = (m) => iso(addMonths(startOfToday().toISOString().slice(0, 10), -m));
  return [
    {
      id: "c1", clientName: "\u0410\u0445\u043c\u0435\u0434\u043e\u0432 \u0420\u0443\u0441\u043b\u0430\u043d", phone: "+7 928 000-11-22",
      item: "iPhone 15, 128\u0413\u0411", totalPrice: 95000, downPayment: 15000, markup: 12000,
      termMonths: 6, startDate: back(3), payments: { 0: { paidDate: back(3) }, 1: { paidDate: back(2) } },
    },
    {
      id: "c2", clientName: "\u0421\u0430\u0439\u0434\u0443\u043b\u043b\u0430\u0435\u0432\u0430 \u0417\u0430\u0440\u0435\u043c\u0430", phone: "+7 963 555-77-88",
      item: "\u0421\u0442\u0438\u0440\u0430\u043b\u044c\u043d\u0430\u044f \u043c\u0430\u0448\u0438\u043d\u0430 Bosch", totalPrice: 62000, downPayment: 12000, markup: 8000,
      termMonths: 5, startDate: back(4), payments: { 0: { paidDate: back(4) } },
    },
    {
      id: "c3", clientName: "\u041c\u0430\u0433\u043e\u043c\u0435\u0434\u043e\u0432 \u0418\u0431\u0440\u0430\u0433\u0438\u043c", phone: "+7 989 123-45-67",
      item: "\u041d\u043e\u0443\u0442\u0431\u0443\u043a Lenovo", totalPrice: 78000, downPayment: 18000, markup: 9000,
      termMonths: 6, startDate: iso(addMonths(startOfToday().toISOString().slice(0, 10), 0)),
      payments: {},
    },
  ];
};

const STORAGE_KEY = "rassrochki:contracts:v1";

/* ------------------------------------------------------------------ */
/*  Мелкие компоненты                                                  */
/* ------------------------------------------------------------------ */

const STATUS = {
  paid: { label: "\u041e\u043f\u043b\u0430\u0447\u0435\u043d", cls: "b-emerald" },
  overdue: { label: "\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d", cls: "b-clay" },
  due: { label: "\u0421\u043a\u043e\u0440\u043e", cls: "b-amber" },
  upcoming: { label: "\u041e\u0436\u0438\u0434\u0430\u0435\u0442", cls: "b-line" },
  active: { label: "\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0439", cls: "b-line" },
  done: { label: "\u0417\u0430\u043a\u0440\u044b\u0442", cls: "b-emerald" },
};

const Badge = ({ s }) => {
  const st = STATUS[s] || STATUS.upcoming;
  return <span className={`badge ${st.cls}`}>{st.label}</span>;
};

// «Лента долга» — фирменный элемент: полоса, поделённая на оплачено / просрочено / остаток
const Ribbon = ({ paid, overdue, remaining }) => {
  const total = Math.max(1, paid + remaining);
  const p = (paid / total) * 100;
  const o = (overdue / total) * 100;
  const r = 100 - p - o;
  return (
    <div className="ribbon" title="\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e / \u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e / \u041e\u0441\u0442\u0430\u0442\u043e\u043a">
      <span style={{ width: `${p}%` }} className="seg s-paid" />
      <span style={{ width: `${o}%` }} className="seg s-over" />
      <span style={{ width: `${r}%` }} className="seg s-rem" />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Приложение                                                         */
/* ------------------------------------------------------------------ */

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  // загрузка
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        setContracts(res && res.value ? JSON.parse(res.value) : seed());
      } catch {
        setContracts(seed());
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // сохранение
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify(contracts)); } catch { /* демо-режим без сохранения */ }
    })();
  }, [contracts, loaded]);

  const totals = useMemo(() => {
    let financed = 0, paid = 0, overdue = 0, remaining = 0, debtors = 0, active = 0;
    const upcoming = [];
    contracts.forEach((c) => {
      const st = contractStats(c);
      financed += st.financed; paid += st.paidSum; overdue += st.overdueSum; remaining += st.remaining;
      if (st.overdueSum > 0) debtors += 1;
      if (!st.done) active += 1;
      st.rows.filter((r) => !r.paid).forEach((r) => upcoming.push({ ...r, client: c.clientName, cid: c.id }));
    });
    upcoming.sort((a, b) => a.dueDate - b.dueDate);
    return { financed, paid, overdue, remaining, debtors, active, upcoming: upcoming.slice(0, 8) };
  }, [contracts]);

  const togglePay = (cid, idx) =>
    setContracts((prev) =>
      prev.map((c) => {
        if (c.id !== cid) return c;
        const payments = { ...(c.payments || {}) };
        if (payments[idx]) delete payments[idx];
        else payments[idx] = { paidDate: new Date().toISOString().slice(0, 10) };
        return { ...c, payments };
      })
    );

  const addContract = (data) => {
    setContracts((prev) => [{ ...data, id: "c" + Date.now(), payments: {} }, ...prev]);
    setAdding(false);
  };

  const open = contracts.find((c) => c.id === openId) || null;

  if (!loaded)
    return (
      <div className="app"><style>{css}</style>
        <div className="loading">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0432\u0435\u0434\u043e\u043c\u043e\u0441\u0442\u0438\u2026</div>
      </div>
    );

  return (
    <div className="app">
      <style>{css}</style>

      <header className="hd">
        <div className="brand">
          <span className="mark"><Wallet size={18} /></span>
          <div>
            <div className="bname">\u0420\u0430\u0441\u0441\u0440\u043e\u0447\u043a\u0438</div>
            <div className="btag">\u0443\u0447\u0451\u0442 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u0432 \u0438 \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439</div>
          </div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> \u041d\u043e\u0432\u044b\u0439 \u0434\u043e\u0433\u043e\u0432\u043e\u0440
        </button>
      </header>

      <nav className="tabs">
        <button className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>
          <LayoutGrid size={16} /> \u0421\u0432\u043e\u0434\u043a\u0430
        </button>
        <button className={tab === "contracts" ? "on" : ""} onClick={() => setTab("contracts")}>
          <ScrollText size={16} /> \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u044b <span className="cnt">{contracts.length}</span>
        </button>
      </nav>

      {tab === "dashboard" && (
        <main className="wrap">
          <section className="hero">
            <div className="hero-label">\u041e\u0441\u0442\u0430\u0442\u043e\u043a \u043a \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044e</div>
            <div className="hero-num num">{money(totals.remaining)}</div>
            <Ribbon paid={totals.paid} overdue={totals.overdue} remaining={totals.remaining - totals.overdue} />
            <div className="hero-legend">
              <span><i className="dot s-paid" /> \u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e {money(totals.paid)}</span>
              <span><i className="dot s-over" /> \u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e {money(totals.overdue)}</span>
              <span><i className="dot s-rem" /> \u041e\u0441\u0442\u0430\u0442\u043e\u043a {money(totals.remaining - totals.overdue)}</span>
            </div>
          </section>

          <section className="cards">
            <Stat icon={<Wallet size={16} />} label="\u0412\u044b\u0434\u0430\u043d\u043e \u0432 \u0440\u0430\u0441\u0441\u0440\u043e\u0447\u043a\u0443" value={money(totals.financed)} />
            <Stat icon={<Users size={16} />} label="\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u043e\u0432" value={totals.active} />
            <Stat icon={<AlertTriangle size={16} />} label="\u0414\u043e\u043b\u0436\u043d\u0438\u043a\u043e\u0432 (\u043f\u0440\u043e\u0441\u0440\u043e\u0447\u043a\u0430)" value={totals.debtors} tone={totals.debtors ? "clay" : ""} />
          </section>

          <section className="panel">
            <div className="panel-hd"><CalendarDays size={15} /> \u0411\u043b\u0438\u0436\u0430\u0439\u0448\u0438\u0435 \u043f\u043b\u0430\u0442\u0435\u0436\u0438</div>
            {totals.upcoming.length === 0 ? (
              <div className="empty">\u0412\u0441\u0451 \u043e\u043f\u043b\u0430\u0447\u0435\u043d\u043e \u2014 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0445 \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439 \u043d\u0435\u0442.</div>
            ) : (
              <div className="rows">
                {totals.upcoming.map((r) => (
                  <button key={r.cid + "-" + r.index} className="prow" onClick={() => { setOpenId(r.cid); }}>
                    <span className="prow-name">{r.client}</span>
                    <span className="prow-date">{fmtDate(r.dueDate)}</span>
                    <span className="prow-sum num">{money(r.amountDue)}</span>
                    <Badge s={r.status} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {tab === "contracts" && (
        <main className="wrap">
          <div className="clist">
            {contracts.map((c) => {
              const st = contractStats(c);
              return (
                <button key={c.id} className="citem" onClick={() => setOpenId(c.id)}>
                  <div className="citem-top">
                    <span className="citem-name">{c.clientName}</span>
                    <Badge s={st.done ? "done" : st.overdueSum ? "overdue" : "active"} />
                  </div>
                  <div className="citem-item">{c.item}</div>
                  <div className="citem-foot">
                    <span className="muted">\u041e\u0441\u0442\u0430\u0442\u043e\u043a</span>
                    <span className="num strong">{money(st.remaining)}</span>
                    {st.next && <span className="muted">\u2192 {fmtDate(st.next.dueDate)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      )}

      {open && <Detail contract={open} onClose={() => setOpenId(null)} onToggle={togglePay} />}
      {adding && <AddForm onClose={() => setAdding(false)} onSave={addContract} />}
    </div>
  );
}

const Stat = ({ icon, label, value, tone }) => (
  <div className="stat">
    <div className="stat-ic">{icon}</div>
    <div className="stat-label">{label}</div>
    <div className={`stat-val num ${tone || ""}`}>{value}</div>
  </div>
);

/* --------------------------- Детали договора ----------------------- */

function Detail({ contract, onClose, onToggle }) {
  const st = contractStats(contract);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <button className="icon-btn" onClick={onClose}><ChevronLeft size={18} /></button>
          <div>
            <div className="sheet-name">{contract.clientName}</div>
            <a className="sheet-phone" href={`tel:${contract.phone}`}><Phone size={12} /> {contract.phone}</a>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="sheet-body">
          <div className="det-item">{contract.item}</div>
          <div className="det-grid">
            <div><span>\u0426\u0435\u043d\u0430</span><b className="num">{money(contract.totalPrice)}</b></div>
            <div><span>\u0412\u0437\u043d\u043e\u0441</span><b className="num">{money(contract.downPayment)}</b></div>
            <div><span>\u041d\u0430\u0446\u0435\u043d\u043a\u0430</span><b className="num">{money(contract.markup)}</b></div>
            <div><span>\u0421\u0440\u043e\u043a</span><b className="num">{contract.termMonths} \u043c\u0435\u0441</b></div>
            <div><span>\u041a \u043e\u043f\u043b\u0430\u0442\u0435</span><b className="num">{money(st.financed)}</b></div>
            <div><span>\u041e\u0441\u0442\u0430\u0442\u043e\u043a</span><b className="num strong">{money(st.remaining)}</b></div>
          </div>

          <div className="ledger-hd">\u0413\u0440\u0430\u0444\u0438\u043a \u043f\u043b\u0430\u0442\u0435\u0436\u0435\u0439</div>
          <div className="ledger">
            {st.rows.map((r) => (
              <div key={r.index} className={`lrow ${r.status}`}>
                <span className="lnum num">{r.n}</span>
                <span className="ldate">{fmtDate(r.dueDate)}</span>
                <span className="lsum num">{money(r.amountDue)}</span>
                <span className="lstatus"><Badge s={r.status} /></span>
                {r.paid ? (
                  <button className="lbtn undo" onClick={() => onToggle(contract.id, r.index)}>
                    <Undo2 size={13} /> \u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c
                  </button>
                ) : (
                  <button className="lbtn pay" onClick={() => onToggle(contract.id, r.index)}>
                    <Check size={13} /> \u041e\u043f\u043b\u0430\u0442\u0438\u0442\u044c
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Новый договор ------------------------- */

function AddForm({ onClose, onSave }) {
  const [f, setF] = useState({
    clientName: "", phone: "", item: "",
    totalPrice: "", downPayment: "", markup: "", termMonths: "6",
    startDate: new Date().toISOString().slice(0, 10),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const financed = Math.max(0, (+f.totalPrice || 0) - (+f.downPayment || 0) + (+f.markup || 0));
  const monthly = financed / Math.max(1, +f.termMonths || 1);
  const valid = f.clientName.trim() && +f.totalPrice > 0 && +f.termMonths > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hd">
          <div className="sheet-name">\u041d\u043e\u0432\u044b\u0439 \u0434\u043e\u0433\u043e\u0432\u043e\u0440 \u0440\u0430\u0441\u0441\u0440\u043e\u0447\u043a\u0438</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sheet-body">
          <Field label="\u0424\u0418\u041e \u043a\u043b\u0438\u0435\u043d\u0442\u0430"><input value={f.clientName} onChange={set("clientName")} placeholder="\u0418\u0432\u0430\u043d\u043e\u0432 \u0418\u0432\u0430\u043d" /></Field>
          <div className="frow">
            <Field label="\u0422\u0435\u043b\u0435\u0444\u043e\u043d"><input value={f.phone} onChange={set("phone")} placeholder="+7 \u2026" /></Field>
            <Field label="\u0414\u0430\u0442\u0430 1-\u0433\u043e \u043f\u043b\u0430\u0442\u0435\u0436\u0430"><input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
          </div>
          <Field label="\u0422\u043e\u0432\u0430\u0440"><input value={f.item} onChange={set("item")} placeholder="\u0422\u0435\u043b\u0435\u0444\u043e\u043d, \u0442\u0435\u0445\u043d\u0438\u043a\u0430\u2026" /></Field>
          <div className="frow">
            <Field label="\u0426\u0435\u043d\u0430 \u0442\u043e\u0432\u0430\u0440\u0430"><input type="number" value={f.totalPrice} onChange={set("totalPrice")} placeholder="0" /></Field>
            <Field label="\u041f\u0435\u0440\u0432\u043e\u043d\u0430\u0447. \u0432\u0437\u043d\u043e\u0441"><input type="number" value={f.downPayment} onChange={set("downPayment")} placeholder="0" /></Field>
          </div>
          <div className="frow">
            <Field label="\u041d\u0430\u0446\u0435\u043d\u043a\u0430 (\u043f\u0435\u0440\u0435\u043f\u043b\u0430\u0442\u0430)"><input type="number" value={f.markup} onChange={set("markup")} placeholder="0" /></Field>
            <Field label="\u0421\u0440\u043e\u043a, \u043c\u0435\u0441"><input type="number" value={f.termMonths} onChange={set("termMonths")} placeholder="6" /></Field>
          </div>

          <div className="calc">
            <div><span>\u041a \u043e\u043f\u043b\u0430\u0442\u0435 \u0432 \u0440\u0430\u0441\u0441\u0440\u043e\u0447\u043a\u0443</span><b className="num">{money(financed)}</b></div>
            <div><span>\u041f\u043b\u0430\u0442\u0451\u0436 \u0432 \u043c\u0435\u0441\u044f\u0446</span><b className="num strong">{money(monthly)}</b></div>
          </div>

          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>\u041e\u0442\u043c\u0435\u043d\u0430</button>
            <button className="btn primary" disabled={!valid} onClick={() => onSave({
              ...f, totalPrice: +f.totalPrice, downPayment: +f.downPayment || 0,
              markup: +f.markup || 0, termMonths: +f.termMonths,
            })}>\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0434\u043e\u0433\u043e\u0432\u043e\u0440</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

/* ------------------------------------------------------------------ */
/*  Стили                                                              */
/* ------------------------------------------------------------------ */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.app{
  --paper:#EEF1EB; --surface:#FBFCF9; --ink:#16332E; --ink-soft:#4E5C57;
  --line:#DCE1D7; --brass:#8C6A2E; --emerald:#1E7A54; --clay:#B4463A; --amber:#B4801F;
  font-family:'Golos Text',system-ui,-apple-system,sans-serif;
  color:var(--ink); background:var(--paper); min-height:100%;
  -webkit-font-smoothing:antialiased;
}
.app *{box-sizing:border-box}
.num{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.strong{font-weight:600}
.muted{color:var(--ink-soft);font-size:12px}
.loading{padding:60px;text-align:center;color:var(--ink-soft)}

.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 20px;background:var(--ink);color:#EFF3EC}
.brand{display:flex;align-items:center;gap:11px}
.mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--brass),#B0873C);color:#fff}
.bname{font-weight:700;font-size:16px;letter-spacing:.02em}
.btag{font-size:11px;color:#9FB0A6;letter-spacing:.03em}

.tabs{display:flex;gap:4px;padding:10px 20px 0;background:var(--ink)}
.tabs button{display:flex;align-items:center;gap:7px;border:none;cursor:pointer;
  background:transparent;color:#9FB0A6;font:inherit;font-size:13px;font-weight:600;
  padding:9px 14px;border-radius:9px 9px 0 0}
.tabs button.on{background:var(--paper);color:var(--ink)}
.tabs .cnt{background:var(--line);color:var(--ink-soft);font-size:11px;padding:1px 7px;border-radius:20px}
.tabs button.on .cnt{background:var(--brass);color:#fff}

.wrap{max-width:820px;margin:0 auto;padding:22px 18px 60px}

.hero{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin-bottom:16px}
.hero-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);font-weight:600}
.hero-num{font-size:40px;font-weight:600;margin:4px 0 16px}
.ribbon{display:flex;height:10px;border-radius:20px;overflow:hidden;background:var(--line)}
.seg{display:block;height:100%}
.s-paid{background:var(--emerald)} .s-over{background:var(--clay)} .s-rem{background:#C7CEBF}
.hero-legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:12.5px;color:var(--ink-soft)}
.dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}

.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:14px 16px}
.stat-ic{color:var(--brass);margin-bottom:8px}
.stat-label{font-size:12px;color:var(--ink-soft);margin-bottom:3px}
.stat-val{font-size:22px;font-weight:600}
.stat-val.clay{color:var(--clay)}

.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.panel-hd{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line);
  font-weight:600;font-size:13.5px;color:var(--brass)}
.empty{padding:26px 18px;text-align:center;color:var(--ink-soft);font-size:13px}
.rows{display:flex;flex-direction:column}
.prow{display:grid;grid-template-columns:1fr auto auto auto;align-items:center;gap:14px;
  padding:12px 18px;border:none;border-bottom:1px solid var(--line);background:transparent;
  cursor:pointer;font:inherit;text-align:left;width:100%}
.prow:last-child{border-bottom:none}
.prow:hover{background:#F3F5EF}
.prow-name{font-weight:500;font-size:14px}
.prow-date{font-size:12.5px;color:var(--ink-soft)}
.prow-sum{font-size:14px;font-weight:600}

.badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap}
.b-emerald{background:#E1F0E7;color:var(--emerald)}
.b-clay{background:#F7E3E0;color:var(--clay)}
.b-amber{background:#F6ECD6;color:#8A6111}
.b-line{background:#EBEEE5;color:var(--ink-soft)}

.clist{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.citem{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:15px 16px;
  cursor:pointer;font:inherit;text-align:left;transition:border-color .15s}
.citem:hover{border-color:var(--brass)}
.citem-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.citem-name{font-weight:600;font-size:15px}
.citem-item{font-size:13px;color:var(--ink-soft);margin-bottom:12px}
.citem-foot{display:flex;align-items:center;gap:8px;font-size:13px}
.citem-foot .num{font-size:15px}

.overlay{position:fixed;inset:0;background:rgba(18,32,28,.42);display:flex;justify-content:center;
  align-items:flex-start;padding:24px 14px;z-index:50;overflow-y:auto;backdrop-filter:blur(2px)}
.sheet{background:var(--paper);border-radius:18px;width:100%;max-width:540px;overflow:hidden;
  box-shadow:0 24px 60px rgba(18,32,28,.28);animation:pop .18s ease}
@keyframes pop{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
.sheet-hd{display:flex;align-items:center;gap:12px;padding:16px 18px;background:var(--ink);color:#EFF3EC}
.sheet-hd>div{flex:1}
.sheet-name{font-weight:600;font-size:16px}
.sheet-phone{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#9FB0A6;text-decoration:none}
.icon-btn{background:rgba(255,255,255,.1);border:none;color:#EFF3EC;width:32px;height:32px;
  border-radius:8px;display:grid;place-items:center;cursor:pointer}
.icon-btn:hover{background:rgba(255,255,255,.2)}
.sheet-body{padding:18px}

.det-item{font-size:14px;color:var(--ink-soft);margin-bottom:14px}
.det-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
.det-grid>div{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.det-grid span{display:block;font-size:11px;color:var(--ink-soft);margin-bottom:2px}
.det-grid b{font-size:15px;font-weight:600}

.ledger-hd{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--brass);
  font-weight:600;margin-bottom:8px}
.ledger{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.lrow{display:grid;grid-template-columns:26px 1fr auto auto auto;align-items:center;gap:12px;
  padding:11px 14px;border-bottom:1px solid var(--line)}
.lrow:last-child{border-bottom:none}
.lrow.overdue{background:#FBEEEC}
.lrow.paid{background:#F1F6F1}
.lnum{color:var(--ink-soft);font-size:12px}
.ldate{font-size:13px}
.lsum{font-size:14px;font-weight:600}
.lbtn{display:inline-flex;align-items:center;gap:5px;border:none;cursor:pointer;font:inherit;
  font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px}
.lbtn.pay{background:var(--emerald);color:#fff}
.lbtn.undo{background:transparent;color:var(--ink-soft);border:1px solid var(--line)}
.lbtn.pay:hover{filter:brightness(1.06)}

.field{display:block;margin-bottom:12px}
.field>span{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:5px;font-weight:500}
.field input{width:100%;border:1px solid var(--line);background:var(--surface);border-radius:9px;
  padding:10px 12px;font:inherit;font-size:14px;color:var(--ink)}
.field input:focus{outline:none;border-color:var(--brass);box-shadow:0 0 0 3px rgba(140,106,46,.12)}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:12px}

.calc{display:flex;gap:12px;margin:6px 0 18px}
.calc>div{flex:1;background:var(--ink);color:#EFF3EC;border-radius:11px;padding:12px 14px}
.calc span{display:block;font-size:11px;color:#9FB0A6;margin-bottom:3px}
.calc b{font-size:19px;font-weight:600}

.sheet-actions{display:flex;justify-content:flex-end;gap:10px}
.btn{display:inline-flex;align-items:center;gap:7px;border:none;cursor:pointer;font:inherit;
  font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:10px}
.btn.primary{background:var(--brass);color:#fff}
.btn.primary:hover{filter:brightness(1.06)}
.btn.primary:disabled{opacity:.45;cursor:not-allowed;filter:none}
.btn.ghost{background:transparent;color:var(--ink-soft);border:1px solid var(--line)}

@media(max-width:560px){
  .cards{grid-template-columns:1fr}
  .det-grid{grid-template-columns:repeat(2,1fr)}
  .prow{grid-template-columns:1fr auto;row-gap:4px}
  .prow-date{grid-column:1}
  .hero-num{font-size:32px}
  .lrow{grid-template-columns:22px 1fr auto;row-gap:6px}
  .lstatus{grid-column:2}
  .lbtn{grid-column:3}
}
`;
