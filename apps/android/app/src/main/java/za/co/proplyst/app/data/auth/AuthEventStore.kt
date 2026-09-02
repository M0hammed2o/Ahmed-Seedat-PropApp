package za.co.proplyst.app.data.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Why the last transition to Unauthenticated happened -- purely a PRESENTATION signal for the
 * sign-in screen (fidelity audit §1: the expired-session banner and the "You've been signed out"
 * toast are different visuals). Never consulted by any auth/session/refresh logic. */
enum class SignOutReason { USER, EXPIRED }

/**
 * One-shot sign-out-reason signal (fidelity audit pass). [SupabaseAuthRepository]/
 * [MockAuthRepository] write it at the moment they flip to Unauthenticated; SignInScreen consumes
 * it once to pick the right banner/toast. Rules: an explicit user sign-out (USER) always wins over
 * the expiry path (EXPIRED) -- signOut() internally calls forceSignOutLocally(), so EXPIRED is
 * only recorded when no reason is already pending. This class carries no tokens and gates nothing;
 * it exists so the auth layer's real transitions can drive the approved visuals without the UI
 * guessing.
 */
@Singleton
class AuthEventStore @Inject constructor() {
    private val _reason = MutableStateFlow<SignOutReason?>(null)
    val reason: StateFlow<SignOutReason?> = _reason.asStateFlow()

    fun recordUserSignOut() {
        _reason.value = SignOutReason.USER
    }

    /** EXPIRED never overwrites a pending USER -- see class doc. */
    fun recordExpiredIfUnset() {
        if (_reason.value == null) _reason.value = SignOutReason.EXPIRED
    }

    fun consume(): SignOutReason? {
        val value = _reason.value
        _reason.value = null
        return value
    }
}
