import { describe, expect, it } from 'vitest';
import { isRoleAtLeast } from '../roleRank';

describe('isRoleAtLeast', () => {
  it('allows a super_admin to satisfy any minimum role', () => {
    expect(isRoleAtLeast('super_admin', 'read_only_admin')).toBe(true);
    expect(isRoleAtLeast('super_admin', 'operations_admin')).toBe(true);
    expect(isRoleAtLeast('super_admin', 'super_admin')).toBe(true);
  });

  it('denies a read_only_admin any mutating role requirement', () => {
    expect(isRoleAtLeast('read_only_admin', 'support_admin')).toBe(false);
    expect(isRoleAtLeast('read_only_admin', 'operations_admin')).toBe(false);
    expect(isRoleAtLeast('read_only_admin', 'super_admin')).toBe(false);
  });

  it('allows a role to satisfy its own exact requirement', () => {
    expect(isRoleAtLeast('support_admin', 'support_admin')).toBe(true);
  });

  it('denies a lower role from satisfying a higher one', () => {
    expect(isRoleAtLeast('support_admin', 'operations_admin')).toBe(false);
  });
});
