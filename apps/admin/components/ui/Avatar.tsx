// Adapted from reference/lovable-ui-reference's kit.tsx `Avatar` (UI_INTEGRATION_PLAN.md) --
// initials-only, no photo upload/storage in PropertyVault today, so this never references an
// external image URL.

export function Avatar({
  initials,
  className = '',
  tone = 'primary',
}: {
  initials: string;
  className?: string;
  tone?: 'primary' | 'muted';
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent'
      : 'bg-light-surfaceStrong text-light-textMuted dark:bg-dark-surfaceStrong dark:text-dark-textMuted';

  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${toneClass} ${className}`}
    >
      {initials}
    </span>
  );
}
