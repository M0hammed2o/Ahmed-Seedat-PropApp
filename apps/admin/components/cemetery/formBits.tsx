'use client';

import type { ReactNode } from 'react';

// Shared form pieces for the cemetery screens -- same DESIGN_SYSTEM.md "Forms" conventions as OwnerForm.tsx.

export const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70';

export function Field({
  label,
  error,
  hint,
  children,
  className = '',
}: {
  label: string;
  error?: string[];
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className}`}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && !error?.length ? (
        <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
      {error?.length ? (
        <span className="mt-1 block text-xs text-destructive">{error[0]}</span>
      ) : null}
    </label>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </p>
  );
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string | null;
  fieldErrors: Record<string, string[]>;
}

/** JSON request with the /api/v1 error envelope unpacked. */
export async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        message: json.error?.message ?? 'Something went wrong. Please try again.',
        fieldErrors: json.error?.field_errors ?? {},
      };
    }
    return { ok: true, status: response.status, data: json as T, message: null, fieldErrors: {} };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      message: 'Could not reach the server — check your connection and try again.',
      fieldErrors: {},
    };
  }
}

export function todayIso(): string {
  const now = new Date();
  // South African business date (SAST, UTC+2) so an evening entry is not dated tomorrow/yesterday.
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

export function parseAmount(value: string): number {
  const cleaned = value.replace(/[\s,R]/gi, '');
  return cleaned === '' ? NaN : Number(cleaned);
}
