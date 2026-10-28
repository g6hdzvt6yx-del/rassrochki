import React,{useMemo,useState} from 'react';
import { directoryClients, directoryProducts } from './directories';
import { formatPhone } from './phone';
import './directories.css';
import DirectoryCatalog from './DirectoryCatalog';
import { DIRECTORY_KINDS } from './directoryCatalog';
export function ContractDirectories({contracts,onSaveClient}) {
 const [tab,setTab]=useState('clients'),[query,setQuery]=useState(''),[editing,setEditing]=useState(null),[name,setName]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const clients=useMemo(()=>directoryClients(contracts),[contracts]);
 const products=useMemo(()=>directoryProducts(contracts),[contracts]);
 const q=query.trim().toLocaleLowerCase('ru');
 const list=(tab==='clients'?clients:products).filter(row=>`${row.name} ${row.phone||''}`.toLocaleLowerCase('ru').includes(q)||(tab==='clients'&&q.replace(/\D/g,'').length>0&&String(row.phone).replace(/\D/g,'').includes(q.replace(/\D/g,''))));
 function edit(row){setEditing(row);setName(row.name);setPhone(row.phone);setError('');setNotice('');}
 return <div className="directories-contracts"><p className="muted">Клиенты и товары из всех введённых договоров. Изменение ФИО и телефона здесь обновляет сами договоры.</p><div className="directory-tabs"><button className={`btn ${tab==='clients'?'primary':'ghost'}`} disabled={busy} onClick={()=>{setTab('clients');setQuery('');}}>Клиенты · {clients.length}</button><button className={`btn ${tab==='products'?'primary':'ghost'}`} disabled={busy} onClick={()=>{setTab('products');setQuery('');}}>Товары · {products.length}</button></div>
 <label className="directory-search">{tab==='clients'?'Поиск по имени или телефону':'Поиск по названию товара'}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Начните вводить…"/></label>
 {notice&&<p role="status">{notice}</p>}
 {editing&&<form className="panel directory-editor" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSaveClient(editing.contracts.map(c=>c.id),{name,phone});setEditing(null);setNotice('Данные клиента сохранены.');}catch(err){setError(err.message);}finally{setBusy(false);}}}><h2>Редактирование клиента</h2><p>ФИО и телефон обновятся во всех договорах этого клиента ({editing.contracts.length}).</p><label>ФИО клиента<input required value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>Телефон<input type="tel" value={phone} disabled={busy} onChange={e=>setPhone(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="directory-actions"><button className="btn primary" disabled={busy}>{busy?'Сохранение…':'Сохранить'}</button><button className="btn ghost" type="button" disabled={busy} onClick={()=>setEditing(null)}>Отмена</button></div></form>}
 <p className="muted">Найдено: {list.length}</p><section className="panel directory-list">{!list.length?<p>Ничего не найдено.</p>:list.map((row,index)=><article className="directory-row" key={row.key}><div><strong>{index+1}. {row.name}</strong>{tab==='clients'&&<p>{formatPhone(row.phone)||'Телефон не указан'}</p>}<small>Договоров: {row.contracts.length}</small></div>{tab==='clients'&&<button className="btn ghost" disabled={busy} onClick={()=>edit(row)}>Редактировать</button>}</article>)}</section></div>;
}

export default function Directories({contracts,onSaveClient,items,itemsError,onItemsChange,db}) {
 const [section,setSection]=useState(DIRECTORY_KINDS[0].kind);
 const count=kind=>items.filter(i=>i.kind===kind).length;
 return <main className="wrap directories"><h1>Справочники</h1>
  <div className="directory-sections" role="tablist">{DIRECTORY_KINDS.map(k=><button key={k.kind} role="tab" aria-selected={section===k.kind} className={`btn btn-sm ${section===k.kind?'primary':'ghost'}`} onClick={()=>setSection(k.kind)}>{k.title} · {count(k.kind)}</button>)}<button role="tab" aria-selected={section==='contracts'} className={`btn btn-sm ${section==='contracts'?'primary':'ghost'}`} onClick={()=>setSection('contracts')}>Из договоров</button></div>
  {section==='contracts'?<ContractDirectories contracts={contracts} onSaveClient={onSaveClient}/>:itemsError?<section className="panel directory-editor"><p role="alert">Справочники недоступны: {itemsError}</p></section>:<DirectoryCatalog key={section} kind={section} items={items} contracts={contracts} onItemsChange={onItemsChange} db={db}/>}
 </main>;
}
