import React from "react";
import { Plus, Pencil, Trash2, Check, ChevronRight, Landmark, Wallet, TrendingUp, FileText } from "lucide-react";
import { MRibbon, mMoney as money, mPlural as plural } from "./MobileShell";

/*
 * Экран «Капитал» на телефоне (до 760px). Все цифры и действия — из основного приложения
 * (те же расчёты и обработчики, что в широкой версии). Здесь только раскладка: карточки вместо таблиц.
 */

const fmtDate = (d) => {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export default function MobileCapital({
  capital, investors, withdrawals, investorProfits, getAccrual, purposes, report,
  onProfitGroup, onAddInvestor, onEditInvestor, onRemoveInvestor, onPayAccrual, onAddWithdrawal, onRemoveWithdrawal,
}) {
  const free = Math.max(0, capital.free);
  const shortage = capital.free < 0 ? -capital.free : 0;

  return (
    <main className="m-screen m-capital">
      <section className="m-today m-cap-hero" aria-label="Капитал вкладчиков">
        <p className="m-today-label">Капитал вкладчиков</p>
        <div className="m-today-sum">{money(capital.invested)}</div>
        <MRibbon parts={[[capital.deployed, "paid"], [shortage, "over"], [free, "rest"]]} />
        <div className="m-legend m-cap-legend">
          <span><i className="paid" />в обороте {money(capital.deployed)}</span>
          {shortage > 0 && <span className="m-bad"><i className="over" />не хватает {money(shortage)}</span>}
          <span><i className="rest" />свободно {money(free)}</span>
        </div>
        {(capital.withdrawnTotal > 0 || capital.expensesTotal > 0) && <p className="m-today-caption">{[capital.withdrawnTotal > 0 && `Выведено всего: ${money(capital.withdrawnTotal)}`, capital.expensesTotal > 0 && `Расходы всего: ${money(capital.expensesTotal)}`].filter(Boolean).join(" · ")}</p>}
      </section>

      <div className="m-metrics">
        <div className="m-metric ok"><span>Прибыль получена</span><b>{money(capital.profitRealized)}</b></div>
        <div className="m-metric"><span>Прибыль ожидается</span><b>{money(capital.profitExpected)}</b></div>
        <div className="m-metric wide"><span>Прибыль всего по договорам</span><b>{money(capital.profitTotal)}</b></div>
      </div>

      <h2 className="m-section-h"><span><TrendingUp size={17} aria-hidden="true" /> Прибыль по вкладчикам</span></h2>
      {!investorProfits.reconciled && (
        <p className="m-note bad" role="alert">Итоги прибыли не сходятся на {money(Math.abs(investorProfits.difference))}. Данные не исправлялись автоматически.</p>
      )}
      {investorProfits.groups.map((g) => (
        <button type="button" key={g.key} className="m-cap-card m-cap-btn" onClick={() => onProfitGroup(g)}>
          <span className="m-cap-card-hd">
            <b>{g.name}</b>
            <small>{g.contractCount} {plural(g.contractCount, "договор", "договора", "договоров")}</small>
            <ChevronRight size={18} aria-hidden="true" />
          </span>
          <dl className="m-kv">
            <dt>Вложено</dt><dd>{money(g.invested)}</dd>
            <dt>В обороте</dt><dd>{money(g.capitalInTurnover)}</dd>
            <dt>Возвращено</dt><dd>{money(g.capitalReturned)}</dd>
            <dt>Прибыль получена</dt><dd className="m-ok">{money(g.profitReceived)}</dd>
            <dt>Ожидается</dt><dd>{money(g.profitExpected)}</dd>
            <dt>Выплачено</dt><dd>{money(g.paidOut)}</dd>
            <dt className="m-strong">К выплате</dt><dd className="m-strong">{money(g.profitToPay)}</dd>
          </dl>
        </button>
      ))}

      <div className="m-section-row">
        <h2 className="m-section-h"><span><Landmark size={17} aria-hidden="true" /> Вкладчики</span></h2>
        <button type="button" className="m-btn sm primary" onClick={onAddInvestor}><Plus size={17} /> Вкладчик</button>
      </div>
      {investors.length === 0 ? <p className="m-empty-card">Вкладчиков пока нет.</p> : investors.map((inv) => {
        const deployed = capital.perInvestor[inv.id] || 0;
        const withdrawn = capital.withdrawnByInvestor[inv.id] || 0;
        const invFree = (+inv.amount || 0) - deployed - withdrawn;
        const pct = capital.invested ? Math.round(((+inv.amount || 0) / capital.invested) * 100) : 0;
        const profit = capital.profitByInvestor[inv.id] || { realized: 0, expected: 0 };
        const accrual = getAccrual(inv, withdrawals);
        const payNow = Math.min(accrual.monthly, accrual.payable);
        return (
          <article key={inv.id} className="m-cap-card">
            <div className="m-cap-card-hd">
              <b>{inv.name}</b>
              <small>{pct}% капитала</small>
              <button type="button" className="m-act" onClick={() => onEditInvestor(inv)} aria-label={`Изменить вкладчика: ${inv.name}`}><Pencil size={17} /></button>
              <button type="button" className="m-act danger" onClick={() => onRemoveInvestor(inv.id)} aria-label={`Удалить вкладчика: ${inv.name}`}><Trash2 size={17} /></button>
            </div>
            <dl className="m-kv">
              <dt>Вклад</dt><dd>{money(inv.amount)}</dd>
              <dt>В обороте</dt><dd>{money(deployed)}</dd>
              <dt>Выведено</dt><dd>{money(withdrawn)}</dd>
              <dt className="m-strong">Свободно</dt><dd className={`m-strong ${invFree < 0 ? "m-bad" : ""}`}>{money(invFree)}</dd>
              <dt>Прибыль получена</dt><dd className="m-ok">{money(profit.realized)}</dd>
              <dt>Прибыль ожидается</dt><dd>{money(profit.expected)}</dd>
            </dl>
            {accrual.monthly > 0 && (
              <div className="m-accrual">
                <p className="m-accrual-hd"><b>Ежемесячные начисления</b><small>{money(accrual.monthly)} в месяц · с {fmtDate(inv.accrualStartDate)}</small></p>
                <dl className="m-kv">
                  <dt>Начислено</dt><dd>{money(accrual.accrued)}</dd>
                  <dt>Выплачено</dt><dd>{money(accrual.paid)}</dd>
                  <dt className="m-strong">К выплате</dt><dd className="m-strong">{money(accrual.payable)}</dd>
                  <dt>Следующая дата</dt><dd>{accrual.nextDue ? fmtDate(accrual.nextDue) : "—"}</dd>
                </dl>
                {accrual.payable > 0 && <button type="button" className="m-btn primary block" onClick={() => onPayAccrual(inv, payNow)}><Check size={18} /> Выплатить {money(payNow)}</button>}
              </div>
            )}
          </article>
        );
      })}
      {capital.perInvestor[""] > 0 && <p className="m-hint">Без привязки к вкладчику в обороте: {money(capital.perInvestor[""])}</p>}

      <div className="m-section-row">
        <h2 className="m-section-h"><span><Wallet size={17} aria-hidden="true" /> Выводы</span></h2>
        <button type="button" className="m-btn sm primary" onClick={onAddWithdrawal}><Plus size={17} /> Вывод</button>
      </div>
      {withdrawals.length === 0 ? <p className="m-empty-card">Выводов пока не было.</p> : (
        <div className="m-list">
          {withdrawals.map((w) => {
            const invName = w.investorId ? (investors.find((i) => i.id === w.investorId)?.name || "—") : "Общий пул / собственные";
            return (
              <div key={w.id} className="m-wd-row">
                <span className="m-list-main">
                  <b>{purposes[w.purpose] || "Прочее"}</b>
                  <small>{fmtDate(w.date)} · {invName}</small>
                  {w.note && <small>{w.note}</small>}
                </span>
                <b className="m-wd-sum">{money(w.amount)}</b>
                <button type="button" className="m-act danger" onClick={() => onRemoveWithdrawal(w.id)} aria-label={`Удалить вывод ${money(w.amount)} от ${fmtDate(w.date)}`}><Trash2 size={17} /></button>
              </div>
            );
          })}
        </div>
      )}

      <details className="m-report">
        <summary><FileText size={18} aria-hidden="true" /><span>Финансовый отчёт за период</span><ChevronRight size={18} className="m-report-chev" aria-hidden="true" /></summary>
        <div className="m-report-body">{report}</div>
      </details>
    </main>
  );
}
