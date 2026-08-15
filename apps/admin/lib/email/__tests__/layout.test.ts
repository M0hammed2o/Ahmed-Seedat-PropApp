import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeUrlForHtmlAttribute, renderEmailLayout } from '../layout';

// V1 communications productionisation (WORKLOG.md this date). Pure unit tests -- no DB, no
// provider -- for the one shared HTML email design system every real template renders through
// (emailDispatch.ts's TEMPLATE_HTML_CONTENT). The highest-value coverage here is injection safety:
// every dynamic string in a real email (org name, tenant name, property address, ...) is
// user-entered data, never static copy.

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;',
    );
  });

  it('coerces null/undefined to an empty string rather than the literal text "null"/"undefined"', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces a non-string value (e.g. a number) via String() before escaping', () => {
    expect(escapeHtml(1250.5)).toBe('1250.5');
  });
});

describe('escapeUrlForHtmlAttribute', () => {
  it('passes through a well-formed https URL, HTML-entity-escaping any query-string ampersands', () => {
    expect(escapeUrlForHtmlAttribute('https://proplyst.co.za/activate?token=abc&ref=1')).toBe(
      'https://proplyst.co.za/activate?token=abc&amp;ref=1',
    );
  });

  it('rejects a javascript: URI -- returns empty string rather than emitting it', () => {
    expect(escapeUrlForHtmlAttribute("javascript:alert('xss')")).toBe('');
  });

  it('rejects a data: URI', () => {
    expect(escapeUrlForHtmlAttribute('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(escapeUrlForHtmlAttribute('not a url')).toBe('');
  });
});

describe('renderEmailLayout', () => {
  it('escapes an HTML-injection attempt in heading/intro/paragraphs so it never appears as live markup', () => {
    const html = renderEmailLayout({
      heading: '<img src=x onerror=alert(1)>',
      intro: 'Hi <b>there</b>',
      paragraphs: ['<script>document.location="https://evil.example"</script>'],
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<b>there</b>');
    expect(html).not.toContain('<script>document.location');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain(
      '&lt;script&gt;document.location=&quot;https://evil.example&quot;&lt;/script&gt;',
    );
  });

  it('escapes a malicious CTA label and drops a non-http(s) CTA url entirely, including from the plain-URL fallback', () => {
    const html = renderEmailLayout({
      heading: 'Test',
      intro: 'Test',
      cta: { label: '<script>alert(1)</script>', url: 'javascript:alert(1)' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('javascript:alert(1)');
    // No href was emitted at all for the rejected URL -- renderCtaButton returns '' when the CTA
    // url fails escapeUrlForHtmlAttribute's protocol check.
    expect(html).not.toContain('<a href=');
    // Nor does the "if the button doesn't work" fallback text show the rejected url as a link to
    // copy/paste -- a real defect found and fixed by this test: the fallback previously used
    // escapeHtml (text-safe) rather than escapeUrlForHtmlAttribute (protocol-validated), so a
    // rejected CTA url still leaked into the fallback line even though the button correctly
    // disappeared.
    expect(html).not.toContain("If the button above doesn't work");
  });

  it('renders a real, well-formed CTA with an escaped href and a plain-URL fallback', () => {
    const html = renderEmailLayout({
      heading: 'Activate your account',
      intro: 'Welcome',
      cta: { label: 'Activate', url: 'https://proplyst.co.za/activate?token=abc&x=1' },
    });
    expect(html).toContain('href="https://proplyst.co.za/activate?token=abc&amp;x=1"');
    expect(html).toContain('<a href="https://proplyst.co.za/activate?token=abc&amp;x=1"');
    expect(html).toContain('Activate');
    // The plain-URL fallback text (Part 2's own requirement) is present and also escaped.
    expect(html).toContain('https://proplyst.co.za/activate?token=abc&amp;x=1');
    expect(html).toContain("If the button above doesn't work");
  });

  it('omits the fallback URL block when showFallbackUrl is explicitly false', () => {
    const html = renderEmailLayout({
      heading: 'Test',
      intro: 'Test',
      cta: { label: 'Go', url: 'https://proplyst.co.za/x' },
      showFallbackUrl: false,
    });
    expect(html).not.toContain("If the button above doesn't work");
  });

  it('renders the infoBox label and text, escaped', () => {
    const html = renderEmailLayout({
      heading: 'Test',
      intro: 'Test',
      infoBox: { label: 'Amount due', text: 'R1,250.00 <b>now</b>' },
    });
    expect(html).toContain('Amount due');
    expect(html).toContain('R1,250.00 &lt;b&gt;now&lt;/b&gt;');
  });

  it('always includes the GenBridge ownership line and never a support email address', () => {
    const html = renderEmailLayout({ heading: 'Test', intro: 'Test' });
    expect(html).toContain('A GenBridge product');
    expect(html).not.toContain('support@');
  });

  it('produces a complete, well-formed HTML document', () => {
    const html = renderEmailLayout({ heading: 'Test heading', intro: 'Test intro' });
    expect(html.trim().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('Test heading');
    expect(html).toContain('Test intro');
  });
});
