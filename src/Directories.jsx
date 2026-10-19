import React,{useMemo,useState} from 'react';
import { directoryClients, directoryProducts } from './directories';
import { formatPhone } from './phone';
import './directories.css';
export default function Directories({contracts,onSaveClient}) {
 const [tab,setTab]=useState('clients'),[query,setQuery]=useState(''),[editing,setEditing]=useState(null),[name,setName]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const clients=useMemo(()=>directoryClients(contracts),[contracts]);
 const products=useMemo(()=>directoryProducts(contracts),[contracts]);
 const q=query.trim().toLocaleLowerCase('ru');
 const list=(tab==='clients'?clients:products).filter(row=>`${row.name} ${row.phone||''}`.toLocaleLowerCase('ru').includes(q)||(tab==='clients'&&q.replace(/\D/g,'').length>0&&String(row.phone).replace(/\D/g,'').includes(q.replace(/\D/g,''))));
 function edit(row){setEditing(row);setName(row.name);setPhone(row.phone);setError('');setNotice('');}
 return <main className="wrap directories"><h1>Справочники</h1><p className="muted">Клиенты и товары из всех введённых договоров.</p><div className="directory-tabs"><button className={`btn ${tab==='clients'?'primary':'ghost'}`} disabled={busy} onClick={()=>{setTab('clients');setQuery('');}}>Клиенты · {clients.length}</button><button className={`btn ${tab==='products'?'primary':'ghost'}`} disabled={busy} onClick={()=>{setTab('products');setQuery('');}}>Товары · {products.length}</button></div>
 <label className="directory-search">{tab==='clients'?'Поиск по имени или телефону':'Поиск по названию товара'}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Начните вводить…"/></label>
 {notice&&<p role="status">{notice}</p>}
 {editing&&<form className="panel directory-editor" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSaveClient(editing.contracts.map(c=>c.id),{name,phone});setEditing(null);setNotice('Данные клиента сохранены.');}catch(err){setError(err.message);}finally{setBusy(false);}}}><h2>Редактирование клиента</h2><p>ФИО и телефон обновятся во всех договорах этого клиента ({editing.contracts.length}).</p><label>ФИО клиента<input required value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>Телефон<input type="tel" value={phone} disabled={busy} onChange={e=>setPhone(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="directory-actions"><button className="btn primary" disabled={busy}>{busy?'Сохранение…':'Сохранить'}</button><button className="btn ghost" type="button" disabled={busy} onClick={()=>setEditing(null)}>Отмена</button></div></form>}
 <p className="muted">Найдено: {list.length}</p><section className="panel directory-list">{!list.length?<p>Ничего не найдено.</p>:list.map((row,index)=><article className="directory-row" key={row.key}><div><strong>{index+1}. {row.name}</strong>{tab==='clients'&&<p>{formatPhone(row.phone)||'Телефон не указан'}</p>}<small>Договоров: {row.contracts.length}</small></div>{tab==='clients'&&<button className="btn ghost" disabled={busy} onClick={()=>edit(row)}>Редактировать</button>}</article>)}</section></main>;
}
