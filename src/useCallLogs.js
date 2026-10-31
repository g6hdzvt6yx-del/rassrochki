import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabaseClient';
// Отметки операторов (call_log) и имена сотрудников для подписи «кто отметил».
// Обновляется каждые 15 секунд, при возврате в окно и сразу при новой отметке (Realtime, если включён).
export function useCallLogs(userId){
 const [logs,setLogs]=useState([]),[people,setPeople]=useState({}),[error,setError]=useState('');
 const refreshRef=useRef(()=>{});
 useEffect(()=>{
  let active=true,busy=false,again=false;
  setLogs([]);setPeople({});setError('');
  if(!userId){refreshRef.current=()=>{};return;}
  async function loadPeople(){
   try{
    if(typeof supabase.rpc!=='function')return;
    const {data,error}=await supabase.rpc('action_log_people');
    if(error||!Array.isArray(data)||!active)return;
    setPeople(Object.fromEntries(data.filter(p=>p?.user_id).map(p=>[p.user_id,p.display_name||'Сотрудник'])));
   }catch{/* без имён отметки всё равно показываются */}
  }
  async function refresh(){
   if(busy){again=true;return;}
   busy=true;
   try{
    const rows=[];
    for(let start=0;;start+=500){
     const result=await supabase.from('call_log').select('*').order('created_at',{ascending:false}).order('id').range(start,start+499);
     if(result.error)throw result.error;
     rows.push(...result.data);
     if(result.data.length<500)break;
    }
    if(active){setLogs(rows);setError('');}
   }catch{if(active)setError('Не удалось обновить результаты звонков операторов. Повторная попытка — через 15 секунд.');}
   finally{busy=false;if(again&&active){again=false;refresh();}}
  }
  refreshRef.current=refresh;
  loadPeople();refresh();
  const timer=setInterval(refresh,15000),peopleTimer=setInterval(loadPeople,300000);
  const onFocus=()=>{refresh();loadPeople();};
  window.addEventListener('focus',onFocus);
  let channel=null;
  try{
   if(typeof supabase.channel==='function'){
    channel=supabase.channel('call_log_marks').on('postgres_changes',{event:'*',schema:'public',table:'call_log'},()=>refresh()).subscribe();
   }
  }catch{channel=null;}
  return()=>{
   active=false;clearInterval(timer);clearInterval(peopleTimer);window.removeEventListener('focus',onFocus);
   if(channel)try{supabase.removeChannel(channel);}catch{/* канал уже закрыт */}
  };
 },[userId]);
 return {logs,people,error,refresh:()=>refreshRef.current()};
}
