/* Мобильный «Капитал». Расчёты и действия — из App (объект app). */

import React from "react";
import { TrendingUp, Clock, Wallet, Plus, Pencil, Trash2, Check, ChevronRight, AlertTriangle } from "lucide-react";
import { money, fmtDate, contractStats, Ribbon, WITHDRAWAL_PURPOSES, investorAccrual } from "../rassrochki.jsx";
import FinancialReport from "../FinancialReport.jsx";
import { SecHd } from "./kit";
import { MStat } from "./parts";

export default function Capital({ app }) {
  const {
    contracts, capital, investors, withdrawals, investorProfits, setProfitGroupOpen, setAddingInvestor, setEditingInvestor,
    removeInvestor, setAddingWithdrawal, removeWithdrawal, payInvestorAccrual,
  } = app;
  return (
    <>
      <div className="m-report">
        <FinancialReport contracts={contracts} investors={investors} withdrawals={withdrawals} getStats={contractStats} />
      </div>

      <div className="m-hero">
        <span className="m-hero-label">Капитал вкладчиков</span>
        <span className="m-hero-num num">{money(capital.invested)}</span>
        <Ribbon paid={capital.deployed} overdue={capital.free < 0 ? -capital.free : 0} remaining={Math.max(0, capital.free)} />
        <span className="m-legend">
          <span><i className="m-dot s-paid" />В обороте<b className="num">{money(capital.deployed)}</b></span>
          {capital.free < 0 && <span><i className="m-dot s-over" />Не хватает вложений<b className="num">{money(-capital.free)}</b></span>}
          <span><i className="m-dot s-rem" />Свободно<b className="num">{money(Math.max(0, capital.free))}</b></span>
          {capital.withdrawnTotal > 0 && <span><i className="m-dot m-dot-none" />Выведено всего<b className="num">{money(capital.withdrawnTotal)}</b></span>}
        </span>
      </div>

      <div className="m-stats">
        <MStat icon={<TrendingUp size={18} />} label="Прибыль получена" value={money(capital.profitRealized)} />
        <MStat icon={<Clock size={18} />} label="Прибыль ожидается" value={money(capital.profitExpected)} />
        <MStat wide icon={<Wallet size={18} />} label="Прибыль всего по договорам" value={money(capital.profitTotal)} />
      </div>

      <SecHd title="Прибыль по вкладчикам" />
      {!investorProfits.reconciled && (
        <div className="m-alert"><AlertTriangle size={14} /> Итоги прибыли не сходятся на {money(Math.abs(investorProfits.difference))}. Данные не исправлялись автоматически — откройте расшифровку.</div>
      )}
      <div className="m-list">
        {investorProfits.groups.map((g) => (
          <button key={g.key} type="button" className="m-card m-press m-profit" onClick={() => setProfitGroupOpen(g)}>
            <span className="m-row1">
              <span className="m-name">{g.name}</span>
              <span className="m-meta">договоров {g.contractCount} <ChevronRight size={15} /></span>
            </span>
            <span className="m-grid2 m-profit-grid">
              <span><span>Вложено</span><b className="num">{money(g.invested)}</b></span>
              <span><span>В обороте</span><b className="num">{money(g.capitalInTurnover)}</b></span>
              <span><span>Возвращено</span><b className="num">{money(g.capitalReturned)}</b></span>
              <span><span>Прибыль получена</span><b className="num">{money(g.profitReceived)}</b></span>
              <span><span>Ожидается</span><b className="num">{money(g.profitExpected)}</b></span>
              <span><span>Выплачено</span><b className="num">{money(g.paidOut)}</b></span>
              <span className="wide"><span>К выплате</span><b className="num strong">{money(g.profitToPay)}</b></span>
            </span>
          </button>
        ))}
      </div>

      <SecHd
        title="Вкладчики"
        action={<button type="button" className="m-btn primary sm" onClick={() => setAddingInvestor(true)}><Plus size={18} /> Вкладчик</button>}
      />
      {investors.length === 0 ? <div className="m-empty">Вкладчиков пока нет.</div> : (
        <div className="m-list">
          {investors.map((inv) => {
            const invDeployed = capital.perInvestor[inv.id] || 0;
            const invWithdrawn = capital.withdrawnByInvestor[inv.id] || 0;
            const invFree = (+inv.amount || 0) - invDeployed - invWithdrawn;
            const pct = capital.invested ? Math.round(((+inv.amount || 0) / capital.invested) * 100) : 0;
            const invProfit = capital.profitByInvestor[inv.id] || { realized: 0, expected: 0 };
            const accrual = investorAccrual(inv, withdrawals);
            return (
              <div key={inv.id} className="m-card m-inv">
                <div className="m-row1">
                  <span className="m-name">{inv.name}</span>
                  <span className="m-inv-acts">
                    <button type="button" className="m-ib m-ib-plain" onClick={() => setEditingInvestor(inv)} aria-label={`Изменить вкладчика ${inv.name}`}><Pencil size={18} /></button>
                    <button type="button" className="m-ib m-ib-plain" onClick={() => removeInvestor(inv.id)} aria-label={`Удалить вкладчика ${inv.name}`}><Trash2 size={18} /></button>
                  </span>
                </div>
                <div className="m-inv-sum">
                  <span className="m-amt num">{money(inv.amount)}</span>
                  <span className="m-meta">вклад · доля <b className="num">{pct}%</b></span>
                </div>
                <div className="m-grid2 m-inv-grid">
                  <div><span>В обороте</span><b className="num">{money(invDeployed)}</b></div>
                  <div><span>Выведено</span><b className="num">{money(invWithdrawn)}</b></div>
                  <div className="wide"><span>Свободно</span><b className="num strong">{money(invFree)}</b></div>
                  <div><span>Прибыль получена</span><b className="num">{money(invProfit.realized)}</b></div>
                  <div><span>Прибыль ожидается</span><b className="num">{money(invProfit.expected)}</b></div>
                </div>
                {accrual.monthly > 0 && (
                  <div className="m-accrual">
                    <div className="m-accrual-hd"><b>Ежемесячные начисления</b><span>{money(accrual.monthly)} в месяц · с {fmtDate(inv.accrualStartDate)}</span></div>
                    <div className="m-grid2">
                      <div><span>Начислено</span><b className="num">{money(accrual.accrued)}</b></div>
                      <div><span>Выплачено</span><b className="num">{money(accrual.paid)}</b></div>
                      <div><span>К выплате</span><b className="num strong">{money(accrual.payable)}</b></div>
                      <div><span>Следующая дата</span><b className="num">{accrual.nextDue ? fmtDate(accrual.nextDue) : "—"}</b></div>
                    </div>
                    {accrual.payable > 0 && (
                      <button type="button" className="m-btn primary block m-accrual-pay" onClick={() => payInvestorAccrual(inv, Math.min(accrual.monthly, accrual.payable))}>
                        <Check size={18} /> Выплатить {money(Math.min(accrual.monthly, accrual.payable))}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {capital.perInvestor[""] > 0 && (
        <div className="m-hint">Без привязки к вкладчику в обороте: <b className="num">{money(capital.perInvestor[""])}</b></div>
      )}

      <SecHd
        title="Выводы"
        action={<button type="button" className="m-btn primary sm" onClick={() => setAddingWithdrawal(true)}><Plus size={18} /> Вывод</button>}
      />
      {withdrawals.length === 0 ? <div className="m-empty">Выводов пока не было.</div> : (
        <div className="m-list">
          {withdrawals.map((w) => {
            const invName = w.investorId ? (investors.find((i) => i.id === w.investorId)?.name || "—") : "Общий пул / собственные";
            return (
              <div key={w.id} className="m-card m-wd">
                <div className="m-row1">
                  <span className="m-wd-main">
                    <span className="m-amt num">{money(w.amount)}</span>
                    <span className="m-meta">{fmtDate(w.date)} · {invName}</span>
                  </span>
                  <button type="button" className="m-ib m-ib-plain" onClick={() => removeWithdrawal(w.id)} aria-label="Удалить вывод"><Trash2 size={18} /></button>
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
