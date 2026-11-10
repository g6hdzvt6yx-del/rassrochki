import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Scale } from "lucide-react";
import { localDay, monthPeriod, monthTitle, ownerNetProfit, shiftMonthKey } from "./netProfit";
import "./expenses.css";

const money = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + " ₽";

// «Чистая прибыль» на Сводке: наценка − выплаты вкладчикам − расходы за выбранный месяц.
export default function NetProfitPanel({ contracts, withdrawals, expenses, getStats, expensesError = "", onOpenExpenses }) {
  const today = localDay();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const result = useMemo(() => {
    try { return ownerNetProfit({ contracts, withdrawals, expenses, getStats, ...monthPeriod(month, today) }); }
    catch { return null; }
  }, [contracts, withdrawals, expenses, month, today]);
  if (!result) return null;
  const negative = result.net < 0;
  return (
    <section className="net-profit" aria-label="Чистая прибыль">
      <div className="net-profit-hd">
        <span className="net-profit-title"><Scale size={15} aria-hidden="true" /> Чистая прибыль</span>
        <span className="net-profit-month">
          <button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth((m) => shiftMonthKey(m, -1))}><ChevronLeft size={16} /></button>
          <b>{monthTitle(month)}</b>
          <button type="button" aria-label="Следующий месяц" disabled={month >= current} onClick={() => setMonth((m) => shiftMonthKey(m, 1))}><ChevronRight size={16} /></button>
        </span>
      </div>
      <dl className="net-profit-rows">
        <div><dt>Наценка получена</dt><dd>{money(result.profitReceived)}</dd></div>
        <div><dt>− Выплачено вкладчикам</dt><dd>{money(result.investorPayout)}</dd></div>
        <div><dt>− Расходы{onOpenExpenses && <> · <button type="button" className="net-profit-link" onClick={onOpenExpenses}>открыть</button></>}</dt><dd>{money(result.expenses)}</dd></div>
        <div className={`net-profit-total ${negative ? "bad" : "ok"}`}><dt>= Чистая прибыль</dt><dd>{money(result.net)}</dd></div>
      </dl>
      {expensesError && <p role="alert" className="exp-error">Расходы не загрузились — чистая прибыль посчитана без них.</p>}
    </section>
  );
}
