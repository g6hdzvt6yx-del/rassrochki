import { describe, it, expect } from 'vitest';
import { latestCallResults, matchesCallResultFilter } from './access';
describe('фильтр по отметке оператора', () => {
  const logs = [
    { contract_id: 'a', result: 'no_answer', created_at: '2026-10-20T10:00:00Z' },
    { contract_id: 'a', result: 'reported_paid', created_at: '2026-10-25T10:00:00Z' },
    { contract_id: 'b', result: 'help', created_at: '2026-10-24T09:00:00Z' },
  ];
  it('берёт самую свежую отметку по договору независимо от порядка', () => {
    expect(latestCallResults(logs)).toEqual({ a: 'reported_paid', b: 'help' });
    expect(latestCallResults([...logs].reverse())).toEqual({ a: 'reported_paid', b: 'help' });
  });
  it('фильтрует по выбранной отметке и по отсутствию отметок', () => {
    const latest = latestCallResults(logs);
    expect(matchesCallResultFilter('all', undefined)).toBe(true);
    expect(matchesCallResultFilter('reported_paid', latest.a)).toBe(true);
    expect(matchesCallResultFilter('no_answer', latest.a)).toBe(false);
    expect(matchesCallResultFilter('none', latest.c)).toBe(true);
    expect(matchesCallResultFilter('none', latest.b)).toBe(false);
  });
});
