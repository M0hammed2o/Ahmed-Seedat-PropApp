# Store assets

## Required by Google

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, <1 MB | **Available** — checked 2026-09-15: 512×512, RGBA, 128,585 bytes |
| Feature graphic | 1024×500 PNG/JPG, required to publish | **Missing — must be produced** |
| Phone screenshots | 2–8, PNG/JPG, min 320px, max 3840px, long side ≤ 2× short side; 9:16 at 1080×1920 recommended | **Not captured** — see below |
| 7" tablet screenshots | optional | Not planned for V1 |
| 10" tablet screenshots | optional | Not planned for V1 |

## App icon

`apps/admin/public/icons/icon-512.png` is already 512×512 and is the real Proplyst mark used by the
PWA. Use it directly. (`icon-maskable-512.png` is the maskable variant — that one is for the web
manifest, not for Play.)

The Android launcher icon is separate and already correct: an adaptive icon at
`apps/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` over
`drawable/ic_launcher_background.xml` + `drawable-nodpi/ic_launcher_foreground.png`.

## Feature graphic — still needed

1024×500, no transparency. It appears at the top of the listing. Simplest honest version: the
Proplyst wordmark and logo on the Navy Deck background (`#0F1B2D`), with the short description as a
single line. This is a design asset — it should not be auto-generated from a screenshot.

## Screenshots

Capture from the demo portfolio, which is populated and contains no real customer data. Best five,
in order:

1. **Home** — collected/billed/outstanding hero, occupancy strip
2. **Home, scrolled** — operating costs breakdown and the green monthly net position
3. **Needs attention** — the ranked alert list
4. **Properties** — the portfolio cards with occupancy bars
5. **Add expense** — showing the receipt attach row

Optional sixth: a tenant screen (Home or Payments), from a synthetic tenant, never a real one.

Size warning: a Pixel 7 (and its emulator) captures 1080×2400, which is 2.22:1, and Play refuses a
screenshot whose long side is more than twice its short side. Either capture on a 1080×1920
(9:16) device profile, or crop the system status and navigation bars off until the image is at
most 2:1 (for example 1080×2160). Do not stretch the image, and do not add features, numbers or
text the app does not show.

Rules:
- Use the demo account only.
- Every screenshot must be the real app as built for this release, not a mock-up.
- Frame out the status bar clock/battery if you want them uniform, or leave them — Play accepts both.
- Do not show any real customer organisation.
- Do not commit device screenshots that contain personal information.
