// EXTERNAL BLACK-BOX UAT -- unauthenticated public perimeter.
//
// Drives a real Chromium browser against the PUBLIC deployed Proplyst app from the internet.
// The browser is the source of truth: every result below is what a real visitor's browser
// actually received, not what the source code says should happen.
//
// SCOPE AND SAFETY. This script is deliberately limited to the UNAUTHENTICATED perimeter:
//   - It performs NO writes. It never registers, never creates an organisation, never submits
//     any form that persists data.
//   - It issues read-only GETs plus exactly ONE deliberately-invalid login attempt, addressed to
//     a reserved `.invalid` domain (RFC 2606) that can never route mail to a real person.
//   - It refuses to run against localhost/127.0.0.1 -- the inverse of the local UAT scripts in
//     this directory, because this pass exists precisely to test the public deployment.
//
// WHAT IT CANNOT COVER: everything behind authentication. No UAT credentials exist, and a fresh
// public signup cannot reach property creation anyway (create_organization raises
// owner_subscription_required; new orgs carry commercial_setup_required = true, which
// create_property rejects until payment setup completes). See PUBLIC_UAT_REPORT.md.
//
// Usage (from apps/admin/):
//   node scripts/uat-public-blackbox.mjs
//   UAT_BASE_URL=https://proplyst.co.za node scripts/uat-public-blackbox.mjs

// The callbacks passed to page.evaluate() are serialised and executed inside the browser, not in
// Node, so browser globals are legitimate there even though this file itself runs under Node.
/* global document, getComputedStyle */

import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = (process.env.UAT_BASE_URL ?? 'https://proplyst.co.za').replace(/\/$/, '');
const SHOTS = process.env.UAT_SHOT_DIR ?? null;

if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(:|$)/i.test(BASE)) {
  console.error(`REFUSING TO RUN: ${BASE} is a local target. This pass must test the public deployment.`);
  process.exit(1);
}
if (!BASE.startsWith('https://')) {
  console.error(`REFUSING TO RUN: ${BASE} is not HTTPS. A public pass must exercise real TLS.`);
  process.exit(1);
}

const results = [];
let pass = 0;
let fail = 0;

function record(screen, control, action, expected, actual, ok, notes = '') {
  results.push({ screen, control, action, expected, actual, ok, notes });
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${screen} :: ${action}`);
  if (!ok) console.log(`        expected: ${expected}\n        actual:   ${actual}`);
}

// Routes a signed-in user would use. Unauthenticated, each MUST refuse -- redirect to an auth
// screen or return 401/403/404. What must NEVER happen is a 200 rendering real portfolio data.
const PROTECTED = [
  '/overview', '/dashboard', '/properties', '/tenants', '/leases', '/maintenance',
  '/documents', '/reports', '/settings', '/payments', '/expenses', '/utilities',
  '/budget', '/notifications', '/admin', '/organizations',
];

// Read-only API probes. A public API that answers an unauthenticated GET with tenant or
// portfolio data is the single most serious defect this pass could find.
const API = [
  '/api/v1/properties', '/api/v1/tenants', '/api/v1/leases', '/api/v1/organizations',
  '/api/v1/maintenance', '/api/v1/documents', '/api/v1/reports/portfolio',
  '/api/v1/expenses', '/api/v1/payments', '/api/v1/notifications',
];

const PUBLIC_PAGES = ['/', '/login', '/register', '/forgot-password'];

const VIEWPORTS = [
  { label: '1440x900 desktop', width: 1440, height: 900 },
  { label: '1280x800 laptop', width: 1280, height: 800 },
  { label: '1024x768 small laptop', width: 1024, height: 768 },
  { label: '768x1024 tablet', width: 768, height: 1024 },
];

// Console noise that is not an application defect.
const IGNORABLE = /favicon|third-party cookie|Download the React DevTools|sourcemap/i;

const run = async () => {
  console.log(`=== EXTERNAL BLACK-BOX UAT ===`);
  console.log(`TARGET (public):  ${BASE}`);
  console.log(`STARTED:          ${new Date().toISOString()}`);
  console.log(`MODE:             unauthenticated perimeter only, read-only\n`);

  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // ---- 1. Public pages load, and carry no console or network errors -------------------------
  console.log('--- 1. PUBLIC PAGES: load, console, network ---');
  for (const path of PUBLIC_PAGES) {
    const page = await context.newPage();
    const consoleErrors = [];
    const netFailures = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORABLE.test(m.text())) consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !IGNORABLE.test(r.url())) netFailures.push(`${r.status()} ${r.url()}`);
    });

    let status = 'no response';
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
      status = resp ? String(resp.status()) : 'no response';
    } catch (e) {
      status = `navigation error: ${e.message.split('\n')[0]}`;
    }

    record('Public', path, `GET ${path}`, '200 and the page renders',
      `HTTP ${status}`, status === '200');

    record('Public', path, `console errors on ${path}`, 'no console errors',
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'none',
      consoleErrors.length === 0);

    record('Public', path, `failed requests on ${path}`, 'no 4xx/5xx subresource requests',
      netFailures.length ? netFailures.slice(0, 3).join(' | ') : 'none',
      netFailures.length === 0);

    if (SHOTS && status === '200') {
      await page.screenshot({ path: `${SHOTS}/public${path.replace(/\//g, '_') || '_root'}.png`, fullPage: true });
    }
    await page.close();
  }

  // ---- 2. Unauthenticated access control on app routes --------------------------------------
  console.log('\n--- 2. UNAUTHENTICATED ACCESS CONTROL (app routes) ---');
  for (const path of PROTECTED) {
    const page = await context.newPage();
    let status = 0;
    let landed = '';
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      status = resp ? resp.status() : 0;
      landed = new URL(page.url()).pathname;
    } catch (e) {
      landed = `error: ${e.message.split('\n')[0]}`;
    }

    // Acceptable: bounced to an auth screen, or refused outright.
    const bounced = /login|signin|sign-in|auth|register/i.test(landed);
    const refused = status === 401 || status === 403 || status === 404;
    const ok = bounced || refused;

    record('Access control', path, `unauthenticated GET ${path}`,
      'redirect to auth, or 401/403/404 -- never portfolio data',
      `HTTP ${status}, landed on ${landed}`, ok,
      ok ? '' : 'POSSIBLE DATA EXPOSURE -- inspect manually');
    await page.close();
  }

  // ---- 3. Unauthenticated direct API access -------------------------------------------------
  console.log('\n--- 3. UNAUTHENTICATED DIRECT API ACCESS ---');
  for (const path of API) {
    const page = await context.newPage();
    let status = 0;
    let body = '';
    try {
      const resp = await page.request.get(`${BASE}${path}`, { failOnStatusCode: false, timeout: 45000 });
      status = resp.status();
      body = (await resp.text()).slice(0, 400);
    } catch (e) {
      body = `error: ${e.message.split('\n')[0]}`;
    }

    // 200 is only safe if the body carries no records. Anything with rows is a leak.
    const leaked = status === 200 && /"(id|org_id|tenant_id|nickname|address_line1|amount)"\s*:/.test(body);
    const ok = !leaked && (status === 401 || status === 403 || status === 404 || status === 405 || status === 400);

    record('API security', path, `unauthenticated GET ${path}`,
      '401/403/404 and no records in the body',
      `HTTP ${status}${leaked ? ' -- BODY CONTAINS RECORD FIELDS' : ''}`, ok,
      leaked ? 'CRITICAL: unauthenticated data exposure' : '');
    await page.close();
  }

  // ---- 4. Transport and security headers ----------------------------------------------------
  console.log('\n--- 4. TRANSPORT + SECURITY HEADERS ---');
  {
    const page = await context.newPage();
    const resp = await page.request.get(`${BASE}/login`, { failOnStatusCode: false });
    const h = resp.headers();
    const checks = [
      ['strict-transport-security', 'HSTS present', (v) => Boolean(v)],
      ['x-frame-options|content-security-policy', 'clickjacking defence present',
        () => Boolean(h['x-frame-options']) || /frame-ancestors/i.test(h['content-security-policy'] ?? '')],
      ['x-content-type-options', 'nosniff present', (v) => (v ?? '').toLowerCase() === 'nosniff'],
    ];
    for (const [key, label, test] of checks) {
      const value = h[key] ?? '';
      const ok = test(value);
      record('Security headers', key, label, label, ok ? (value || 'present') : 'absent', ok);
    }
    await page.close();
  }

  // ---- 5. Login rejects bad credentials without crashing ------------------------------------
  // Exactly one attempt, to a reserved .invalid domain that cannot reach a real mailbox.
  console.log('\n--- 5. LOGIN ERROR HANDLING (one invalid attempt) ---');
  {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORABLE.test(m.text())) consoleErrors.push(m.text());
    });
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
      const email = page.locator('input[type="email"], input[name="email"]').first();
      const pw = page.locator('input[type="password"]').first();
      const hasForm = (await email.count()) > 0 && (await pw.count()) > 0;

      record('Login', 'form', 'email + password fields present',
        'both fields render', hasForm ? 'both present' : 'missing', hasForm);

      if (hasForm) {
        await email.fill('uat-blackbox-nonexistent@example.invalid');
        await pw.fill('DeliberatelyWrong-NotARealPassword');
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(6000);

        const stillOnLogin = /login|signin|sign-in/i.test(new URL(page.url()).pathname);
        const bodyText = await page.locator('body').innerText();
        const showsError = /invalid|incorrect|not match|wrong|unable|failed|check your/i.test(bodyText);

        record('Login', 'submit', 'invalid credentials rejected',
          'stays on login and shows a readable error',
          `${stillOnLogin ? 'stayed on login' : `NAVIGATED to ${new URL(page.url()).pathname}`}; ${showsError ? 'error message shown' : 'NO visible error message'}`,
          stillOnLogin && showsError);

        // A 401 from the auth endpoint is the CORRECT response to bad credentials, and Chromium
        // logs a console error for any failed fetch. Only unexpected errors count here.
        const unexpected = consoleErrors.filter((t) => !/status of 401/.test(t));
        record('Login', 'submit', 'no unexpected console errors during failed login',
          'only the expected 401 from the auth endpoint',
          unexpected.length ? unexpected.slice(0, 3).join(' | ') : 'only the expected 401',
          unexpected.length === 0);

        if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-invalid.png`, fullPage: true });
      }
    } catch (e) {
      record('Login', 'form', 'invalid login attempt', 'graceful rejection',
        `error: ${e.message.split('\n')[0]}`, false);
    }
    await page.close();
  }

  // ---- 6. OAuth providers: physically exercised ----------------------------------------------
  // Presence proves nothing, so each button is actually clicked and the redirect chain followed.
  // This stops at the provider's consent screen -- it never authenticates and creates no account.
  // A provider that is offered but not configured in Supabase surfaces here as an error response,
  // which is a broken workflow on the first screen a pilot customer sees.
  console.log('\n--- 6. OAUTH BUTTONS (physically exercised) ---');
  for (const provider of ['Google', 'Apple']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const chain = [];
    page.on('response', (r) => {
      if (r.request().isNavigationRequest()) chain.push(`${r.status()} ${r.url().slice(0, 120)}`);
    });

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    const btn = page.getByRole('button', { name: new RegExp(provider, 'i') })
      .or(page.getByRole('link', { name: new RegExp(provider, 'i') })).first();

    if ((await btn.count()) === 0) {
      record('Login', `${provider} OAuth`, `${provider} sign-in offered`,
        'either absent, or present and functional', 'not offered', true,
        'Provider not offered -- nothing to exercise.');
      await ctx.close();
      continue;
    }

    let finalUrl = '';
    let visible = '';
    try {
      await btn.click();
      await page.waitForTimeout(8000);
      finalUrl = page.url();
      visible = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    } catch (e) {
      finalUrl = `click error: ${e.message.split('\n')[0]}`;
    }

    // Reaching the provider's own domain means the handshake was accepted. Staying on Proplyst,
    // or landing on a Supabase error, means the provider is offered but not actually usable.
    const reachedProvider = /accounts\.google\.com|appleid\.apple\.com/i.test(finalUrl);
    const providerError = /error|unsupported|not enabled|invalid|provider/i.test(visible) && !reachedProvider;
    const ok = reachedProvider;

    record('Login', `${provider} OAuth`, `click "Continue with ${provider}" and follow redirects`,
      `redirect reaches the ${provider} consent screen`,
      reachedProvider
        ? `reached ${new URL(finalUrl).hostname}`
        : `stopped at ${finalUrl.slice(0, 140)}${providerError ? ` -- page text: "${visible.slice(0, 120)}"` : ''}`,
      ok,
      ok
        ? 'Handshake accepted. Full sign-in NOT completed -- no account was authenticated.'
        : 'Button is offered but the flow does not reach the provider. BROKEN WORKFLOW on the public login page.');

    if (chain.length) console.log(`        chain: ${chain.slice(-3).join(' -> ')}`);
    await ctx.close();
  }

  // ---- 7. Responsive -------------------------------------------------------------------------
  console.log('\n--- 7. RESPONSIVE (no horizontal overflow) ---');
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const ok = overflow <= 2; // sub-pixel rounding tolerance
      record('Responsive', vp.label, `/login at ${vp.width}px`,
        'no horizontal page scroll',
        ok ? 'no overflow' : `overflows by ${overflow}px`, ok);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/responsive-${vp.width}.png`, fullPage: true });
    } catch (e) {
      record('Responsive', vp.label, `/login at ${vp.width}px`, 'renders',
        `error: ${e.message.split('\n')[0]}`, false);
    }
    await ctx.close();
  }

  // ---- 8. Light and dark mode ----------------------------------------------------------------
  // The app uses Tailwind `darkMode: 'class'` via next-themes with defaultTheme="light", so a
  // fresh visitor is intentionally served light EVEN IF their OS prefers dark (a recorded product
  // decision). Emulating prefers-color-scheme therefore tests the wrong mechanism; the real switch
  // is the persisted `theme` key that next-themes reads, which is what is exercised here.
  console.log('\n--- 8. LIGHT + DARK MODE (class-based, the mechanism actually used) ---');
  const themeBg = {};
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await page.reload({ waitUntil: 'networkidle', timeout: 45000 });

      const state = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color,
        hasDarkClass: document.documentElement.classList.contains('dark'),
      }));
      themeBg[theme] = state.bg;

      const classCorrect = theme === 'dark' ? state.hasDarkClass : !state.hasDarkClass;
      const opaque = state.bg !== 'rgba(0, 0, 0, 0)' && state.bg !== 'transparent';

      record('Theming', `${theme} mode`, `/login with theme=${theme}`,
        `html carries ${theme === 'dark' ? 'the .dark class' : 'no .dark class'}, body paints an opaque background`,
        `.dark=${state.hasDarkClass}, background ${state.bg}, text ${state.fg}`,
        classCorrect && opaque);

      if (SHOTS) await page.screenshot({ path: `${SHOTS}/theme-${theme}.png`, fullPage: true });
    } catch (e) {
      record('Theming', `${theme} mode`, `/login with theme=${theme}`, 'renders',
        `error: ${e.message.split('\n')[0]}`, false);
    }
    await ctx.close();
  }

  // The decisive check: the two themes must actually look different.
  record('Theming', 'light vs dark', 'dark mode visibly differs from light',
    'the two themes paint different backgrounds',
    `light ${themeBg.light ?? 'n/a'} vs dark ${themeBg.dark ?? 'n/a'}`,
    Boolean(themeBg.light && themeBg.dark && themeBg.light !== themeBg.dark));

  // A fresh visitor whose OS prefers dark must still get light -- the documented default.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    record('Theming', 'OS dark preference', 'first visit with OS set to dark',
      'served light -- defaultTheme="light" is a recorded product decision',
      hasDark ? 'served dark' : 'served light (matches documented default)', !hasDark);
    await ctx.close();
  }

  await browser.close();

  // ---- Summary --------------------------------------------------------------------------------
  console.log(`\n=== RESULT: ${pass}/${pass + fail} checks passed ===`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - [${r.screen}] ${r.action}`);
      console.log(`      expected: ${r.expected}`);
      console.log(`      actual:   ${r.actual}${r.notes ? `\n      note:     ${r.notes}` : ''}`);
    }
  }

  const out = process.env.UAT_JSON_OUT;
  if (out) {
    writeFileSync(out, JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, fail, results }, null, 2));
    console.log(`\nMatrix written to ${out}`);
  }

  process.exitCode = fail > 0 ? 1 : 0;
};

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
