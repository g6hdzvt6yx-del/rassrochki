import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, Wallet, Phone, MessageCircle, Plus } from 'lucide-react';
import { contractsForClient, summarizeClient } from './clientSummary';
import { formatPhone, normalizePhone } from './phone';
import './clientCard.css';

const money = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' ₽';
const date = value => {
  const parsed = new Date(`${String(value || '').slice(0,10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'дата не указана' : new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric' }).format(parsed);
};
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function ClientCard({ contract, contracts, contacts, getStats, investors, onClose, onOpenContract, onExternal, renderContacts }) {
  const [action, setAction] = useState('');
  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const today = todayKey();
  const related = contractsForClient(contracts, contract);
  const summary = summarizeClient(related, getStats, today);
  const promise = contacts.find(c => c.promisedDate || +c.promisedAmount > 0);
  const latest = contacts[0];
  const phone = normalizePhone(contract.phone);
  const choose = mode => {
    const choices = mode === 'pay' ? summary.items.filter(i => i.stats.remaining > 0) : summary.items;
    if (choices.length === 1) onOpenContract(choices[0].contract.id, mode);
    else setAction(action === mode ? '' : mode);
  };
  return <div className="overlay" onClick={onClose}>
    <div className="sheet client-sheet" role="dialog" aria-modal="true" aria-label="Карточка клиента" onClick={e => e.stopPropagation()}>
      <header className="sheet-hd"><button className="icon-btn" onClick={onClose} aria-label="Закрыть карточку"><ChevronLeft size={18}/></button><div><div className="sheet-name">{contract.clientName || 'Клиент без имени'}</div><div className="client-muted">Действующих договоров: {summary.active} · всего: {related.length}</div>{contract.phone && <div className="client-muted">{formatPhone(contract.phone)}</div>}</div><button className="icon-btn client-close" onClick={onClose} aria-label="Закрыть"><X size={18}/></button></header>
      <div className="sheet-body">
        <section className="client-total"><span>Остаток по всем договорам</span><strong className="num">{money(summary.remaining)}</strong><small>На {date(today)}</small>
          {summary.overdue > 0 ? <div className="client-overdue"><span>Из него просрочено <b>{money(summary.overdue)}</b></span><span>{summary.overdueDays} дн. с первого неоплаченного срока</span></div> : <div className="client-clear">Просрочки нет</div>}
        </section>
        <div className="client-facts"><div><span>Ближайший будущий платёж</span><b>{summary.next.length ? money(summary.nextAmount) : 'Нет будущих платежей'}</b>{summary.next.length > 0 && <><small>{date(summary.next[0].date)}</small>{summary.next.map(p => <small key={`${p.contract.id}:${p.row.n}`}>{p.contract.item || 'Без названия'} · {money(p.amount)}</small>)}</>}</div><div><span>Последний платёж</span><b>{summary.lastPayment ? money(summary.lastPayment.amount) : 'Платежей с датой нет'}</b>{summary.lastPayment && <><small>{date(summary.lastPayment.date)}</small><small>{summary.lastPayment.contract.item || 'Без названия'}</small></>}</div></div>
        {promise ? <section className="client-promise"><span>Последнее записанное обещание</span><b>{+promise.promisedAmount > 0 ? money(+promise.promisedAmount) : 'Сумма не указана'} · {promise.promisedDate ? `до ${date(promise.promisedDate)}` : 'без срока'}</b><small>{promise._item || 'Договор'} · записано {date(promise.occurredAt)}</small><p>{promise.note}</p><small>Запись разговора; выполнение обещания автоматически не проверяется.</small></section> : <section className="client-promise"><span>Договорённости</span><b>Обещаний оплаты пока нет</b></section>}
        {latest && <div className="client-last-contact">Последний контакт: {date(latest.occurredAt)}{latest.nextContactDate && ` · связаться снова ${date(latest.nextContactDate)}`}</div>}
        <div className="client-actions"><button className="btn primary" disabled={!summary.active} onClick={() => choose('pay')}><Wallet size={15}/> Принять платёж</button><button className="btn ghost" disabled={!phone} onClick={() => setAction(action === 'contact' ? '' : 'contact')}><Phone size={15}/> Связаться</button><button className="btn ghost" onClick={() => choose('note')}><Plus size={15}/> Записать договорённость</button></div>
        {action === 'contact' && <div className="client-picker"><button className="btn ghost" onClick={() => onExternal(`tel:+${phone}`)}><Phone size={14}/> Позвонить</button><button className="btn ghost" onClick={() => onExternal(`https://wa.me/${phone}`)}><MessageCircle size={14}/> WhatsApp</button></div>}
        {(action === 'pay' || action === 'note') && <div className="client-picker"><b>{action === 'pay' ? 'По какому договору принять платёж?' : 'К какому договору относится договорённость?'}</b>{summary.items.filter(i => action !== 'pay' || i.stats.remaining > 0).map(({ contract:c, stats }) => <button key={c.id} className="client-choice" onClick={() => onOpenContract(c.id, action)}><span>{c.item || 'Без названия'}<small>Первый платёж: {date(c.startDate)}</small></span><b>{money(Math.max(0,stats.remaining))}</b></button>)}</div>}
        <h3 className="client-section-title">Договоры клиента</h3>
        {summary.items.map(({contract:c,stats}) => <details className="client-contract" key={c.id}><summary><div><b>{c.item || 'Без названия'}</b><small>{c.termMonths} мес. · с {date(c.startDate)}</small></div><div className="client-contract-right"><b className="num">{money(Math.max(0,stats.remaining))}</b><small className={stats.overdueSum > 0 ? 'client-danger' : ''}>{stats.overdueSum > 0 ? `Просрочено ${money(stats.overdueSum)}` : stats.remaining <= 0 ? 'Закрыт' : 'Без просрочки'}</small></div></summary><div className="client-contract-body"><div className="client-facts"><div><span>Цена / первоначальный взнос</span><b>{money(c.totalPrice)} / {money(c.downPayment)}</b></div><div><span>Наценка</span><b>{money(c.markup)}</b></div><div><span>Источник</span><b>{c.investorId ? investors.find(i => i.id === c.investorId)?.name || 'Не найден' : 'Общий пул'}</b></div><div><span>Поручитель</span><b>{c.guarantorName || 'Не указан'}</b></div></div>{c.comment && <p className="client-comment">{c.comment}</p>}<div className="client-actions"><button className="btn ghost" onClick={() => onOpenContract(c.id)}>Открыть договор и график</button>{stats.remaining > 0 && <button className="btn primary" onClick={() => onOpenContract(c.id,'pay')}>Принять платёж</button>}</div></div></details>)}
        <details className="client-history"><summary>История платежей <span>{summary.payments.length}</span></summary>{summary.undated > 0 && <p className="client-danger">Платежи без корректной даты: {money(summary.undated)}. Они учтены в остатках, но не показаны в истории по датам.</p>}{summary.payments.length ? summary.payments.map(p => <button className="client-history-row" key={p.key} onClick={() => onOpenContract(p.contract.id)}><div><b>{date(p.date)}</b><small>{p.contract.item || 'Без названия'} · платёж № {p.paymentNo}</small></div><strong className="num">{money(p.amount)}</strong></button>) : <p className="client-muted">Платежей с указанной датой пока нет.</p>}</details>
        <details className="client-history"><summary>История общения <span>{contacts.length}</span></summary>{contacts.length ? renderContacts(contacts) : <p className="client-muted">Контактов пока нет.</p>}</details>
      </div>
    </div>
  </div>;
}
