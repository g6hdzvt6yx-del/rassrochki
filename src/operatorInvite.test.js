import { describe, expect, it } from 'vitest';
import { inviteLink, takeInviteCode, forgetInviteCode, missingFunction } from './operatorInvite';

const CODE = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
function fakeWindow(hash) {
  const store = new Map();
  const win = {
    location: { origin: 'https://site.example', pathname: '/rassrochki/', search: '', hash },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    history: { replaceState: (_s, _t, url) => { win.location.hash = ''; win.replaced = url; } },
  };
  return win;
}
describe('ссылка-приглашение оператора', () => {
  it('код после # и в адресе не остаётся', () => {
    expect(inviteLink({ origin: 'https://site.example', pathname: '/rassrochki/' }, CODE)).toBe(`https://site.example/rassrochki/#invite=${CODE}`);
    const win = fakeWindow(`#invite=${CODE}`);
    expect(takeInviteCode(win)).toBe(CODE);
    expect(win.replaced).toBe('/rassrochki/');
    expect(takeInviteCode(win)).toBe(CODE); // после входа берётся из памяти вкладки
    forgetInviteCode(win);
    expect(takeInviteCode(win)).toBeNull();
  });
  it('мусор вместо кода игнорируется', () => {
    expect(takeInviteCode(fakeWindow('#invite=<script>'))).toBeNull();
    expect(takeInviteCode(fakeWindow('#invite=' + 'g'.repeat(64)))).toBeNull();
  });
  it('распознаёт базу без миграции 006', () => {
    expect(missingFunction({ code: 'PGRST202', message: 'Could not find the function public.invite_operator' })).toBe(true);
    expect(missingFunction({ code: 'P0001', message: 'Access denied' })).toBe(false);
  });
});
