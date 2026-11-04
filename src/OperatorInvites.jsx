import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { inviteLink, missingFunction } from './operatorInvite';

// Приглашение операторов (аудит безопасности, находка 10).
// Руководитель создаёт ссылку на почту оператора; оператором учётная запись становится,
// только когда её владелец сам вошёл под этой почтой и подтвердил приглашение.
export default function OperatorInvites({ onChanged }) {
  const [invites, setInvites] = useState([]), [link, setLink] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  async function load() {
    const { data, error: e } = await supabase.from('operator_invites')
      .select('id,email,display_name,created_at,expires_at,accepted_at,revoked_at')
      .is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (e) { setError(missingFunction(e) ? 'Приглашения заработают после обновления базы (миграция 006).' : 'Не удалось загрузить приглашения.'); return; }
    setInvites(data || []);
  }
  useEffect(() => { load(); }, []);
  async function invite(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setBusy(true); setError(''); setLink(null); setCopied(false);
    try {
      const { data, error: rpcError } = await supabase.rpc('invite_operator', { email_address: f.get('email'), member_name: f.get('name') });
      if (rpcError) throw rpcError;
      setLink({ url: inviteLink(window.location, data.code), email: data.email, expiresAt: data.expiresAt });
      form.reset(); await load(); onChanged?.();
    } catch (err) {
      setError(missingFunction(err) ? 'Приглашения заработают после обновления базы (миграция 006).' : err.message || 'Не удалось создать приглашение.');
    } finally { setBusy(false); }
  }
  async function revoke(id) {
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('revoke_operator_invite', { invite_id: id });
    if (rpcError) setError(rpcError.message || 'Не удалось отозвать приглашение.');
    if (link && invites.find((i) => i.id === id)?.email === link.email) setLink(null);
    await load(); setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); }
  }
  const date = (v) => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return <section className="detail">
    <h2>Пригласить оператора</h2>
    <p>Оператор входит под своей почтой и сам подтверждает приглашение — без этого доступа он не получит. Учётную запись ему создайте в Supabase → Authentication → <b>Invite user</b>: письмо придёт ему, пароль он задаст сам.</p>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={invite}>
      <label>Почта оператора<input name="email" type="email" required autoComplete="off" /></label>
      <label>Имя<input name="name" required /></label>
      <button disabled={busy}>{busy ? 'Создаём…' : 'Создать приглашение'}</button>
    </form>
    {link && <div className="detail" role="status">
      <p><b>Ссылка для {link.email}</b> — действует до {date(link.expiresAt)}, сработает один раз. Сейчас она показывается в последний раз: скопируйте и отправьте её оператору.</p>
      <input readOnly value={link.url} aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать ссылку'}</button>
    </div>}
    {invites.length > 0 && <>
      <h3>Ждут подтверждения</h3>
      <ul>{invites.map((i) => <li key={i.id}>{i.display_name || i.email} · {i.email} · до {date(i.expires_at)} <button type="button" disabled={busy} onClick={() => revoke(i.id)}>Отозвать</button></li>)}</ul>
    </>}
  </section>;
}
