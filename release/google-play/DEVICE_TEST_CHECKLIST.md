# Physical device checklist — before the final AAB

Automated checks ran on a Pixel 7 emulator (Android 15). An emulator has no real camera, fingerprint
sensor or photo library, so these steps need a real phone. Use the demo owner account (see
`APP_ACCESS.md`). Do not use a real customer account, and do not upload real documents.

Install the release build on the phone, then:

| # | Area | Steps | Pass when |
|---|---|---|---|
| 1 | Sign-in | Sign in with email and password | Home shows portfolio figures |
| 2 | Fingerprint | More → Account & security → turn on Fingerprint unlock. Close the app from recents, reopen | The fingerprint prompt appears before any portfolio data is shown, and a wrong finger does not unlock |
| 3 | Camera photo | More → Add expense → Camera, take a photo, then save an R1 test expense against a demo property | The expense saves with evidence attached, with no "too large" error |
| 4 | Orientation | Open that evidence on the web (`proplyst.co.za`, same account) | The photo is upright, not sideways |
| 5 | Gallery | Add expense → Gallery, pick a recent full-resolution phone photo | Saves with no "too large" error |
| 6 | File picker | Add expense → File, pick a PDF under 3.5 MB | Saves. A PDF over 3.5 MB shows a clear "too large" message instead |
| 7 | Unsupported file | Maintenance ticket → Attach → pick a non-photo, non-PDF file, if the picker allows one | A clear message, no crash |
| 8 | Browser links | More → Legal → Privacy Policy, then Terms of Service | Each opens `proplyst.co.za/privacy` or `/terms` in the browser |
| 9 | Session | Close the app from recents and reopen. Then leave it overnight and reopen | Signed in both times, or the password is asked for. No crash, no blank screen |
| 10 | Offline | Turn on airplane mode and open Home | A clear offline or cached state, no crash |
| 11 | Sign out | More → Account & security → Sign out → confirm, then reopen the app | The sign-in screen shows, and fingerprint unlock is off |
| 12 | Delete account | More → Account & security → Delete account | The confirmation dialog explains what is deleted. **Tap Cancel. Never confirm on the demo account.** |

Steps 3, 5 and 6 create real records on the production demo portfolio, which the Play reviewer
also sees. Keep them at R1, write down what you created, and remove them afterwards so the demo
figures return to what they were. The app has no delete for expenses, so this is done on the web or
by an administrator. Then sign out on the phone.
