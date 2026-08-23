import { z } from 'zod';

// Deliberately generic: don't leak "which rule failed" beyond what's useful for a real user
// (e.g. we do enforce a minimum length, but we don't need a maximal complexity regex zoo).
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password is too long');

export const registerSchema = z
  .object({
    email: z.string().email('Enter a valid email address'),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptedTermsVersion: z.string().min(1, 'You must accept the Terms to continue'),
    acceptedPrivacyVersion: z.string().min(1, 'You must accept the Privacy Policy to continue'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Provisioned-staff account model (this date): POST /api/v1/staff/activate. tokenHash is optional
// -- present on the first submission (consumed via verifyOtp server-side), omitted on a retry once
// a session already exists (see that route's own comment for why retrying with an already-consumed
// token would otherwise fail).
export const staffActivateSchema = z
  .object({
    tokenHash: z.string().min(1).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type StaffActivateInput = z.infer<typeof staffActivateSchema>;

// PATCH /api/v1/profile (PWA_V1_COMPLETION_PLAN.md #7) -- public.profiles.display_name only.
// Email/password changes go straight through Supabase Auth client-side (supabase.auth.updateUser),
// same as ResetPasswordForm.tsx -- there is no separate app-level "email"/"password" column to
// validate against here.
export const updateProfileSchema = z.object({
  displayName: z.string().min(1, 'Enter a display name').max(200),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// POST /api/v1/profile/complete -- the "Complete Your Account" step. `phone` is validated as
// non-empty here only (a plausible-looking string) -- the server independently normalizes and
// re-validates it against a canonical E.164 format (`lib/phone.ts`), since a client-side format
// check is never authoritative on its own.
export const completeProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(100),
  lastName: z.string().trim().min(1, 'Enter your last name').max(100),
  phone: z.string().trim().min(1, 'Enter your phone number').max(32),
});
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
