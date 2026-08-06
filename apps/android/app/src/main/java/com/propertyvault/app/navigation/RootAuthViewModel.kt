package com.propertyvault.app.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.propertyvault.app.data.auth.AuthRepository
import com.propertyvault.app.data.auth.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RootAuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {
    val authState: StateFlow<AuthState> = authRepository.authState

    fun restoreSession() {
        viewModelScope.launch { authRepository.restoreSession() }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.signOut() }
    }
}
