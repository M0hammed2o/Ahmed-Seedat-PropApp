import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Static regression guards for cross-organisation Storage access (2026-09-14). The confirmed
// exploit: a row in organisation A named organisation B's object, and the app signed that path.
// These guards keep every read of a stored path behind the one canonical ownership check:
//  1. nothing outside lib/protectedStorage.ts signs, downloads, lists or publicly addresses Storage
//     objects -- no raw `.storage.from(...).createSignedUrl(row.storage_path)` can creep back in;
//  2. every call to createProtectedSignedUrl()/downloadProtectedObject() names the organisation the
//     path must belong to;
//  3. lib/protectedStorage.ts has exactly one ownership implementation, used by every entry point;
//  4. the database enforcement migration exists and nothing later drops or weakens it.

const ADMIN_ROOT = join(__dirname, '..');
const REPO_ROOT = join(ADMIN_ROOT, '..', '..');

function collectFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, pattern));
    } else if (
      pattern.test(entry) &&
      !entry.includes('.test.') &&
      !full.includes(`${sep}__tests__${sep}`)
    ) {
      files.push(full);
    }
  }
  return files;
}

const source = [
  ...collectFiles(join(ADMIN_ROOT, 'app'), /\.(ts|tsx)$/),
  ...collectFiles(join(ADMIN_ROOT, 'lib'), /\.(ts|tsx)$/),
  ...collectFiles(join(ADMIN_ROOT, 'components'), /\.(ts|tsx)$/),
].map((file) => ({
  name: relative(ADMIN_ROOT, file).split(sep).join('/'),
  // Comments and string literals may mention the method names; only code counts.
  code: readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""'),
  raw: readFileSync(file, 'utf-8'),
}));

describe('every read of a stored path goes through the ownership check', () => {
  it('found the source to check', () => {
    expect(source.length).toBeGreaterThan(200);
  });

  it('nothing outside lib/protectedStorage.ts signs, downloads, lists or publicly addresses a Storage object', () => {
    const RAW_STORAGE_READ = /\.(createSignedUrls?|download|getPublicUrl|list|info|exists)\s*\(/;
    const offenders = source
      .filter((file) => file.name !== 'lib/protectedStorage.ts')
      .filter(
        (file) =>
          RAW_STORAGE_READ.test(file.code) && /\.storage\b|storage\s*\.\s*from/.test(file.code),
      )
      .map((file) => file.name);
    expect(offenders).toEqual([]);

    const directCalls = source
      .filter((file) => file.name !== 'lib/protectedStorage.ts')
      .filter((file) => /\.createSignedUrls?\s*\(|\.download\s*\(/.test(file.code))
      .map((file) => file.name);
    expect(directCalls).toEqual([]);
  });

  it('every protected signed URL or download names the organisation the path must belong to', () => {
    const callSites = source.flatMap((file) =>
      [
        ...file.raw.matchAll(
          /await\s+(createProtectedSignedUrl|downloadProtectedObject)\(([\s\S]*?)\}\);/g,
        ),
      ].map((match) => ({ file: file.name, call: match[0] })),
    );
    // 14 read sites in routes, pages and lib, plus requireCleanScanBeforeProcessing()'s own download.
    expect(callSites.length).toBeGreaterThanOrEqual(15);
    for (const { file, call } of callSites) {
      expect(call, `${file}: ${call.slice(0, 120)}`).toMatch(/orgId\b/);
      expect(call, `${file}: ${call.slice(0, 120)}`).toMatch(/storagePath\b/);
    }
  });

  it('lib/protectedStorage.ts has one ownership rule and every entry point uses it', () => {
    const protectedStorage = readFileSync(join(ADMIN_ROOT, 'lib', 'protectedStorage.ts'), 'utf-8');
    expect(protectedStorage).not.toMatch(/startsWith\(`\$\{/);
    expect(protectedStorage).not.toMatch(/orgPrefixMatches/);
    for (const entry of [
      'export async function storeScannedUpload',
      'export async function storeServerGeneratedObject',
      'export async function createProtectedSignedUrl',
      'export async function downloadProtectedObject',
      'export async function requireCleanScanBeforeProcessing',
    ]) {
      const start = protectedStorage.indexOf(entry);
      expect(start, entry).toBeGreaterThan(-1);
      const body = protectedStorage.slice(start, protectedStorage.indexOf('\n}\n', start));
      expect(body, `${entry} must check path ownership`).toMatch(
        /isStoragePathInOrg\(|downloadProtectedObject\(/,
      );
    }
  });
});

describe('database enforcement stays in place', () => {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  const MIGRATION = '20260101000172_storage_path_org_ownership.sql';

  it('migration 172 adds the rule, the three constraints and the property photo trigger', () => {
    expect(readdirSync(dir)).toContain(MIGRATION);
    const sql = readFileSync(join(dir, MIGRATION), 'utf-8');
    for (const expected of [
      'create or replace function public.storage_path_in_org(p_org_id uuid, p_path text)',
      'documents_storage_path_in_org_folder',
      'lease_documents_storage_path_in_org_folder',
      'lease_templates_storage_path_in_org_folder',
      'create trigger property_photos_storage_paths_in_org',
    ]) {
      expect(sql).toContain(expected);
    }
  });

  it('no later migration drops the constraints, the trigger or the rule', () => {
    const later = readdirSync(dir)
      .filter((file) => file.endsWith('.sql') && file > MIGRATION)
      .sort();
    for (const file of later) {
      const sql = readFileSync(join(dir, file), 'utf-8').replace(/--.*$/gm, '');
      expect(sql, file).not.toMatch(
        /drop\s+constraint\s+(if\s+exists\s+)?\w*storage_path_in_org_folder/i,
      );
      expect(sql, file).not.toMatch(
        /drop\s+trigger\s+(if\s+exists\s+)?property_photos_storage_paths_in_org/i,
      );
      expect(sql, file).not.toMatch(
        /drop\s+function\s+(if\s+exists\s+)?public\.storage_path_in_org/i,
      );
      expect(sql, file).not.toMatch(
        /create\s+or\s+replace\s+function\s+public\.storage_path_in_org/i,
      );
    }
  });
});
