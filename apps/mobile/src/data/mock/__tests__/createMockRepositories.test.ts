import { createMockRepositories } from '../createMockRepositories';

describe('mobile repository mocks', () => {
  it('supports the independent dashboard, property and onboarding flows', async () => {
    const repositories = createMockRepositories({ latencyMs: 0 });
    expect((await repositories.dashboard.getSnapshot()).metrics.length).toBeGreaterThan(0);
    expect((await repositories.properties.list())[0]?.city).toBe('Umhlanga');
    const result = await repositories.auth.signUp('new@proplyst.co.za', 'Secure-pass-123');
    expect(result.status).toBe('confirmation_sent');
    await repositories.auth.completeEmailConfirmation();
    const profile = await repositories.profiles.completeProfile({ firstName: 'Naledi', lastName: 'Molefe', displayName: 'Naledi Molefe', country: 'ZA', callingCode: '+27', mobileNumber: '821234567', phoneE164: '+27821234567' });
    expect(profile.profileComplete).toBe(true);
  });

  it('models login UI result states without a backend', async () => {
    const repositories = createMockRepositories({ latencyMs: 0 });
    await expect(repositories.auth.signIn('user@example.co.za', 'wrong-password')).resolves.toMatchObject({ status: 'error', code: 'invalid_credentials' });
    await expect(repositories.auth.signIn('unconfirmed@example.co.za', 'anything')).resolves.toMatchObject({ status: 'email_unconfirmed' });
    await expect(repositories.auth.signIn('mfa@example.co.za', 'anything')).resolves.toMatchObject({ status: 'mfa_required' });
    await expect(repositories.auth.signInWithProvider('apple')).resolves.toMatchObject({ status: 'error', code: 'provider_disabled' });
  });

  it('provides deterministic empty and error states', async () => {
    const empty = createMockRepositories({ latencyMs: 0, emptyCollections: ['properties'] });
    await expect(empty.properties.list()).resolves.toEqual([]);
    const failed = createMockRepositories({ latencyMs: 0, failMethods: ['dashboard.getSnapshot'] });
    await expect(failed.dashboard.getSnapshot()).rejects.toThrow('Check your connection');
  });
});
