package za.co.proplyst.app.ui.theme

/** Appearance setting (Proplyst Mobile Design System, redesign pass): System follows the device
 * theme, Light/Dark force a choice regardless of the device. Lives under More/Profile > Appearance
 * (`AppearancePreferences`), never a per-screen toggle. */
enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK,
}
