import React, { useEffect, useState, useRef } from 'react';
import { supabase, supabaseConfigured } from './supabaseClient';
import { accessFor } from './access';
import OperatorDesk from './OperatorDesk';
import TeamPanel from './TeamPanel';
import './webAccess.css';
const MacBackupImport = React.lazy(() => import('./MacBackupImport'));
const AdminApp = React.lazy(() => import('./rassrochki.jsx'));
export default function WebAccess() {
  const [session,setSession]=useState(undefined), [profile,setProfile]=useState(null), [checked,setChecked]=useState(false);
  const [error,setError]=useState(''), [busy,setBusy]=useState(false), [team,setTeam]=useState(false), [importOpen,setImportOpen]=useState(false), [importBusy,setImportBusy]=useState(false), [appVersion,setAppVersion]=useState(0), [tick,setTick]=useState(0);
  const sessionUser = useRef(null);
  useEffect(()=>{
    if (!supabaseConfigured) {setSession(null); return;}
    supabase.auth.getSession().then(({data,error})=>{if(error)setError(error.message);setSession(data.session);});
    const {data}=supabase.auth.onAuthStateChange((_,s)=>{setSession(s);if(sessionUser.current!==s?.user?.id){setChecked(false);setProfile(null);sessionUser.current=s?.user?.id;}});
    return ()=>data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    if (!session) return;
    let live=true;
    const check=async()=>{
      const {data,error}=await supabase.from('app_members').select('user_id,owner_id,role,active,display_name').eq('user_id',session.user.id).maybeSingle();
      if(live){setProfile(error?null:data);setError(error?'Не удалось проверить права доступа. Обратитесь к администратору.':'');setChecked(true);}
    };
    check();const timer=setInterval(check,30000);window.addEventListener('focus',check);
    return ()=>{live=false;clearInterval(timer);window.removeEventListener('focus',check);};
  },[session,tick]);
  const logout=()=>supabase.auth.signOut();
  if(!supabaseConfigured) return <main className="web-card"><h1>Настройка подключения</h1><p>База данных ещё не подключена.</p></main>;
  if(session===undefined) return <main className="web-card">Проверка входа…</main>;
  if(!session) return <main className="web-card"><h1>Рассрочки</h1><p>Вход в рабочий кабинет</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const f=new FormData(e.currentTarget);const {error}=await supabase.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)setError('Не удалось войти. Проверьте почту и пароль.');}catch{setError('Нет связи с сервером.');}finally{setBusy(false);}}}><label>Почта<input name="email" type="email" autoComplete="username" required/></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>{busy?'Входим…':'Войти'}</button></form>{error&&<p role="alert">{error}</p>}</main>;
  if(!checked) return <main className="web-card">Проверка прав…</main>;
  const role=accessFor(profile);
  if(role==='blocked') return <main className="web-card"><h1>Доступ не предоставлен</h1><p>{error||'Учётная запись не активирована администратором.'}</p><button onClick={()=>setTick(t=>t+1)}>Проверить снова</button> <button onClick={logout}>Выйти</button></main>;
  if(role==='operator') return <OperatorDesk onLogout={logout}/>;
  return <><div className="web-admin-bar"><span>Администратор</span><button disabled={importBusy} onClick={()=>{setImportOpen(false);setTeam(!team);}}>{team?'Вернуться к приложению':'Операторы и назначения'}</button><button disabled={importBusy} onClick={()=>{setTeam(false);setImportOpen(!importOpen);}}>{importOpen?'Вернуться к приложению':'Перенести копию с Mac'}</button></div>{importOpen?<React.Suspense fallback={<p>Загрузка импорта…</p>}><MacBackupImport ownerId={session.user.id} onBusyChange={setImportBusy} onDone={()=>setAppVersion(v=>v+1)}/></React.Suspense>:team?<TeamPanel/>:<React.Suspense fallback={<p>Загрузка…</p>}><AdminApp key={session.user.id+":"+appVersion}/></React.Suspense>}</>;
}
