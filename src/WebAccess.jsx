import React, { useEffect, useState, useRef } from 'react';
import { supabase, supabaseConfigured } from './supabaseClient';
import { accessFor } from './access';
import OperatorDesk from './OperatorDesk';
import TeamPanel from './TeamPanel';
import './webAccess.css';
const AdminApp = React.lazy(() => import('./rassrochki.jsx'));
export default function WebAccess() {
  const [session,setSession]=useState(undefined), [profile,setProfile]=useState(null), [checked,setChecked]=useState(false);
  const [error,setError]=useState(''), [busy,setBusy]=useState(false), [team,setTeam]=useState(false), [backupBusy,setBackupBusy]=useState(false), [backupNote,setBackupNote]=useState(null), [tick,setTick]=useState(0);
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
  if(!session) return <main className="web-card"><h1>Eppaz</h1><p>Вход в рабочий кабинет</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const f=new FormData(e.currentTarget);const {error}=await supabase.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)setError('Не удалось войти. Проверьте почту и пароль.');}catch{setError('Нет связи с сервером.');}finally{setBusy(false);}}}><label>Почта<input name="email" type="email" autoComplete="username" required/></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>{busy?'Входим…':'Войти'}</button></form>{error&&<p role="alert">{error}</p>}</main>;
  if(!checked) return <main className="web-card">Проверка прав…</main>;
  const role=accessFor(profile);
  if(role==='blocked') return <main className="web-card"><h1>Доступ не предоставлен</h1><p>{error||'Учётная запись не активирована администратором.'}</p><button onClick={()=>setTick(t=>t+1)}>Проверить снова</button> <button onClick={logout}>Выйти</button></main>;
  if(role==='operator') return <OperatorDesk onLogout={logout}/>;
  const downloadBackup=async()=>{
    if(backupBusy)return;
    setBackupBusy(true);setBackupNote(null);
    try{const {downloadCloudBackup}=await import('./cloudBackup');const r=await downloadCloudBackup(supabase);setBackupNote({ok:true,text:`Копия скачана: договоров ${r.contracts}, расходов ${r.expenses}. Файл — в «Загрузках».`});}
    catch(e){setBackupNote({ok:false,text:`Копия не скачалась: ${e.message||e}`});}
    finally{setBackupBusy(false);}
  };
  return <><div className={team?'web-admin-bar is-open':'web-admin-bar'}><span>Администратор</span><button onClick={()=>setTeam(!team)}>{team?'Вернуться к приложению':'Операторы и назначения'}</button><button disabled={backupBusy} onClick={downloadBackup} title="Все данные сайта одним файлом Excel">{backupBusy?'Готовлю копию…':'Скачать копию'}</button>{backupNote&&<span role={backupNote.ok?'status':'alert'} className={backupNote.ok?'web-admin-note':'web-admin-note bad'}>{backupNote.text}<button type="button" aria-label="Скрыть" onClick={()=>setBackupNote(null)}>×</button></span>}</div>{team?<TeamPanel/>:<React.Suspense fallback={<p>Загрузка…</p>}><AdminApp key={session.user.id} onOpenTeam={()=>setTeam(true)} onDownloadBackup={downloadBackup}/></React.Suspense>}</>;
}
