import {useEffect,useState} from 'react';
import {supabase} from './supabaseClient';
export function useCallLogs(userId){
 const [logs,setLogs]=useState([]),[error,setError]=useState('');
 useEffect(()=>{
  let active=true,busy=false;
  setLogs([]);setError('');
  if(!userId)return;
  async function refresh(){
   if(busy)return;
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
   finally{busy=false;}
  }
  refresh();const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[userId]);
 return {logs,error};
}
