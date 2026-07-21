/**
 * Single source of truth for the product's replaceable identity. Nothing in mobile/admin
 * business logic should hardcode "PropVault", a colour hex, or a bundle identifier directly —
 * import from here so a rebrand is a config edit, not a code rewrite.
 */
export const branding = {
  productName: 'PropVault',
  tagline: 'Your property documents, always in order.',
  iosBundleIdentifier: 'com.propvault.app', // TO_BE_CONFIRMED before store submission
  androidPackageName: 'com.propvault.app', // TO_BE_CONFIRMED before store submission
  supportEmail: 'support@propvault.example', // TO_BE_CONFIRMED
  websiteUrl: 'https://propvault.example', // TO_BE_CONFIRMED
} as const;

export type Branding = typeof branding;
