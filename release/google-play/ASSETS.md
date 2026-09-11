# Store assets

## Required by Google

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, <1 MB | **Available** — see below |
| Feature graphic | 1024×500 PNG/JPG | **Missing — must be produced** |
| Phone screenshots | 2–8, 16:9 or 9:16, min 320px, max 3840px | **Capturable** — see below |
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

Rules:
- Use the demo account only.
- Frame out the status bar clock/battery if you want them uniform, or leave them — Play accepts both.
- Do not show any real customer organisation.
- Do not commit device screenshots that contain personal information.
