package za.co.proplyst.app.data.biometric

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Lock Proplyst now" (fidelity audit §6, Account card) -- lets the Security screen (nested in a
 * per-portal NavHost, so it cannot reach the root-scoped BiometricGateViewModel instance) request
 * an immediate lock. Same singleton-as-source-of-truth pattern as [BiometricLockPreferences]: the
 * gate ViewModel observes [requests] and flips its own `locked` state; this class itself gates
 * nothing and stores nothing sensitive.
 */
@Singleton
class LockRequestBus @Inject constructor() {
    private val _requests = MutableStateFlow(0L)
    val requests: StateFlow<Long> = _requests.asStateFlow()

    fun requestLock() {
        _requests.value = System.nanoTime()
    }
}
