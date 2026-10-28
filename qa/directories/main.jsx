import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Directories from '../../src/Directories.jsx';
import '../../src/darkTheme.css';
// Таблица directory_items в памяти: insert/update/delete с .select(), как у Supabase.
const rows=new Map();
const memoryDb={from:()=>({
 insert:list=>({select:async()=>{const out=list.map(r=>({...r,updated_at:new Date().toISOString()}));out.forEach(r=>rows.set(r.id,r));return {data:out,error:null};}}),
 update:patch=>({eq:(_,id)=>({select:async()=>{if(!rows.has(id))return {data:[],error:null};const r={...rows.get(id),...patch};rows.set(id,r);return {data:[r],error:null};}})}),
 delete:()=>({eq:async(_,id)=>{rows.delete(id);return {error:null};}}),
})};
function Preview(){const [contracts,setContracts]=useState([{id:'1',clientName:'Тестовый клиент',phone:'89991234567',item:'iPhone 16',totalPrice:90000,guarantorName:'Поручитель Тестовый',guarantorPhone:'89995554433'},{id:'2',clientName:'Тестовый клиент',phone:'89991234567',item:'Холодильник',totalPrice:45000},{id:'3',clientName:'Анна Тестовая',phone:'89990000000',item:'iPhone 16'}]);const [items,setItems]=useState([]);return <div className="app"><p>Проверка на вымышленных данных</p><Directories contracts={contracts} items={items} onItemsChange={setItems} db={memoryDb} onSaveClient={async(ids,values)=>setContracts(prev=>prev.map(c=>ids.includes(c.id)?{...c,clientName:values.name,phone:values.phone}:c))}/></div>};
createRoot(document.getElementById('root')).render(<Preview/>);
