import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: new Map(), fail: false, statements: [] }));
vi.mock('./supabaseClient', () => ({ supabase: null, supabaseConfigured: false }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({
  execute: async (sql, args) => {
    state.statements.push(sql);
    if (state.fail) throw new Error('Нет места на диске');
    if (sql.includes('INSERT INTO drafts')) state.rows.set(args[0], args[3]);
    if (sql.includes('DELETE FROM drafts')) state.rows.delete(args[0]);
  },
  select: async () => [],
}) } }));
class Storage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}
beforeEach(() => {
  vi.resetModules(); state.rows.clear(); state.fail = false; state.statements = [];
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, dispatchEvent: vi.fn() });
  vi.stubGlobal('localStorage', new Storage());
});
afterEach(() => vi.unstubAllGlobals());
const draft = { id: 'edit-contract-c1', draftType: 'Редактирование договора', data: { clientName: 'Тест', contractId: 'c1' } };

describe('локальные черновики и очередь записи', () => {
  it('сохраняет связь с договором и удаляет черновик после завершения записи', async () => {
    const { localData } = await import('./dataClient');
    await localData.saveDraft(draft);
    expect(JSON.parse(state.rows.get(draft.id)).contractId).toBe('c1');
    await localData.deleteDraft(draft.id);
    expect(state.rows.has(draft.id)).toBe(false);
    expect(localStorage.getItem(`rassrochki-draft:${draft.id}`)).toBeNull();
  });
  it('сохраняет намерение записи при ошибке базы и восстанавливает его после перезапуска', async () => {
    let { localData } = await import('./dataClient');
    await localData.listDrafts();
    state.fail = true;
    await expect(localData.saveDraft(draft)).rejects.toThrow('Нет места');
    expect(localStorage.getItem(`rassrochki-draft:${draft.id}`)).not.toBeNull();
    state.fail = false; vi.resetModules();
    ({ localData } = await import('./dataClient'));
    await localData.listDrafts();
    expect(JSON.parse(state.rows.get(draft.id))).toEqual(draft.data);
  });
  it('быстрое сохранение и закрытие оставляет последние введённые данные', async () => {
    const { localData } = await import('./dataClient');
    const first = localData.saveDraft(draft);
    const last = localData.saveDraft({ ...draft, data: { ...draft.data, comment: 'Последняя буква' } });
    await Promise.all([first, last]);
    expect(JSON.parse(state.rows.get(draft.id)).comment).toBe('Последняя буква');
  });
  it('удаление после сохранения не позволяет старой записи воскресить черновик', async () => {
    const { localData } = await import('./dataClient');
    const write = localData.saveDraft(draft);
    const remove = localData.deleteDraft(draft.id);
    await Promise.all([write, remove]);
    expect(state.rows.has(draft.id)).toBe(false);
    expect(localStorage.getItem(`rassrochki-draft:${draft.id}`)).toBeNull();
  });
});
