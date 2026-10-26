import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({ supabase: null, supabaseConfigured: false }));
vi.stubGlobal('window', {});
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });

const { listCloudActions } = await import('./dataClient');
const { describePaymentChanges } = await import('./DataCenter.jsx');

function fakeClient(rows, people = []) {
  const calls = [];
  const query = {
    select() { calls.push(['select']); return query; },
    order(...args) { calls.push(['order', ...args]); return query; },
    limit(...args) { calls.push(['limit', ...args]); return query; },
    eq(...args) { calls.push(['eq', ...args]); return query; },
    gte(...args) { calls.push(['gte', ...args]); return query; },
    lte(...args) { calls.push(['lte', ...args]); return query; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return {
    calls,
    from(table) { calls.push(['from', table]); return query; },
    rpc(name) { calls.push(['rpc', name]); return Promise.resolve({ data: people, error: null }); },
  };
}

describe('история изменений на сайте', () => {
  it('читает журнал из облака с фильтром по договору и подписывает автора', async () => {
    const client = fakeClient(
      [{ id: 1, actor_id: 'u1', action_type: 'update', contract_id: 'c1' }],
      [{ user_id: 'u1', display_name: 'Администратор' }],
    );
    const rows = await listCloudActions({ contractId: 'c1', actionType: 'update' }, client);
    expect(rows[0].actor_name).toBe('Администратор');
    expect(client.calls).toContainEqual(['from', 'action_log']);
    expect(client.calls).toContainEqual(['eq', 'contract_id', 'c1']);
    expect(client.calls).toContainEqual(['eq', 'action_type', 'update']);
    expect(client.calls).toContainEqual(['limit', 1000]);
  });

  it('описывает частичную оплату, полную оплату и отсрочку понятным текстом', () => {
    const before = { 0: { paymentEvents: [] }, 1: {}, 2: {} };
    const after = {
      0: { paymentEvents: [{ date: '2026-10-26', amount: 5000, comment: 'наличные' }], paidAmount: 5000 },
      1: { paidDate: '2026-10-26' },
      2: { deferredUntil: '2026-11-10', deferralReason: 'зарплата' },
    };
    const text = describePaymentChanges(before, after);
    expect(text).toContain('Платёж №1: внесено 5');
    expect(text).toContain('«наличные»');
    expect(text).toContain('Платёж №2: оплачен полностью 26.10.2026');
    expect(text).toContain('Платёж №3: отсрочка до 10.11.2026, причина: зарплата');
  });

  it('описывает отмену оплаты', () => {
    expect(describePaymentChanges({ 4: { paidDate: '2026-10-01' } }, { 4: {} }))
      .toBe('Платёж №5: снята отметка об оплате от 01.10.2026.');
  });
});
