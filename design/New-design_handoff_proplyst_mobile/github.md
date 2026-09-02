repo: M0hammed2o/Ahmed-Seedat-PropApp
branch: main
path: apps/android/app/src/main/java/za/co/proplyst/app/ui

## Last sync
date: 2026-09-02T11:15:09Z
### Updated in this project
- Audited Android Compose screens against the approved 1b Navy Deck design
- Wrote design_handoff_proplyst_mobile/ANDROID_FIDELITY_AUDIT.md (per-screen CURRENT / APPROVED / REQUIRED corrections)

## Screen map
| Project screen | Repo files |
|---|---|
| B-Auth.dc.html (signin*, forgot*) | ui/auth/SignInScreen.kt, ui/auth/SignInViewModel.kt |
| B-Auth.dc.html (lock*, bio-*, settings-*, logout-confirm) | ui/biometric/BiometricLockOverlay.kt, ui/biometric/BiometricAuthenticator.kt, ui/account/AccountScreen.kt |
| B-OwnerHome.dc.html | ui/dashboard/DashboardScreen.kt |
| B-Properties.dc.html | ui/properties/PropertiesListScreen.kt, ui/common/PropertyImage.kt |
| B-TenantHome.dc.html | ui/tenancy/TenantHomeScreen.kt |
| (More — pattern only) | ui/more/OwnerMoreScreen.kt |
| Design tokens (README.md) | ui/theme/Color.kt, ui/theme/Type.kt, ui/theme/Shape.kt, ui/theme/Theme.kt |
| Floating nav (kept deviation) | ui/common/FloatingBottomNav.kt |
