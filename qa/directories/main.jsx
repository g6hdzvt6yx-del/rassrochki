import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Directories from '../../src/Directories.jsx';
function Preview(){const [contracts,setContracts]=useState([{id:'1',clientName:'Тестовый клиент',phone:'89991234567',item:'iPhone 16'},{id:'2',clientName:'Тестовый клиент',phone:'89991234567',item:'Холодильник'},{id:'3',clientName:'Анна Тестовая',phone:'89990000000',item:'iPhone 16'}]);return <><p>Проверка на вымышленных данных</p><Directories contracts={contracts} onSaveClient={async(ids,values)=>setContracts(prev=>prev.map(c=>ids.includes(c.id)?{...c,clientName:values.name,phone:values.phone}:c))}/></>};
createRoot(document.getElementById('root')).render(<Preview/>);
