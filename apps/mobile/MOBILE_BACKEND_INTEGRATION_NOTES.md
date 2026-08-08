# Proplyst mobile backend integration contract

Status: Shared Android/iOS frontend implementation, mock adapters active. Updated 8 August 2026.

This document is the handoff contract for replacing the in-memory demo layer with real adapters. The app currently follows:

`screens -> feature hooks/view models -> repository interfaces -> createMockRepositories()`

Keep screens independent of Supabase, table names, SQL, service credentials, PayFast, and server implementation details. Implement `MobileRepositories` from `src/data/contracts.ts`, then pass that object to `RepositoryProvider` in `app/_layout.tsx`. Do not rewrite screens.

## Shared rules

- Authentication and authorization remain server-authoritative. `CurrentUserCapabilities` is presentation input, not an authorization control.
- Return stable opaque IDs, ISO-8601 timestamps with offsets, phone numbers in E.164, and monetary values as integer/decimal ZAR amounts—not preformatted strings unless the contract explicitly says `string`.
- List methods should return `[]` for a valid empty result and throw a normalized, user-safe error for failure. Never return `null` for a collection.
- Every screen already renders initial loading, populated, empty, refresh, and error/retry states through `useRepositoryQuery`/`QueryState`.
- Preserve last good data when refresh fails. Future adapters may add `{ status: 'offline' | 'reconnecting' }`; `NetworkBanner` is ready for that state.
- Backend endpoints below are `TODO` unless marked known. No existing PWA/backend API contract was changed or assumed.

## Integration matrix

| Screen/workflow | Interface and method | Expected request | Expected response | Permission assumption | Error/loading behavior | Endpoint / TODO |
|---|---|---|---|---|---|---|
| App bootstrap | `AuthRepository.getSession`, `subscribe` | Device session/cookie/refresh token handled inside adapter | `AuthSession \| null`; user includes identity, organisation, capabilities | Server computes all capabilities | Full-screen spinner, then auth/onboarding/app redirect; adapter must normalize expired session to `null` | TODO: map current mobile auth/session mechanism |
| Sign in | `AuthRepository.signIn` | `{email,password}` | `authenticated`, `mfa_required`, `email_unconfirmed`, or typed `error` | Public | Button loading; invalid credentials, rate limit, network and unconfirmed states have distinct copy | TODO: connect existing auth service without changing its behavior |
| Google / Apple | `signInWithProvider` | Provider plus return/deep-link URI internal to adapter | `authenticated` or `provider_disabled`/typed error | Public; Apple remains visibly unavailable until configured | Provider-specific loading/error | TODO: configure Android Google OAuth and verified deep links; Apple must remain disabled until configured |
| Signup | `AuthRepository.signUp` | `{email,password}` plus versioned consent values when backend supports them | `confirmation_sent` or typed error | Public | Form validation, consent required, sending/error state | TODO: confirm server fields for terms/privacy versions; do not silently discard consent in production |
| Email confirmation | `completeEmailConfirmation`, `resendConfirmation` | Secure token is consumed by adapter/deep link; resend `{email}` | `authenticated`, `confirmation_sent`, `expired_link`, typed error | Public/token holder | Confirming, verified, expired/used, resend states | TODO: Android App Link scheme/host and token parsing |
| Password reset | `requestPasswordReset`, `updatePassword` | Email, then new password with secure recovery session | `success` or typed error | Public/recovery session | Sending, sent, expired/network/error | TODO: verified reset deep link and recovery-session lifetime |
| MFA challenge/setup | `verifyMfa`; setup methods are not yet in interface | `{factorId,code}`; setup needs factor enrollment/verify/unenroll | `authenticated` or `invalid_mfa_code`; setup needs QR/secret/recovery response | Authenticated for setup | Loading/error; current setup QR is explicitly a UI placeholder | TODO: add MFA enrollment contract to `AuthRepository` before enabling setup actions |
| Logout | `AuthRepository.signOut` | Current device/session | `void` after local token cleanup | Authenticated | Native confirmation dialog; route to welcome | TODO: decide single-session vs all-session logout method |
| Complete account | `ProfileRepository.getCurrent`, `completeProfile` | `AccountProfileInput`; includes normalized `phoneE164` | Updated `MobileUser` | Authenticated, own profile | Form validation, saving/error; email read-only | TODO: confirm allowed country list and secure email-change flow |
| Create/join organisation | `OrganizationRepository.create`, `joinWithCode`, `getCurrent` | `{name,type}` or `{code}` | `OrganizationSummary`; session subscription should publish updated user/org | Authenticated manager; joining is invitation-authorized server-side | Create/join loading, invalid/expired code, retry | TODO: invitation semantics, organisation types and post-join role/capabilities |
| Home dashboard | `DashboardRepository.getSnapshot` | Current organisation/scope implicit | `DashboardSnapshot` with pre-aggregated metrics/activity/tasks/notices | Server scopes identity and property access | Skeleton, empty, retry, pull refresh | TODO: aggregated mobile dashboard endpoint; owner/tenant variants should share response shape |
| Property list/search | `PropertyRepository.list` | Optional status; future query/filter/page cursor | `PropertySummary[]` | Server property scope | Skeleton, local search, empty/error, pull refresh | TODO: pagination/filter contract for large portfolios |
| Add/edit/archive property | `create`, `update`, `archive`, `restore` | `PropertyDraft`/partial draft/ID | Updated `PropertySummary` or `void` | `canEditProperty`; backend must enforce | Field validation, submitting, safe archive confirmation, error | TODO: server validation and archive conflict semantics |
| Property detail/photos | `getById`; photo methods missing | Property ID; photo adapter needs picked media, ordering and cover flag | `PropertySummary`; future `PropertyPhoto[]` | Scoped access; mutate requires `canEditProperty` | Detail loading/error; photos UI present but not falsely persisted | TODO: add photo upload/list/reorder/delete methods with signed upload strategy |
| Units | `UnitRepository.list`, `getById` | Optional property ID or unit ID | `UnitRecord[]` / `UnitRecord` | Scoped to accessible properties | Skeleton/empty/error/pull refresh | TODO: add create/update/archive unit only when backend supports it |
| Tenants | `TenantRepository.list`, `getById` | Server-scoped list/filter or tenant ID | `TenantRecord[]` / `TenantRecord` | `canManageTenants` for manager views; tenant self-view must be server-scoped | Search, skeleton/empty/error; payment rows hidden without financial capability | TODO: paginate and split sensitive contact/payment fields if policies differ |
| Leases | `LeaseRepository.list`, `getById`, `create` | New lease requires tenant ID, unit ID, dates, rent, deposit, escalation, status | `LeaseRecord[]` / `LeaseRecord` | `canManageTenants`; server validates linked entity access and overlaps | Draft saving/error; date/entity selectors are visibly pending | TODO: options endpoint or repository methods for eligible tenant/unit choices; add update/sign/renew when supported |
| Accounting | `AccountingRepository.getOverview`, `listTransactions` | Period/property filters in future | `AccountingSnapshot`, `FinancialTransaction[]` | `canViewFinancials`; distribution data additionally `canViewOwnerDistributions` | Skeleton/empty/error/refresh; unavailable reconciliation labeled | TODO: period filters, pagination, transaction detail; bank feeds/reconciliation/cash entries are not implemented |
| Owners | `OwnerRepository.list`, `getById` | Owner/property scope filters or owner ID | `OwnerRecord[]` / `OwnerRecord` | `canViewOwnerDistributions`; server applies property-level access | Skeleton/empty/error/refresh | TODO: ownership split, statements, distribution history; prepare owner-portal scoped responses, not client filtering |
| Document library/detail | `DocumentRepository.list`, `getById` | Search/category/link filters future; document ID | `DocumentRecord[]` / `DocumentRecord` | Server entity scope | Processing/needs-review/ready/failed badges; list/detail loading/empty/error | TODO: pagination, download/view URL with expiry and category vocabulary |
| Document capture/upload/OCR | `beginUpload`, `reviewExtraction` | Metadata today; real adapter needs file URI/stream, MIME, size, hash, linked entity; reviewed fields | Created processing `DocumentRecord`; updated ready record | `canUploadDocuments`; server validates links/file | Camera permission denial, picker cancellation, uploading, processing, review, failed/retry | TODO: signed upload or multipart contract; virus scan; OCR job status/poll/push; extraction schema and correction audit |
| Maintenance list/detail/create | `MaintenanceRepository.list`, `getById`, `create` | Ticket fields, property/unit IDs, priority, notes, media refs | `MaintenanceTicket[]` / ticket | `canManageMaintenance`; tenant may create/view only own requests | Skeleton/empty/error; create submitting/error; timeline rendered | TODO: status transitions, notes/activity pagination, contractor/cost approval, photo upload, tenant-specific methods |
| Inspections | `InspectionRepository.list`, `getById`, `create` | Scope/filter, inspection ID, or property/unit/type/schedule/status/checklist size | `InspectionRecord[]` / record | `canManageInspections`; signatures server-controlled | Skeleton/empty/error; create loading/error; checklist and photo summary | TODO: update/checklist methods, native scheduling constraints, checklist schema/version, autosave, image upload, signatures, completion validation |
| Meter readings | `MeterRepository.list`, `add` | Property/unit/meter ID, type, current reading, timestamp, photo ref | `MeterReading[]` / reading | `canRecordMeterReadings`; backend checks monotonic/exception rules | Skeleton/empty/error; saving state | TODO: meter catalog, previous reading returned by server, reading validation, photo evidence upload/history pagination |
| Reports | `ReportRepository.list`, `requestExport` | `{reportId,from,to}` plus future property filters | templates; `{jobId}` then future job status/download | Server filters available templates and data scope | Template loading/empty/error; planned disabled; queued state | TODO: add `getExportJob(jobId)`/notifications/download URL and retention rules |
| Notifications | `NotificationRepository.list`, `markRead` | Cursor/filter; notification ID | `NotificationRecord[]`; `void` | Server scopes recipient; destinations must be validated routes | Empty/read/unread/refresh/error; deep-link after mark read | TODO: pagination, mark-all-read, push token registration/removal, allowlisted destination mapping |
| Notification preferences | `getPreferences`, `updatePreferences` | Full `NotificationPreferences` | Saved preferences | Own account | Loading/error, optimistic form with explicit save | TODO: channel availability and OS notification-permission status |
| Settings/profile/security | Auth/Profile/Organisation/Notification repositories; several methods missing | Varies | Server-safe settings DTOs | Capability-gated manager/billing/staff entries | Pending features are labeled, not actionable | TODO: profile update, password change, factor list, sessions, staff/role list, linked accounts, legal URLs |
| Billing | No mobile billing repository | None | None | `canManageBilling` only affects visibility | UI says web managed | Keep billing backend/PWA untouched; decide later whether mobile deep-links to an approved web route |

## Adapter implementation checklist

1. Create real adapter files under `src/data/real/` implementing every interface in `contracts.ts`.
2. Add a composition function such as `createRealRepositories(config)`; keep secrets out of the client. Public endpoint/project identifiers may be supplied through validated Expo public config only.
3. Select the adapter once at the composition root. Demo mode should be one explicit build/runtime flag; screens must not branch on it.
4. Normalize transport/auth errors into safe domain errors. Extend typed errors deliberately when a screen needs distinct recovery—not with raw backend messages.
5. Map backend DTOs to the existing domain contracts in adapters. Do not expose table/column names to hooks or screens.
6. Add contract tests that run the same expectations against mock and staging adapters. Never point mobile tests at production.
7. Verify server authorization for every ID lookup and mutation even when the button is hidden by a capability.
8. Register Android App Links for confirmation, recovery, OAuth and notification destinations. Allowlist internal routes before navigation.
9. Add media size/type limits, cancellation, progress, retry, and cleanup to photo/document adapters.
10. Add telemetry and crash reporting only after privacy review; never log passwords, tokens, document contents, tenant PII or financial detail.

## iOS integration and preview requirements

- The Expo/React Native app remains the single mobile application. No SwiftUI application or iOS-specific backend adapter is required.
- Configure associated domains and Universal Links for email confirmation, password recovery, OAuth returns and allowlisted notification destinations before production. The existing `proplyst` scheme is suitable only for development fallback links.
- Camera and photo-library usage descriptions are configured in `app.config.ts`. The real media adapter must continue to handle cancellation, limited-library access, revoked permission and Settings recovery without treating denial as an upload.
- Push preference UI now requests the local OS permission. A real adapter still needs APNs/Expo push token registration, rotation and removal, plus server-side delivery preferences. Permission alone must never be represented as successful push registration.
- Face ID/Touch ID protects only the local signed-in session. Persisting the user’s opt-in and any local lock secret must use Keychain-backed secure storage; it must not become an authentication or authorization factor on the server.
- Apple sign-in remains visibly unavailable until Apple capability, service ID/key, callback and backend identity-linking behavior are configured. Do not enable the button with UI-only behavior.
- RevenueCat native purchases and Face ID verification require an iOS development build. The mock subscription provider remains the correct non-native frontend path.
- The App Store Expo Go client currently supports SDK 54, while this project intentionally remains on SDK 56. Apple does not allow installing an older/matching Expo Go client side-by-side on a physical iPhone, so this SDK 56 project cannot currently be reviewed in Expo Go on an iPhone. Do not downgrade the shared app to work around that store-client limitation.
- Windows can validate TypeScript, lint, Jest, Metro bundling, Expo configuration, an exported iOS JavaScript bundle and Android behavior. An actual iPhone with an SDK 56 development build can validate safe areas, Dynamic Type, VoiceOver, keyboard behavior, camera/photos, notification presentation and Face ID. EAS can compile that signed device build in the cloud from Windows, but it requires the appropriate Apple developer credentials and registered device. The iOS Simulator, local native compilation, Xcode debugging and archive validation require macOS with Xcode.

## Known frontend/backend gaps for Claude

- MFA enrollment, factor management and recovery codes need repository methods before the setup placeholder can be activated.
- Property photos, inspection photos, maintenance photos and meter evidence need a shared media upload contract.
- Lease creation needs server-provided eligible tenant/unit selectors and overlap validation.
- OCR needs processing-job status, extraction schema, review persistence and failure/retry behavior.
- Reconciliation, cash transactions and owner distribution ledger are clearly marked unavailable; no backend behavior was invented.
- Staff/roles, linked accounts, billing management, legal-document URLs and profile editing are present as honest settings placeholders.
- The static Expo tab declaration currently presents the manager navigation. `src/navigation/navigationModel.ts` specifies owner/tenant variants; switch the route shell from backend-returned identity/capabilities when those portal payloads are ready.
- Replace legacy document/demo routes under `properties/[id]` with the new `documents` adapter workflow once backend OCR routing is agreed; they remain hidden compatibility routes for now.

No production Supabase, PWA, migration, RLS, billing, deployment, or backend authentication code was changed for this mobile implementation.
