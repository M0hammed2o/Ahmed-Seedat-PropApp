import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Super Admin separation (WORKLOG.md this date), item 1 + 12's "customer navigation contains no
// admin link": a static, dependency-free regression guard -- confirmed by a real grep this date
// that zero such links exist anywhere in customer-facing code (app/(dashboard), app/(owner),
// app/(tenant), the public landing page, and every shared component) -- this test exists so a
// FUTURE accidental link (e.g. someone copy-pasting a nav item) fails CI immediately rather than
// silently reintroducing the exact gap this pass closed.

const ROOT = join(__dirname, '..');
const CUSTOMER_FACING_DIRS = [
  'app/(dashboard)',
  'app/(owner)',
  'app/(tenant)',
  'components/marketing',
  'components/shell',
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) {
      files.push(full);
    }
  }
  return files;
}

describe('customer-facing code contains no Super Admin link', () => {
  it('has zero references to /platform-admin outside the (super-admin) route group itself', () => {
    const offenders: string[] = [];
    for (const dir of CUSTOMER_FACING_DIRS) {
      for (const file of collectSourceFiles(join(ROOT, dir))) {
        const content = readFileSync(file, 'utf-8');
        if (content.includes('/platform-admin')) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
