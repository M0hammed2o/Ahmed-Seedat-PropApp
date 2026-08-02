import { describe, expect, it } from 'vitest';
import type { OrganizationMemberRole } from '@propvault/types';
import { canPostAccountingRecords, canWriteOrgRecords } from '../orgSession';

const ALL_ROLES: OrganizationMemberRole[] = ['viewer', 'accountant', 'agent', 'manager', 'principal'];

describe('canWriteOrgRecords', () => {
  it('allows agent, manager, and principal', () => {
    expect(canWriteOrgRecords('agent')).toBe(true);
    expect(canWriteOrgRecords('manager')).toBe(true);
    expect(canWriteOrgRecords('principal')).toBe(true);
  });

  it('denies viewer and accountant', () => {
    expect(canWriteOrgRecords('viewer')).toBe(false);
    expect(canWriteOrgRecords('accountant')).toBe(false);
  });
});

describe('canPostAccountingRecords', () => {
  it('allows accountant, manager, and principal', () => {
    expect(canPostAccountingRecords('accountant')).toBe(true);
    expect(canPostAccountingRecords('manager')).toBe(true);
    expect(canPostAccountingRecords('principal')).toBe(true);
  });

  it('denies viewer and agent', () => {
    expect(canPostAccountingRecords('viewer')).toBe(false);
    expect(canPostAccountingRecords('agent')).toBe(false);
  });

  it('and canWriteOrgRecords are deliberately non-overlapping on agent/accountant (siblings, not a linear rank)', () => {
    const writeOnly = ALL_ROLES.filter((r) => canWriteOrgRecords(r) && !canPostAccountingRecords(r));
    const postOnly = ALL_ROLES.filter((r) => canPostAccountingRecords(r) && !canWriteOrgRecords(r));
    expect(writeOnly).toEqual(['agent']);
    expect(postOnly).toEqual(['accountant']);
  });
});
