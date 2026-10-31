import { operatorReminderLink } from "./whatsapp";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from './supabaseClient';
import {callResults} from './access';
import {callSchedule} from './callQueue';
import {matchesOperatorSearch} from './operatorSearch';
import './operatorDesk.css';

const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);
const day=d=>d?new Date(d).toLocaleDateString('ru-RU'):'';
const dayTime=d=>d?new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
const DAY=86400000;
const FILTERS={overdue:'Просрочки',upcoming:'Ближайшие платежи',callback:'Перезвонить',promised:'Обещали оплатить',all:'Все назначенные'};
const DEFAULT_SORT={overdue:['overdue','desc'],upcoming:['next','asc'],callback:['callback','asc'],promised:['promised','asc'],all:['name','asc']};
const RESULT_TONE={informed:'ok',promised:'ok',reported_paid:'warn',callback:'warn',no_answer:'bad',wrong_number:'bad',help:'bad',refused:'bad'};

function ReminderButton({client,compact}) {
 const href=operatorReminderLink(client);
 if(href) return <a className="op-wa" href={href} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} aria-label={`Напомнить в WhatsApp: ${client.clientName}`}>{compact?'WhatsApp':'Напомнить в WhatsApp'}</a>;
 return <span className="op-muted">{client.schedule.some(p=>p.remaining>0)?'Нет номера для WhatsApp':'Нет платежей'}</span>;
}

function matchesFilter(c,filter,now){
 if(filter==='all')return true;
 if(filter==='overdue')return c.overdueSum>0;
 if(filter==='upcoming')return c.schedule.some(p=>p.upcoming);
 if(filter==='callback')return Boolean(c.last?.next_contact_at&&new Date(c.last.next_contact_at)<=now);
 if(filter==='promised')return c.last?.result==='promised'&&c.schedule.some(p=>p.remaining>0);
 return true;
}

function sortValue(c,key){
 if(key==='name')return c.clientName||'';
 if(key==='overdue')return c.overdueSum;
 if(key==='next')return c.next?c.next.due.getTime():Infinity;
 if(key==='last')return c.last?new Date(c.last.created_at).getTime():0;
 if(key==='callback')return c.last?.next_contact_at?new Date(c.last.next_contact_at).getTime():Infinity;
 if(key==='promised')return c.last?.promised_date?new Date(c.last.promised_date).getTime():Infinity;
 return 0;
}

export default function OperatorDesk({onLogout}){
 const [clients,setClients]=useState([]),[logs,setLogs]=useState([]),[error,setError]=useState(''),[filter,setFilter]=useState('overdue'),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[outcome,setOutcome]=useState('informed');
 const [query,setQuery]=useState('');
 const [sort,setSort]=useState(DEFAULT_SORT.overdue);
 const panelRef=useRef(null);
 async function load(){setError('');const [a,b]=await Promise.all([supabase.rpc('operator_clients'),supabase.from('call_log').select('*').order('created_at',{ascending:false})]);if(a.error||b.error){setClients([]);setLogs([]);setError('Не удалось обновить данные. Повторите загрузку.');}else{setClients(a.data||[]);setLogs(b.data||[]);}setLoading(false);}
 useEffect(()=>{load();const timer=setInterval(load,60000);window.addEventListener('focus',load);return()=>{clearInterval(timer);window.removeEventListener('focus',load);};},[]);
 useEffect(()=>{if(selected){panelRef.current?.focus({preventScroll:true});}},[selected]);
 useEffect(()=>{const onKey=e=>{if(e.key==='Escape')setSelected(null);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);

 const now=new Date();
 const today=new Date(now);today.setHours(0,0,0,0);
 const rows=useMemo(()=>clients.map(c=>{
  const schedule=callSchedule(c);
  const overdue=schedule.filter(p=>p.overdue);
  const pending=schedule.filter(p=>p.remaining>0).sort((a,b)=>a.due-b.due);
  const oldest=overdue.sort((a,b)=>a.due-b.due)[0];
  return {...c,schedule,overdueSum:overdue.reduce((s,p)=>s+p.remaining,0),overdueCount:overdue.length,
   overdueDays:oldest?Math.round((today-oldest.due)/DAY):0,next:pending.find(p=>!p.overdue)||null,
   last:logs.find(l=>l.contract_id===c.id)};
 }),[clients,logs]);
 const counts=Object.fromEntries(Object.keys(FILTERS).map(k=>[k,rows.filter(c=>matchesFilter(c,k,now)).length]));
 const visible=rows.filter(c=>matchesOperatorSearch(c,query)).filter(c=>matchesFilter(c,filter,now)).sort((a,b)=>{
  const [key,dir]=sort;const va=sortValue(a,key),vb=sortValue(b,key);
  const res=typeof va==='string'?va.localeCompare(vb,'ru'):va-vb;
  return dir==='asc'?res:-res;
 });
 const totalOverdue=visible.reduce((s,c)=>s+c.overdueSum,0);
 const client=rows.find(c=>c.id===selected);
 const chooseFilter=key=>{setFilter(key);setSort(DEFAULT_SORT[key]);setSelected(null);};
 const sortBy=key=>setSort(([k,d])=>k===key?[key,d==='asc'?'desc':'asc']:[key,key==='overdue'||key==='last'?'desc':'asc']);
 const Th=({k,children,className})=><th className={className} aria-sort={sort[0]===k?(sort[1]==='asc'?'ascending':'descending'):'none'}><button type="button" onClick={()=>sortBy(k)}>{children}{sort[0]===k?(sort[1]==='asc'?' ↑':' ↓'):''}</button></th>;

 return <main className="desk op-desk">
  <header><div><small>Кабинет оператора</small><h1>Кому позвонить</h1></div><button onClick={onLogout}>Выйти</button></header>
  <nav className="op-filters">{Object.entries(FILTERS).map(([key,label])=><button className={filter===key?'selected':''} key={key} onClick={()=>chooseFilter(key)}>{label} <span className="op-count">{counts[key]}</span></button>)}</nav>
  <div className="op-toolbar">
   <label className="op-search"><span className="sr-only">Поиск клиентов</span><input type="search" placeholder="Поиск: имя, телефон или товар" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div className="op-summary">Клиентов: <b>{visible.length}</b>{totalOverdue>0&&<> · просрочено всего: <b className="op-bad">{money(totalOverdue)}</b></>}</div>
  </div>
  {error&&<p role="alert">{error} <button onClick={load}>Повторить</button></p>}
  {loading?<p>Загрузка клиентов…</p>:!visible.length?<p className="op-empty">{query.trim()?'По запросу в этом разделе ничего не найдено. Для поиска по всем клиентам выберите «Все назначенные».':'В этом списке пока нет клиентов.'}</p>:
  <div className="op-table-wrap"><table className="op-table">
   <thead><tr><th className="op-num">№</th><Th k="name">Клиент</Th><th>Телефон</th><Th k="overdue" className="op-right">Просрочено</Th><Th k="next">Ближайший платёж</Th><Th k="last">Последняя отметка</Th><th className="op-actions-col">Действия</th></tr></thead>
   <tbody>{visible.map((c,index)=><tr key={c.id} className={selected===c.id?'on':''} onClick={()=>setSelected(c.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setSelected(c.id);}}>
    <td className="op-num" data-label="№">{index+1}</td>
    <td data-label="Клиент" className="op-client"><div className="op-cell"><b>{c.clientName}</b><small>{c.item}</small></div></td>
    <td data-label="Телефон"><div className="op-cell">{c.phone?<a href={'tel:'+String(c.phone).replace(/[^+\d]/g,'')} onClick={e=>e.stopPropagation()}>{c.phone}</a>:<span className="op-muted">нет</span>}</div></td>
    <td data-label="Просрочено" className="op-right"><div className="op-cell">{c.overdueSum>0?<><b className="op-bad">{money(c.overdueSum)}</b><small>{c.overdueCount} плат. · {c.overdueDays} дн.</small></>:<span className="op-muted">—</span>}</div></td>
    <td data-label="Ближайший платёж"><div className="op-cell">{c.next?<><b>{day(c.next.due)}</b><small>{money(c.next.remaining)}{c.next.upcoming?' · скоро':''}</small></>:<span className="op-muted">—</span>}</div></td>
    <td data-label="Последняя отметка"><div className="op-cell">{c.last?<><span className={`op-tag ${RESULT_TONE[c.last.result]||''}`}>{callResults[c.last.result]||c.last.result}</span><small>{dayTime(c.last.created_at)}{c.last.promised_date?` · обещал ${day(c.last.promised_date)}`:''}{c.last.next_contact_at?` · перезвонить ${dayTime(c.last.next_contact_at)}`:''}</small></>:<span className="op-muted">не звонили</span>}</div></td>
    <td data-label="Действия" className="op-actions-col"><div className="op-actions"><ReminderButton client={c} compact/><button type="button" onClick={e=>{e.stopPropagation();setSelected(c.id);}}>Звонок</button></div></td>
   </tr>)}</tbody>
  </table></div>}

  {client&&<div className="op-overlay" onClick={()=>setSelected(null)}>
   <aside className="op-panel" ref={panelRef} tabIndex={-1} aria-label="Карточка клиента" onClick={e=>e.stopPropagation()}>
    <div className="op-panel-hd"><div><h2>{client.clientName}</h2><small>{client.item}</small></div><button type="button" className="op-close" onClick={()=>setSelected(null)} aria-label="Закрыть">✕</button></div>
    <div className="op-panel-body">
     <div className="op-contact">{client.phone?<a className="op-call" href={'tel:'+String(client.phone).replace(/[^+\d]/g,'')}>📞 {client.phone}</a>:<span className="op-muted">Телефон не указан</span>}<ReminderButton client={client}/></div>
     <div className="op-facts">
      <div><span>Просрочено</span><b className={client.overdueSum>0?'op-bad':''}>{money(client.overdueSum)}</b></div>
      <div><span>Ближайший платёж</span><b>{client.next?`${day(client.next.due)} · ${money(client.next.remaining)}`:'—'}</b></div>
     </div>
     <h3>График платежей</h3>
     <table className="op-schedule"><tbody>{client.schedule.map(p=><tr key={p.index} className={p.overdue?'bad':p.remaining?'':'ok'}><td>{p.index+1}</td><td>{p.due.toLocaleDateString('ru-RU')}</td><td className="op-right">{p.remaining?money(p.remaining):'Оплачено'}</td><td>{p.overdue?'просрочено':p.remaining?(p.upcoming?'скоро':'к оплате'):''}</td></tr>)}</tbody></table>
     <form key={client.id} className="op-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const form=e.currentTarget,f=new FormData(form);try{const {error}=await supabase.rpc('record_call',{cid:client.id,outcome,message:f.get('note'),next_at:outcome==='callback'?new Date(f.get('next')).toISOString():null,promise_date:outcome==='promised'?f.get('date'):null,promise_amount:outcome==='promised'?Number(f.get('amount')):null});if(error)throw error;form.reset();setOutcome('informed');await load();}catch{setError('Результат не сохранён. Проверьте связь и назначение клиента.');}finally{setBusy(false);}}}>
      <h3>Результат звонка</h3>
      <div className="op-outcomes" role="radiogroup" aria-label="Результат звонка">{Object.entries(callResults).map(([k,v])=><button type="button" role="radio" aria-checked={outcome===k} key={k} className={outcome===k?'selected':''} onClick={()=>setOutcome(k)}>{v}</button>)}</div>
      {outcome==='callback'&&<label>Когда перезвонить<input name="next" type="datetime-local" required/></label>}
      {outcome==='promised'&&<div className="op-row"><label>Дата оплаты<input name="date" type="date" required/></label><label>Сумма<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={client.overdueSum||client.next?.remaining||''}/></label></div>}
      <label>Комментарий<textarea name="note" maxLength={2000} placeholder="Что сказал клиент"/></label>
      <button disabled={busy}>{busy?'Сохранение…':'Сохранить результат'}</button>
      {error&&<p role="alert">{error}</p>}
      <p className="op-muted">Обещание или сообщение об оплате не изменяет долг.</p>
     </form>
     <h3>История общения</h3>
     {logs.filter(l=>l.contract_id===client.id).map(l=><article key={l.id} className="op-log"><span className={`op-tag ${RESULT_TONE[l.result]||''}`}>{callResults[l.result]||l.result}</span>{l.note&&<p>{l.note}</p>}<small>{new Date(l.created_at).toLocaleString('ru-RU')}{l.promised_date?' · обещал '+day(l.promised_date)+' · '+money(l.promised_amount):''}{l.next_contact_at?' · перезвонить '+new Date(l.next_contact_at).toLocaleString('ru-RU'):''}</small></article>)}
     {!logs.some(l=>l.contract_id===client.id)&&<p className="op-muted">Звонков ещё не было.</p>}
    </div>
   </aside>
  </div>}
 </main>;
}
