// Shared browser helpers for the public UAT pass. The PUBLIC deployment is the source of truth --
// every helper here drives https://proplyst.co.za through a real Chromium, never a local server.
//
// Passwords are read from the scratchpad credential file and typed into password fields only.
// They are never printed, never written into a screenshot caption, and never logged.



import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

export const BASE = (process.env.UAT_BASE_URL ?? 'https://proplyst.co.za').replace(/\/$/, '');

if (/localhost|127\.0\.0\.1/i.test(BASE)) {
  console.error('REFUSING: the acceptance test must run against the public deployment.');
  process.exit(1);
}

export function creds() {
  const file = process.env.UAT_CRED_FILE;
  if (!file) throw new Error('UAT_CRED_FILE not set');
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const SHOTS = process.env.UAT_SHOT_DIR ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Console + network error collection, shared by every page we open.
export function watch(page, sink) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|third-party cookie|DevTools|sourcemap/i.test(m.text())) {
      sink.console.push(m.text().slice(0, 200));
    }
  });
  page.on('pageerror', (e) => sink.jsErrors.push(String(e).slice(0, 200)));
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 500) sink.s5xx.push(`${s} ${r.url().slice(0, 140)}`);
    else if (s >= 400 && !/favicon/i.test(r.url())) sink.s4xx.push(`${s} ${r.url().slice(0, 140)}`);
  });
}

export function newSink() {
  return { console: [], jsErrors: [], s4xx: [], s5xx: [] };
}

export async function launch() {
  return chromium.launch();
}

/** Sign in to the PUBLIC app as one persona. Returns { ctx, page, sink }. */
export async function signIn(browser, role, { viewport = { width: 1440, height: 900 } } = {}) {
  const c = creds();
  const persona = c[role];
  if (!persona?.email || !persona?.password) throw new Error(`No credentials for persona "${role}"`);

  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const sink = newSink();
  watch(page, sink);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('input[type="email"], input[name="email"]').first().fill(persona.email);
  await page.locator('input[type="password"]').first().fill(persona.password);
  await page.locator('button[type="submit"]').first().click();

  // Sign-in latency on the public deployment varies (observed 7-12s), so wait on the URL actually
  // leaving /login rather than a fixed delay -- a fixed wait produced a false "login failed".
  await page.waitForURL((u) => !/\/login(\?|$)/.test(new URL(u).pathname + new URL(u).search), {
    timeout: 90000,
  }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // Post-login the app lands on "/", which renders blank for a signed-in account (see
  // PUBLIC_UAT_REPORT.md -- recorded as a defect). Driving to /dashboard is what triggers the real
  // first-run gate chain, so do that explicitly rather than trusting the post-login destination.
  const landedAfterLogin = path(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await completeFirstRun(page, role);

  return { ctx, page, sink, email: persona.email, landedAfterLogin };
}

/**
 * Walk the genuine first-run gates a real new account hits: legal consent, then profile
 * completion. Both are real product screens, not test scaffolding -- a real customer sees them
 * too. Returns the list of gates actually encountered.
 */
export async function completeFirstRun(page, role = 'owner') {
  const seen = [];
  const NAMES = {
    owner: ['UAT', 'Owner', 'UAT Owner'],
    staff: ['UAT', 'Manager', 'UAT Property Manager'],
    tenant: ['UAT', 'Tenant', 'UAT Tenant'],
  };
  const [first, last, display] = NAMES[role] ?? NAMES.owner;

  for (let i = 0; i < 6; i += 1) {
    const p = path(page);

    if (p === '/legal-consent') {
      seen.push(p);
      // The submit button starts genuinely disabled until the box is ticked -- Playwright's click
      // auto-waits for enabled, so tick first and never swallow the click error.
      for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check();
      await page.getByRole('button', { name: /agree and continue/i }).first().click();
    } else if (p === '/complete-account') {
      seen.push(p);
      // Fields carry no name attributes, so address them by their visible labels.
      const byLabel = [
        [/first name/i, first],
        [/last name/i, last],
        [/display name/i, display],
        [/phone/i, '0110000001'],
      ];
      for (const [label, val] of byLabel) {
        const f = page.getByLabel(label).first();
        if (await f.count()) await f.fill(val).catch(() => {});
      }
      await page.getByRole('button', { name: /continue|save|finish/i }).first().click();
    } else {
      break;
    }

    await waitForNavigationAway(page, page.url());
  }
  return seen;
}

/**
 * Wait until the page navigates away from `fromUrl`.
 *
 * Playwright hands the waitForURL predicate a URL OBJECT, not a string -- so the obvious
 * `(u) => u !== previousUrlString` is always true and resolves instantly, making a navigation look
 * like it never happened. This cost a false "create property failed" result; always stringify.
 */
export async function waitForNavigationAway(page, fromUrl, timeout = 60000) {
  await page
    .waitForURL((u) => u.toString() !== fromUrl, { timeout })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  return path(page);
}

export function path(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}

export async function shot(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}

/** Text of the page body, whitespace-collapsed, for assertions. */
export async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
}
