package za.co.proplyst.app.ui.notificationprefs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import za.co.proplyst.app.data.notificationprefs.NotificationCategory
import za.co.proplyst.app.data.notificationprefs.NotificationPreference
import za.co.proplyst.app.data.notificationprefs.NotificationPreferencesRepository
import za.co.proplyst.app.data.notificationprefs.NotificationPreferencesResult
import za.co.proplyst.app.data.notificationprefs.UpdatePreferenceResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface NotificationPreferencesUiState {
    data object Loading : NotificationPreferencesUiState
    data class Loaded(val preferences: List<NotificationPreference>) : NotificationPreferencesUiState
    data class Error(val message: String) : NotificationPreferencesUiState
}

@HiltViewModel
class NotificationPreferencesViewModel @Inject constructor(
    private val repository: NotificationPreferencesRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<NotificationPreferencesUiState>(NotificationPreferencesUiState.Loading)
    val uiState: StateFlow<NotificationPreferencesUiState> = _uiState.asStateFlow()

    private val _busyCategory = MutableStateFlow<NotificationCategory?>(null)
    val busyCategory: StateFlow<NotificationCategory?> = _busyCategory.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = NotificationPreferencesUiState.Loading
            _uiState.value = when (val result = repository.getMyPreferences()) {
                is NotificationPreferencesResult.Loaded -> NotificationPreferencesUiState.Loaded(result.preferences)
                is NotificationPreferencesResult.Error -> NotificationPreferencesUiState.Error(result.message)
            }
        }
    }

    fun toggle(preference: NotificationPreference, channel: Channel, enabled: Boolean) {
        val state = _uiState.value
        if (state !is NotificationPreferencesUiState.Loaded) return

        _busyCategory.value = preference.category
        viewModelScope.launch {
            val result = repository.setChannelEnabled(
                category = preference.category,
                emailEnabled = if (channel == Channel.EMAIL) enabled else preference.emailEnabled,
                pushEnabled = if (channel == Channel.PUSH) enabled else preference.pushEnabled,
                whatsappEnabled = if (channel == Channel.WHATSAPP) enabled else preference.whatsappEnabled,
            )
            if (result is UpdatePreferenceResult.Success) load()
            _busyCategory.value = null
        }
    }

    enum class Channel { EMAIL, PUSH, WHATSAPP }
}
