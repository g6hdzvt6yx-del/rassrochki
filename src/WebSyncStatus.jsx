import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { syncRow, stable, syncTables } from './syncModel';
import { cloudWritePending } from './guardedCloudClient';

const signature = data => stable(Object.fromEntries(syncTables.map(t => [t, data[t].map(r => syncRow(t, r)).sort((a,b) => a.id.localeCompare(b.id))])));
export default function WebSyncStatus({ rows, paused, onRefresh }) {
  const latest = useRef({});
  latest.current = { signature: signature(rows), paused, onRefresh };
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, running = false;
    const tick = async () => {
      if (running || disposed || document.hidden || latest.current.paused || cloudWritePending()) return;
      running = true;
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
        setError('');
        if (!latest.current.paused && !cloudWritePending() && latest.current.signature === initial && signature(remote) !== initial) latest.current.onRefresh();
      } catch (e) { if (!disposed) setError('Не удалось проверить изменения с Mac. ' + e.message); }
      finally { running = false; }
    };
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick); window.addEventListener('online', tick);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', tick); window.removeEventListener('online', tick); };
  }, []);
  return <div style={{ padding: '8px 0', fontSize: 13 }} role="status">
    {error || (paused ? 'Обновление с Mac продолжится после закрытия карточки.' : 'Данные сайта проверяются каждые 30 секунд.')}
    <button className="btn ghost btn-sm" disabled={paused || cloudWritePending()} onClick={onRefresh}>Обновить данные</button>
  </div>;
}
