import React, {useState} from 'react';
import {cashEntries,destinationLabel} from './cash';
const money = n => Number(n).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
export function PaymentDestination({method,card,onMethod,onCard,cards=[]}) {
 return <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><label>Способ оплаты <select aria-label="Способ оплаты" value={method} onChange={e=>onMethod(e.target.value)}><option value="">Выберите способ</option><option value="cash">Наличные</option><option value="bank">Безнал</option></select></label>{method === 'bank' && <label>Карта поступления <input aria-label="Карта поступления" list="cash-cards" value={card} onChange={e=>onCard(e.target.value)} placeholder="Банк · владелец · последние 4 цифры" maxLength={100}/><datalist id="cash-cards">{cards.map(c=><option key={c} value={c}/>)}</datalist></label>}</div>;
}
// Быстрый выбор периода на телефоне — только заполняет те же поля «С» и «По».
const pad = n => String(n).padStart(2,'0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const quickPeriods = () => {
 const now = new Date(), today = localDay(now);
 const week = new Date(now); week.setDate(week.getDate()-6);
 return [['today','Сегодня',today,today],['week','7 дней',localDay(week),today],['month','Этот месяц',today.slice(0,8)+'01',today],['all','Всё время','','']];
};
export default function CashDesk({contracts,cards,onAddCard,onOpen,phone=false}) {
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[filter,setFilter]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const entries=cashEntries(contracts);
 const labels=[...new Set(entries.map(destinationLabel))];
 const invalid=from && to && from>to;
 const rows=invalid?[]:entries.filter(e=>(!from || e.date>=from)&&(!to || e.date<=to)&&(!filter || destinationLabel(e)===filter));
 const totals=rows.reduce((a,e)=>{const k=destinationLabel(e);a[k]=(a[k]||0)+Number(e.amount);return a;},{});
 return <section className="card cash-desk"><h2>Касса</h2><p>Поступления от клиентов, включая первоначальные взносы. Это суммы поступлений, без вычета расходов. Старые оплаты без реквизитов показаны отдельно.</p>{phone && <div className="m-chips m-chips-scroll cash-quick" role="group" aria-label="Период">{quickPeriods().map(([key,label,f,t])=><button type="button" key={key} className={`m-chip ${from===f&&to===t?'on':''}`} aria-pressed={from===f&&to===t} onClick={()=>{setFrom(f);setTo(t);}}>{label}</button>)}</div>}<div className="cash-filters"><label>С <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>По <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><select aria-label="Фильтр по способу и карте" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все поступления</option>{labels.map(l=><option key={l}>{l}</option>)}</select></div>{invalid && <p role="alert">Начало периода должно быть раньше окончания.</p>}<h3>Получено: {money(rows.reduce((s,e)=>s+Number(e.amount),0))}</h3><div className="cash-summary">{Object.entries(totals).map(([label,total])=><p key={label}>{label}<br/><b>{money(total)}</b></p>)}</div><details><summary>Карты для поступлений ({cards.length})</summary>{cards.map(c=><p key={c}>{c}</p>)}<form onSubmit={async e=>{e.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');try{await onAddCard(name.trim());setName('');}catch(e){setError(e.message);}finally{setBusy(false);}}}><input aria-label="Новая карта" maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Банк · владелец · последние 4 цифры"/><button className="btn" disabled={busy||!name.trim()}>Добавить карту</button></form>{error && <p role="alert">{error}</p>}</details><div className="cash-table-wrap"><table style={{width:'100%'}}><thead><tr>{['Дата','Клиент / товар','Назначение','Куда поступило','Сумма','Комментарий'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(e=><tr key={e.id}><td>{e.date?.split('-').reverse().join('.')}</td><td><button className="cash-client" onClick={()=>onOpen(e.contractId)}>{e.client}</button><span className="cash-item">{e.item}</span></td><td>{e.purpose}</td><td>{destinationLabel(e)}</td><td>{money(e.amount)}</td><td data-empty={e.comment ? undefined : ''}>{e.comment || '—'}</td></tr>)}</tbody></table>{!rows.length&&<p>За выбранный период поступлений нет.</p>}</div></section>;
}
