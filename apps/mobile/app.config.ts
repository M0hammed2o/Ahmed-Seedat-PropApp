import type { ExpoConfig } from 'expo/config';

// Centralised branding (packages/config) drives name/identifiers here so a rebrand never means
// hand-editing this file's literals — see DECISIONS.md and packages/config/src/branding.ts.
const branding = {
  productName: 'PropVault',
  iosBundleIdentifier: 'com.propvault.app',
  androidPackageName: 'com.propvault.app',
};

const config: ExpoConfig = {
  name: branding.productName,
  slug: 'propvault',
  scheme: 'propvault',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // No icon/splash/adaptiveIcon image assets exist yet (no final branding artwork has been
  // provided) — intentionally omitted rather than pointing at files that don't exist.
  // Add ./assets/icon.png, ./assets/splash.png, ./assets/adaptive-icon.png and these fields
  // once real artwork lands (see TODO.md).
  ios: {
    supportsTablet: false,
    bundleIdentifier: branding.iosBundleIdentifier,
    infoPlist: {
      NSFaceIDUsageDescription:
        'PropVault uses Face ID to unlock the app quickly — this only protects local access to your already-signed-in session, it does not verify your identity to PropVault.',
    },
  },
  android: {
    package: branding.androidPackageName,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'PropVault uses Face ID to unlock the app quickly for local access protection.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
  },
};

export default config;
