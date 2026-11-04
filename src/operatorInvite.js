// Ссылка-приглашение оператора: https://<сайт>/#invite=<код>.
// Код стоит после «#», поэтому не уходит на сервер сайта и не попадает в его журналы.
const KEY = 'eppaz-invite';
const CODE_RE = /^[0-9a-f]{64}$/;

export const inviteLink = (location, code) => `${location.origin}${location.pathname}#invite=${code}`;

/** Достаёт код из адреса (и убирает его из адресной строки) или из памяти вкладки после входа. */
export function takeInviteCode(win = window) {
  const match = /(?:^#|&)invite=([0-9a-f]{64})(?:&|$)/.exec(win.location.hash || '');
  if (match) {
    try { win.sessionStorage.setItem(KEY, match[1]); } catch { /* приватный режим: код остаётся только в адресе */ }
    try { win.history.replaceState(null, '', win.location.pathname + win.location.search); } catch { /* старый браузер */ }
    return match[1];
  }
  try { const saved = win.sessionStorage.getItem(KEY); return CODE_RE.test(saved || '') ? saved : null; } catch { return null; }
}

export function forgetInviteCode(win = window) {
  try { win.sessionStorage.removeItem(KEY); } catch { /* нечего очищать */ }
}

/** База ещё без миграции 006: функции или таблицы приглашений нет. */
export const missingFunction = (error) => Boolean(error) && (
  error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42883' || error.code === '42P01'
  || /Could not find the (function|table)|does not exist/i.test(error.message || ''));
