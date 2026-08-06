package com.propertyvault.app.ui.theme

import androidx.compose.ui.graphics.Color

// Mirrors packages/ui/src/tokens.ts's colorLight/colorDark exactly -- hand-transcribed for this
// first vertical slice (the build-time JSON-export/codegen step NATIVE_ANDROID_SPEC.md §14
// describes as the long-term mechanism doesn't exist yet, TASKS.md M20/M22 follow-up). Any change
// to tokens.ts must be mirrored here by hand until that codegen step is built.

object LightColors {
    val surface = Color(0xFFFBFAF7)
    val surfaceRaised = Color(0xFFFFFFFF)
    val border = Color(0xFFE5E2DA)
    val textPrimary = Color(0xFF12151A)
    val textSecondary = Color(0xFF5B6068)
    val textMuted = Color(0xFF8A8F97)
    val accent = Color(0xFF2F5D50)
    val accentContrast = Color(0xFFFFFFFF)
    val statusPaid = Color(0xFF2F6D4C)
    val statusUnpaid = Color(0xFF8A8F97)
    val statusOverdue = Color(0xFFB3432B)
    val statusNeedsReview = Color(0xFFB08900)
    val statusProcessing = Color(0xFF3B6FA0)
    val statusDisputed = Color(0xFF8A3B8F)
    val statusVoid = Color(0xFF5B6068)
    val danger = Color(0xFFB3432B)
}

object DarkColors {
    val surface = Color(0xFF14161A)
    val surfaceRaised = Color(0xFF1D2025)
    val border = Color(0xFF2C2F35)
    val textPrimary = Color(0xFFF2F1ED)
    val textSecondary = Color(0xFFB7BBC2)
    val textMuted = Color(0xFF82868D)
    val accent = Color(0xFF5B9683)
    val accentContrast = Color(0xFF0C1210)
    val statusPaid = Color(0xFF5FAE81)
    val statusUnpaid = Color(0xFF82868D)
    val statusOverdue = Color(0xFFE08064)
    val statusNeedsReview = Color(0xFFE0BB55)
    val statusProcessing = Color(0xFF7CA9D6)
    val statusDisputed = Color(0xFFC589C9)
    val statusVoid = Color(0xFF82868D)
    val danger = Color(0xFFE08064)
}
