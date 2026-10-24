import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { syncRow, stable, syncTables } from './syncModel';
import { cloudWritePending } from './guardedCloudClient';

const signature = data => stable(Object.fromEntries(syncTables.map(t => [t, data[t].map(r => syncRow(t, r)).sort((a,b) => a.id.localeCompare(b.id))])));
export default function WebSyncStatus({ rows, paused, onRefresh }) {
  const latest = useRef({});
  latest.current = { signature: signature(rows), paused, onRefresh };
  const [error, setError] = useState('');
  const [checkedAt,setCheckedAt]=useState(null);
  const [checking,setChecking]=useState(false);
  const refresh=useRef(null);
  useEffect(() => {
    let disposed = false, running = false;
    const tick = async () => {
      if (running || disposed || document.hidden || latest.current.paused || cloudWritePending()) return;
      running = true; setChecking(true);
      const initial = latest.current.signature;
      try {
        const remote = {};
        for (const table of syncTables) {
          remote[table] = [];
          for (let start = 0; ; start += 500) {
            const { data, error } = await supabase.from(table).select('*').order('id').range(start, start + 499);
            if (error) throw error;
            remote[table].push(...data);
            if (data.length < 500) break;
          }
        }
        if (disposed) return;
        setError(''); setCheckedAt(new Date());
        if (!latest.current.paused && !cloudWritePending() && latest.current.signature === initial && signature(remote) !== initial) latest.current.onRefresh();
      } catch (e) { if (!disposed) setError('Не удалось проверить изменения с Mac. ' + e.message); }
      finally { running = false; if(!disposed)setChecking(false); }
    };
    refresh.current=tick;
    tick();
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick); window.addEventListener('online', tick);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', tick); window.removeEventListener('online', tick); };
  }, []);
  return <div className="sync-indicator" role="status">
    <span className="sync-dot" aria-hidden="true"/>
    <span>{error || (paused ? 'Обновление приостановлено' : checking ? 'Обновление…' : checkedAt ? `обновлено ${checkedAt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}` : 'Ожидает обновления')}</span>
    <button className="btn ghost btn-sm" aria-label="Обновить данные" title="Обновить данные" disabled={paused || checking || cloudWritePending()} onClick={()=>refresh.current?.()}>↻</button>
  </div>;
}
