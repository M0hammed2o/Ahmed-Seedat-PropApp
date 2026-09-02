package za.co.proplyst.app.ui.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import za.co.proplyst.app.ui.theme.ProplystTheme
import za.co.proplyst.app.ui.theme.ThemeMode

/** Appearance (System/Light/Dark) -- lives under More/Profile per the redesign pass spec, never a
 * per-screen toggle. Persisted via [za.co.proplyst.app.data.appearance.AppearancePreferences]. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AppearanceScreen(
    onBack: () -> Unit,
    viewModel: AppearanceViewModel = hiltViewModel(),
) {
    val themeMode by viewModel.themeMode.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Appearance") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
            ThemeMode.entries.forEach { mode ->
                ThemeOptionRow(
                    mode = mode,
                    selected = mode == themeMode,
                    onClick = { viewModel.setThemeMode(mode) },
                )
            }
        }
    }
}

@Composable
private fun ThemeOptionRow(mode: ThemeMode, selected: Boolean, onClick: () -> Unit) {
    val label = when (mode) {
        ThemeMode.SYSTEM -> "System"
        ThemeMode.LIGHT -> "Light"
        ThemeMode.DARK -> "Dark"
    }
    val description = when (mode) {
        ThemeMode.SYSTEM -> "Match this device's setting"
        ThemeMode.LIGHT -> "Always use light mode"
        ThemeMode.DARK -> "Always use Navy Deck dark mode"
    }
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable(onClick = onClick),
    ) {
        Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = onClick)
            Column(modifier = Modifier.padding(start = 4.dp)) {
                Text(label, style = ProplystTheme.type.cardTitle)
                Text(description, style = ProplystTheme.type.caption, color = ProplystTheme.colors.textSecondary)
            }
        }
    }
}
