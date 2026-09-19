package za.co.proplyst.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import za.co.proplyst.app.ui.theme.ProplystTheme

/**
 * The shared list furniture for Proplyst's record screens (2026-09-17).
 *
 * Invoices, payments, maintenance, tenants and the rest were built with Material's stock `ListItem`
 * and raw `MaterialTheme` colours, so they read as plain white Android pages beside Home, Needs
 * attention and Utility overview, which use the Navy Deck card language. These are the pieces those
 * good screens already use, pulled into one place instead of copied into each screen: a rounded
 * surface card, a status chip, and the standard list padding.
 *
 * Nothing here invents data. A screen with no date to show simply passes none.
 */

/** The floating bottom navigation is drawn OVER the NavHost, so every scrollable screen has to
 * reserve its own room or the last row sits under the bar and cannot be tapped. */
val ProplystListPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp)

/** Same, for screens that sit above the bar (a detail screen pushed onto the stack). */
val ProplystDetailPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 32.dp)

/** The gap between cards in a list. */
val ProplystListSpacing = Arrangement.spacedBy(10.dp)

enum class StatusTone { POSITIVE, WARNING, CRITICAL, NEUTRAL, INFO }

/**
 * A small filled chip for a record's state -- paid, overdue, in progress.
 *
 * Tone carries the meaning, so a state reads at a glance without hunting for the word; the label is
 * always shown as well, because colour alone is not an accessible signal.
 */
@Composable
fun StatusChip(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val colors = ProplystTheme.colors
    val (background, foreground) = when (tone) {
        StatusTone.POSITIVE -> colors.successBg to colors.successText
        StatusTone.WARNING -> colors.warningBg to colors.warningDeep
        StatusTone.CRITICAL -> colors.criticalBg to colors.criticalDeep
        StatusTone.INFO -> colors.blueTint to colors.primaryDeep
        StatusTone.NEUTRAL -> colors.inputSurface to colors.textSecondary
    }
    Surface(color = background, shape = RoundedCornerShape(50), modifier = modifier) {
        Text(
            label,
            style = ProplystTheme.type.statusLabel,
            color = foreground,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/** Maps a free-text status from the backend onto a tone. Unknown values stay neutral rather than
 * guessing a colour that might imply the wrong thing. */
fun toneForStatus(status: String?): StatusTone = when (status?.lowercase()?.replace('_', ' ')) {
    "paid", "confirmed", "completed", "active", "resolved", "closed" -> StatusTone.POSITIVE
    "partially paid", "in progress", "pending", "reported", "issued", "submitted" -> StatusTone.WARNING
    "overdue", "rejected", "failed", "urgent", "void", "cancelled" -> StatusTone.CRITICAL
    else -> StatusTone.NEUTRAL
}

/**
 * One record card: a title, optional supporting lines, chips, an optional trailing amount, and a
 * chevron when the row leads somewhere.
 *
 * [subtitle] is the record's context -- the property and unit, the tenant, the period -- and is
 * omitted entirely when a screen genuinely has nothing to put there.
 */
@Composable
fun ProplystRecordCard(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    meta: String? = null,
    amount: String? = null,
    amountCaption: String? = null,
    accent: Color? = null,
    onClick: (() -> Unit)? = null,
    chips: @Composable RowScope.() -> Unit = {},
    trailing: @Composable (() -> Unit)? = null,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 16.dp),
        ) {
            if (accent != null) {
                Box(
                    modifier = Modifier
                        .size(width = 4.dp, height = 40.dp)
                        .background(accent, RoundedCornerShape(2.dp)),
                )
                Spacer(modifier = Modifier.size(12.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    title,
                    style = type.cardTitle,
                    color = colors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) {
                    Spacer(modifier = Modifier.height(3.dp))
                    Text(
                        subtitle,
                        style = type.body,
                        color = colors.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (meta != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(meta, style = type.meta, color = colors.textTertiary, maxLines = 1)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 8.dp),
                    content = chips,
                )
            }
            if (amount != null) {
                Column(
                    horizontalAlignment = Alignment.End,
                    modifier = Modifier.padding(start = 12.dp),
                ) {
                    Text(amount, style = type.cardTitle, color = colors.textPrimary, maxLines = 1)
                    if (amountCaption != null) {
                        Text(amountCaption, style = type.meta, color = colors.textTertiary, maxLines = 1)
                    }
                }
            }
            trailing?.invoke()
            if (onClick != null && trailing == null) {
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.textSecondary,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
    }
}

/** A section heading inside a detail screen, matching the weight used on Home. */
@Composable
fun ProplystSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = ProplystTheme.type.meta,
        color = ProplystTheme.colors.textTertiary,
        modifier = modifier.padding(start = 4.dp, bottom = 6.dp),
    )
}

/**
 * A white card for a detail screen's body (2026-09-19).
 *
 * Detail screens were label/value pairs printed straight onto the page with Material's default
 * typography, which is why walking from a polished list into a record still landed on a plain white
 * Android page. Same surface, radius and padding as the cards on Home.
 */
@Composable
fun ProplystDetailCard(
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Surface(
        color = ProplystTheme.colors.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), content = content)
    }
}

/** One label/value pair inside a [ProplystDetailCard]. An absent value is the caller's decision --
 * pass the em dash the screen already used, or omit the row entirely. */
@Composable
fun ProplystDetailRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Text(label, style = ProplystTheme.type.meta, color = ProplystTheme.colors.textTertiary)
        Text(
            value,
            style = ProplystTheme.type.body,
            color = valueColor ?: ProplystTheme.colors.textPrimary,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/** The headline block at the top of a detail screen: the record's own identity, above its card. */
@Composable
fun ProplystDetailHeadline(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    chips: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier = modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        Text(
            title,
            style = ProplystTheme.type.cardTitleLarge,
            color = ProplystTheme.colors.textPrimary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (subtitle != null) {
            Text(
                subtitle,
                style = ProplystTheme.type.body,
                color = ProplystTheme.colors.textSecondary,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(top = 10.dp),
            content = chips,
        )
    }
}
