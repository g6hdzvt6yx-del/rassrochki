import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import Expenses from '../../src/Expenses.jsx';
import '../../src/darkTheme.css';
import appSource from '../../src/rassrochki.jsx?raw';
// Стенд на вымышленных данных. Таблицы в памяти; остатки пересчитываются так же,
// как триггер expenses_apply в supabase/006_expenses.sql.
const appCss=appSource.match(/const css = `([\s\S]*?)`;/)[1];
const now=new Date();const at=(days,h)=>{const d=new Date(now);d.setDate(d.getDate()-days);d.setHours(h,15,0,0);return d.toISOString();};
const tables={
 money_accounts:[{id:'m1',name:'Касса магазина',kind:'cash',balance:48500,archived:false,created_at:'1'},{id:'m2',name:'Сбер · расчётный',kind:'bank',balance:212000,archived:false,created_at:'2'}],
 expense_categories:[{id:'k1',name:'Аренда',created_at:'1'}],
 expenses:[
  {id:'e1',amount:32000,category:'purchase',occurred_at:at(0,11),account_id:'m2',to_account_id:null,recipient:'ООО Поставщик',comment:'Партия чехлов',receipt:{name:'чек-1.jpg',path:'x'},created_by_name:'Администратор',created_at:at(0,11)},
  {id:'e2',amount:15000,category:'collection',occurred_at:at(1,19),account_id:'m1',to_account_id:null,recipient:'Владелец',comment:'',receipt:null,created_by_name:'Администратор',created_at:at(1,19)},
  {id:'e3',amount:20000,category:'collection',occurred_at:at(2,18),account_id:'m1',to_account_id:'m2',recipient:'',comment:'Сдали выручку на счёт',receipt:null,created_by_name:'Администратор',created_at:at(2,18)},
  {id:'e4',amount:25000,category:'salary',occurred_at:at(3,10),account_id:'m1',to_account_id:null,recipient:'Тестовый продавец',comment:'Аванс',receipt:null,created_by_name:'Администратор',created_at:at(3,10)},
  {id:'e5',amount:18000,category:'k1',occurred_at:at(5,9),account_id:'m2',to_account_id:null,recipient:'ИП Арендодатель',comment:'',receipt:null,created_by_name:'Администратор',created_at:at(5,9)},
 ]};
const bal=(id,d)=>{const a=tables.money_accounts.find(x=>x.id===id);if(a)a.balance=Math.round((a.balance+d)*100)/100;};
const undo=e=>{bal(e.account_id,e.amount);if(e.to_account_id)bal(e.to_account_id,-e.amount);};
const apply=e=>{bal(e.account_id,-e.amount);if(e.to_account_id)bal(e.to_account_id,e.amount);};
const ok=data=>Promise.resolve({data,error:null});
const read=t=>{const q={order:()=>q,limit:()=>q,then:(r,j)=>ok(structuredClone(tables[t])).then(r,j)};return q;};
const memoryDb={
 from:t=>({
  select:()=>read(t),
  insert:row=>({select:()=>{const r={...row,created_at:new Date().toISOString()};if(t==='expenses'){r.created_by_name='Администратор';apply(r);}if(t==='money_accounts'){r.balance??=0;r.archived??=false;}tables[t].unshift(r);return ok([structuredClone(r)]);}}),
  update:patch=>({eq:(_,id)=>({select:()=>{const r=tables[t].find(x=>x.id===id);if(!r)return ok([]);if(t==='expenses'){undo(r);Object.assign(r,patch,{updated_by_name:'Администратор',updated_at:new Date().toISOString()});apply(r);}else Object.assign(r,patch);return ok([structuredClone(r)]);}})}),
  delete:()=>({eq:(_,id)=>{const r=tables[t].find(x=>x.id===id);if(t==='money_accounts'&&tables.expenses.some(e=>e.account_id===id||e.to_account_id===id))return Promise.resolve({error:{message:'violates foreign key constraint'}});if(t==='expenses'&&r)undo(r);tables[t]=tables[t].filter(x=>x.id!==id);return Promise.resolve({error:null});}}),
 }),
 storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null})})},
};
function Preview(){
 const [dialog,setDialog]=useState(null);const resolver=useRef(null);
 const requestConfirm=o=>new Promise(r=>{resolver.current=r;setDialog(o);});
 const done=v=>{resolver.current?.(v);setDialog(null);};
 return <div className="app"><style>{appCss}</style><p style={{padding:'8px 16px',margin:0}}>Стенд на вымышленных данных</p>
  <Expenses db={memoryDb} ownerId="owner" requestConfirm={requestConfirm} directoryItems={[{kind:'cashboxes',data:{name:'Касса на рынке'}}]}/>
  {dialog&&<div className="overlay nested-overlay" onClick={()=>done(false)}><div className="confirm-card" onClick={e=>e.stopPropagation()}><h3>{dialog.title}</h3><p>{dialog.message}</p><div className="sheet-actions"><button className="btn ghost" onClick={()=>done(false)}>Отмена</button><button className="btn danger" onClick={()=>done(true)}>{dialog.confirmLabel}</button></div></div></div>}
 </div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
