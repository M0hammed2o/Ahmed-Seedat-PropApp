import Foundation

/// `NATIVE_IOS_SPEC.md` §15: the target shape for a future generated `Tokens.swift` (a build-time
/// JSON export of `packages/ui/src/tokens.ts`, "a small script, not yet written"). This file is
/// the STRUCTURE only -- the actual colour/spacing/type-scale/motion VALUES are deliberately left
/// as placeholders, not invented, since inventing them here would silently fork the design-token
/// source of truth §15 explicitly says must stay singular (`packages/ui/src/tokens.ts`). Fill
/// these in only via the real codegen step, never by hand-copying values that could drift.
enum SpacingTokens {
    // TODO(design-token-codegen): generate from packages/ui/src/tokens.ts's `spacing` scale.
}

enum RadiiTokens {
    // TODO(design-token-codegen): generate from packages/ui/src/tokens.ts's `radii` scale.
}

enum TypeScaleTokens {
    // TODO(design-token-codegen): generate from packages/ui/src/tokens.ts's `typeScale`, mapped
    // per NATIVE_IOS_SPEC.md §6 (display→.largeTitle, title→.title, heading→.headline,
    // body→.body, caption→.caption, micro→.caption2).
}

enum MotionDurationTokens {
    // TODO(design-token-codegen): generate from packages/ui/src/tokens.ts's `motionDuration`
    // (fast 120ms, base 200ms, slow 320ms per NATIVE_IOS_SPEC.md §10).
}

/// Colour tokens need BOTH a light and dark value per NATIVE_IOS_SPEC.md's dark-mode requirement
/// -- the real generator should emit a `Color` computed from `UITraitCollection`/
/// `Color(light:dark:)`-style pairing, not a single flat value. Structure only, values
/// deliberately not filled in -- see this file's own top-of-file comment.
enum ColorTokens {
    // TODO(design-token-codegen): generate from packages/ui/src/tokens.ts's `colorLight`/
    // `colorDark` pairs.
}
