package za.co.proplyst.app.navigation

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Holds an App Link target from the moment MainActivity's onCreate()/onNewIntent() parses it
 * until RootNavGraph is ready to act on it (Android V1 last local blocker pass, WORKLOG.md this
 * date). App-scoped singleton rather than SavedStateHandle/nav args because the target has to
 * survive from BEFORE the Compose tree exists (a cold start's intent) through however long
 * sign-in takes -- a genuinely cross-cutting piece of state, not owned by any one screen. */
@Singleton
class PendingDeepLinkStore @Inject constructor() {

    private val _target = MutableStateFlow<AppLinkDestination?>(null)
    val target: StateFlow<AppLinkDestination?> = _target.asStateFlow()

    fun set(destination: AppLinkDestination?) {
        _target.value = destination
    }

    /** Reads and clears in one step -- a pending target is consumed at most once, whether it
     * turns out to be role-compatible or not (RootNavGraph decides which; either way, the SAME
     * link tapped again later should re-navigate fresh, not silently reuse a stale target). */
    fun consume(): AppLinkDestination? {
        val current = _target.value
        _target.value = null
        return current
    }
}
