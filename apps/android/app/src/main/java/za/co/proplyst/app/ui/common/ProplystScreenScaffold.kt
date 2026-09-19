package za.co.proplyst.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * The Proplyst page chrome (2026-09-19).
 *
 * Home, More, Properties, Needs attention and Utility overview each open with a navy eyebrow
 * header over the canvas; the record screens instead used Material's stock `TopAppBar`, which is a
 * white bar with default type and a white page behind it. That single difference is what made them
 * read as unfinished Android pages on a real device even after their rows had been rebuilt as
 * Proplyst cards -- the rows were right, the page around them was not.
 *
 * This is that header, extracted from OwnerMoreScreen/NeedsAttentionScreen rather than reinvented,
 * so one change moves every record screen at once.
 */
@Composable
fun ProplystScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    /** The small label above the title -- the section this screen belongs to ("Portfolio"). */
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    /** A count beside the title, the way Needs attention shows its total. Omitted when null. */
    badge: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.navy)
            .navyHeaderGlow()
            .statusBarsPadding()
            .padding(top = 10.dp, bottom = 20.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = if (onBack != null) 4.dp else 20.dp),
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White,
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                if (eyebrow != null) {
                    Text(eyebrow, style = type.meta, color = colors.navySecondaryOn, maxLines = 1)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title,
                        style = type.settingsTitle,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (badge != null) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(color = Color.White.copy(alpha = 0.18f), shape = RoundedCornerShape(50)) {
                            Text(
                                badge,
                                style = type.meta.copy(fontWeight = FontWeight.Bold),
                                color = Color.White,
                                maxLines = 1,
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
                            )
                        }
                    }
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(end = if (onBack != null) 8.dp else 0.dp),
                content = actions,
            )
        }
    }
}

/**
 * A record screen: the navy header above, the Proplyst canvas behind.
 *
 * Deliberately still a Material `Scaffold` underneath, so the floating-action-button slot, the
 * content padding and the window-inset handling every converted screen already relied on keep
 * behaving exactly as they did.
 */
@Composable
fun ProplystScreenScaffold(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    badge: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    floatingActionButton: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        modifier = modifier,
        containerColor = ProplystTheme.colors.background,
        topBar = {
            ProplystScreenHeader(
                title = title,
                eyebrow = eyebrow,
                onBack = onBack,
                badge = badge,
                actions = actions,
            )
        },
        floatingActionButton = floatingActionButton,
        content = content,
    )
}
