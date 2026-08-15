import 'server-only';
import { branding } from '@propvault/config';
import { getAppUrl } from '../appUrl';

/**
 * V1 communications productionisation (WORKLOG.md this date): the ONE shared HTML email layout
 * every transactional template in this codebase renders through -- emailDispatch.ts's
 * TEMPLATE_HTML_CONTENT map supplies structured content (heading/paragraphs/CTA/info box), this
 * file is the only place that turns it into actual markup. No template builds its own HTML.
 *
 * Table-based, fully inline-styled layout -- not a stylistic preference, a hard compatibility
 * requirement: Outlook desktop renders HTML email with Word's engine (no flexbox/grid, unreliable
 * external/embedded <style> support), and Gmail strips <style> blocks in some contexts. Every
 * property that affects layout (padding, width, color, font) is inline; a small <style> block is
 * included only for a progressive-enhancement dark-mode media query that degrades harmlessly
 * where unsupported (Outlook, older clients) since every color is also set inline as the
 * light-mode baseline.
 *
 * Brand color (#106ADD) is the product's own real theme_color (apps/admin/app/manifest.ts) --
 * reused here, not invented, so the email and the app read as the same product.
 */

const BRAND_BLUE = '#106ADD';
const INK = '#0e1526';
const INK_SOFT = '#5a6178';
const BORDER = '#e3e6ee';
const PAGE_BG = '#f2f4f8';
const CARD_BG = '#ffffff';
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escapes text for safe insertion into HTML content (never trust org/property/tenant names --
 * they are user-entered data, not static copy). Every piece of dynamic text in an email template
 * must pass through this before reaching renderEmailLayout(). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a URL for safe insertion into an href attribute -- distinct from escapeHtml() because a
 * URL legitimately contains characters (e.g. `&` between query params) that are valid URL syntax
 * but must still be HTML-entity-escaped when placed inside an attribute. Rejects anything that
 * isn't genuinely http(s) -- an email template must never emit a `javascript:`/`data:` href. */
export function escapeUrlForHtmlAttribute(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  } catch {
    return '';
  }
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailInfoBox {
  label: string;
  text: string;
}

export interface EmailContent {
  /** Short, human label shown above the heading (e.g. "Tenant invitation", "Maintenance update") --
   * optional, omitted for templates where it would be redundant with the heading itself. */
  eyebrow?: string;
  heading: string;
  /** Lead paragraph, shown directly under the heading. */
  intro: string;
  /** Additional body paragraphs, rendered in order. */
  paragraphs?: string[];
  cta?: EmailCta;
  /** A highlighted callout box -- used for security notices ("didn't request this?") or a
   * concise structured fact (amount due, expiry date). */
  infoBox?: EmailInfoBox;
  /** Shown only when `cta` is present -- "if the button doesn't work" plain-URL fallback, per
   * this task's own requirement. Defaults to true whenever a CTA exists. */
  showFallbackUrl?: boolean;
}

function renderCtaButton(cta: EmailCta): string {
  const safeUrl = escapeUrlForHtmlAttribute(cta.url);
  if (!safeUrl) return '';
  const safeLabel = escapeHtml(cta.label);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius: 8px;">
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
             style="display: inline-block; padding: 14px 28px; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
            ${safeLabel}
          </a>
        </td>
      </tr>
    </table>`;
}

function renderInfoBox(box: EmailInfoBox): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0;">
      <tr>
        <td style="background-color: #f6f8fc; border: 1px solid ${BORDER}; border-radius: 8px; padding: 14px 16px;">
          <p style="margin: 0 0 4px; font-family: ${FONT_STACK}; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: ${INK_SOFT};">
            ${escapeHtml(box.label)}
          </p>
          <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.5; color: ${INK};">
            ${escapeHtml(box.text)}
          </p>
        </td>
      </tr>
    </table>`;
}

/**
 * Renders one template's structured content into a complete, standalone HTML email document.
 * Every dynamic string is escaped internally (callers pass raw values, not pre-escaped HTML) --
 * `heading`/`intro`/`paragraphs`/`infoBox` are always treated as plain text, never trusted markup.
 */
export function renderEmailLayout(content: EmailContent): string {
  const logoUrl = `${getAppUrl()}/icons/icon-192.png`;
  const year = new Date().getFullYear();

  const paragraphsHtml = (content.paragraphs ?? [])
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.6; color: ${INK};">${escapeHtml(p)}</p>`,
    )
    .join('\n');

  const ctaHtml = content.cta ? renderCtaButton(content.cta) : '';
  const infoBoxHtml = content.infoBox ? renderInfoBox(content.infoBox) : '';

  // Same validation as the button itself (escapeUrlForHtmlAttribute's http(s)-only check) -- a CTA
  // whose url was rejected must not still surface as a "copy and paste this link" fallback; that
  // would be an inconsistent, confusing surface for a link that was never rendered as clickable in
  // the first place, even though the plain-text rendering itself carries no injection risk.
  const safeCtaUrl = content.cta ? escapeUrlForHtmlAttribute(content.cta.url) : '';
  const showFallback = Boolean(safeCtaUrl) && (content.showFallbackUrl ?? true);
  const fallbackHtml = showFallback
    ? `<p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 12px; line-height: 1.6; color: ${INK_SOFT};">
           If the button above doesn't work, copy and paste this link into your browser:<br />
           <span style="word-break: break-all; color: ${BRAND_BLUE};">${safeCtaUrl}</span>
         </p>`
    : '';

  const eyebrowHtml = content.eyebrow
    ? `<p style="margin: 0 0 8px; font-family: ${FONT_STACK}; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${BRAND_BLUE};">${escapeHtml(content.eyebrow)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PAGE_BG}; -webkit-text-size-adjust: 100%;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(content.intro)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${PAGE_BG};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 8px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 8px;">
                    <img src="${logoUrl}" width="28" height="28" alt="" style="display: block; border-radius: 6px;" />
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-family: ${FONT_STACK}; font-size: 16px; font-weight: 700; color: ${INK};">${escapeHtml(branding.productName)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${CARD_BG}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 32px;">
              ${eyebrowHtml}
              <h1 style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 22px; line-height: 1.3; font-weight: 700; color: ${INK};">${escapeHtml(content.heading)}</h1>
              <p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.6; color: ${INK};">${escapeHtml(content.intro)}</p>
              ${paragraphsHtml}
              ${infoBoxHtml}
              ${ctaHtml}
              ${fallbackHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 8px 0;">
              <p style="margin: 0 0 4px; font-family: ${FONT_STACK}; font-size: 12px; line-height: 1.6; color: ${INK_SOFT};">
                ${escapeHtml(branding.productName)} &mdash; ${escapeHtml(branding.tagline)}
              </p>
              <p style="margin: 0 0 4px; font-family: ${FONT_STACK}; font-size: 12px; line-height: 1.6; color: ${INK_SOFT};">
                A GenBridge product. &copy; ${year} GenBridge. All rights reserved.
              </p>
              <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 12px; line-height: 1.6; color: ${INK_SOFT};">
                This is an automated message from ${escapeHtml(branding.productName)}. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
