import { describe, it, expect } from 'vitest';
import { accessFor } from './access';
describe('access fails closed', () => {
  it('never grants access for missing, inactive or unknown roles', () => {
    for (const p of [null, {}, {role:'admin'}, {role:'admin',active:false}, {role:'owner',active:true}]) expect(accessFor(p)).toBe('blocked');
  });
  it('recognizes only active server-provided roles', () => {
    expect(accessFor({role:'admin',active:true})).toBe('admin');
    expect(accessFor({role:'operator',active:true})).toBe('operator');
  });
});
