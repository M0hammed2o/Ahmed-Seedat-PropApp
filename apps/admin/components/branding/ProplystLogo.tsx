import Image from 'next/image';
import proplystLogo from '../../branding/proplyst-logo.png';

/**
 * Production signup/onboarding branding pass (WORKLOG.md this date). The real Proplyst logo
 * asset already shipped in the repo (`branding/proplyst-logo.png`, used by `make-icons.mjs` for
 * every PWA/favicon icon) but no admin auth/onboarding screen actually rendered it -- every one
 * used a generic lucide `Building2` icon in a placeholder badge instead. This is the first admin
 * component to use the real asset directly (mobile already has its own equivalent,
 * `apps/mobile/src/design/components/ProplystLogo.tsx`, reaching across the app boundary to the
 * same file).
 *
 * The source image is wide (555x319, ~1.74:1) -- rendered at its natural aspect ratio rather than
 * force-fit into the old 44x44 square icon-badge slot the placeholder used. `width`/`height` are
 * passed explicitly (not left to static-import inference) -- found live writing this component's
 * own test coverage: Vitest's asset handling doesn't produce the {width, height} metadata
 * object Next's real webpack/Turbopack loader does for a static image import, so relying on
 * inference alone throws "missing required width property" in every component test that renders
 * this. Explicit dimensions work identically in both a real build and jsdom.
 */
export function ProplystLogo({ className }: { className?: string }) {
  return (
    <Image
      src={proplystLogo}
      alt="Proplyst"
      width={555}
      height={319}
      priority
      className={className ?? 'h-10 w-auto'}
    />
  );
}
