import type { ExpoConfig } from 'expo/config';

// Centralised branding (packages/config) drives name/identifiers here so a rebrand never means
// hand-editing this file's literals — see DECISIONS.md and packages/config/src/branding.ts.
const branding = {
  productName: 'Proplyst',
  iosBundleIdentifier: 'za.co.proplyst.app',
  androidPackageName: 'za.co.proplyst.app',
};

const config: ExpoConfig = {
  name: branding.productName,
  slug: 'proplyst',
  scheme: 'proplyst',
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
        'Proplyst uses Face ID to unlock the app quickly. This protects local access to your signed-in session and does not verify your identity.',
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
          'Proplyst uses Face ID to unlock the app quickly for local access protection.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Proplyst to choose property photos and document images from your photo library.',
        cameraPermission:
          'Allow Proplyst to use the camera to capture property photos and documents.',
        microphonePermission: false,
      },
    ],
    'expo-notifications',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
  },
};

export default config;
