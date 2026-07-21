import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema, resetPasswordSchema } from '../auth';

describe('registerSchema', () => {
  const valid = {
    email: 'test@example.com',
    password: 'longenoughpassword',
    confirmPassword: 'longenoughpassword',
    acceptedTermsVersion: '2026-07-21',
    acceptedPrivacyVersion: '2026-07-21',
  };

  it('accepts a valid registration payload', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'different' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a too-short password', () => {
    const result = registerSchema.safeParse({
      ...valid,
      password: 'short',
      confirmPassword: 'short',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('rejects mismatched new passwords', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'longenoughpassword',
      confirmPassword: 'nope',
    });
    expect(result.success).toBe(false);
  });
});
