package za.co.proplyst.app.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.auth.AuthRepository
import za.co.proplyst.app.data.auth.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RootAuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val pendingDeepLinkStore: PendingDeepLinkStore,
) : ViewModel() {
    val authState: StateFlow<AuthState> = authRepository.authState

    fun restoreSession() {
        viewModelScope.launch { authRepository.restoreSession() }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.signOut() }
    }

    /** Reads and clears the pending App Link target (Android V1 last local blocker pass,
     * WORKLOG.md this date) -- exposed here rather than injecting PendingDeepLinkStore directly
     * into RootNavGraph, since a plain @Singleton class has no Compose-friendly injection point
     * the way a ViewModel does via hiltViewModel(). */
    fun consumePendingDeepLink(): AppLinkDestination? = pendingDeepLinkStore.consume()
}
