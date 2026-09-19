package za.co.proplyst.app.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.text.style.TextAlign
import za.co.proplyst.app.ui.theme.ProplystPillShape
import za.co.proplyst.app.ui.theme.ProplystTheme

// DESIGN_SYSTEM.md "Empty states"/"Error states"/"Loading states", NATIVE_ANDROID_SPEC.md §4's
// component-mapping table -- one shared implementation per state, reused by every screen rather
// than each screen inventing its own.

@Composable
fun LoadingView(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize().background(ProplystTheme.colors.background),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = ProplystTheme.colors.primary)
    }
}

@Composable
fun EmptyStateView(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    /** An optional way out of the empty state -- "Report a payment", "Add a notice". */
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    // 2026-09-19: an empty screen used to be a small grey glyph adrift in a full page of white,
    // which is what "mostly blank" meant on the Samsung. The glyph now sits in the same tinted
    // rounded square the More screen uses for its row icons, and the block is nudged above the
    // optical centre so it does not float at the bottom of a tall phone.
    Column(
        modifier = modifier.fillMaxSize().background(ProplystTheme.colors.background).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            color = ProplystTheme.colors.blueTint,
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.size(64.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Filled.Inbox,
                    contentDescription = null,
                    tint = ProplystTheme.colors.primary,
                    modifier = Modifier.size(28.dp),
                )
            }
        }
        Text(
            title,
            style = ProplystTheme.type.cardTitleLarge,
            color = ProplystTheme.colors.textPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 18.dp),
        )
        if (description != null) {
            Text(
                description,
                style = ProplystTheme.type.body,
                color = ProplystTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (actionLabel != null && onAction != null) {
            Button(
                onClick = onAction,
                shape = ProplystPillShape,
                colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
                modifier = Modifier.padding(top = 20.dp),
            ) {
                Text(actionLabel, style = ProplystTheme.type.button)
            }
        }
        // Balances the block against the header above it rather than centring on raw screen height.
        Spacer(modifier = Modifier.height(48.dp))
    }
}

@Composable
fun ErrorStateView(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().background(ProplystTheme.colors.background).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(
            color = ProplystTheme.colors.criticalBg,
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.size(64.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Filled.ErrorOutline,
                    contentDescription = null,
                    tint = ProplystTheme.colors.critical,
                    modifier = Modifier.size(28.dp),
                )
            }
        }
        Spacer(modifier = Modifier.height(18.dp))
        Text(
            message,
            style = ProplystTheme.type.cardTitle,
            color = ProplystTheme.colors.textPrimary,
            textAlign = TextAlign.Center,
        )
        Button(
            onClick = onRetry,
            shape = ProplystPillShape,
            colors = ButtonDefaults.buttonColors(containerColor = ProplystTheme.colors.primary),
            modifier = Modifier.padding(top = 16.dp),
        ) {
            Text("Retry", style = ProplystTheme.type.button)
        }
    }
}

/** Shared status pill (Invoice V1 completion pass, WORKLOG.md this date, mobile UX polish) --
 * colour + label together, never colour alone (status is never colour-only, matching
 * `DESIGN_SYSTEM.md`'s accessibility rule for status presentation). Recognizes the exact
 * `InvoiceDisplayStatus`/payment-report status strings the backend already sends; an unrecognized
 * value still renders (falls back to the neutral/default tone) rather than crashing on a future
 * status this app doesn't know about yet. */
@Composable
fun StatusChip(status: String, modifier: Modifier = Modifier) {
    // 2026-09-17: was Material's generic container colours, which is a large part of why the record
    // screens read as plain Android pages next to Home. Same signature, same labels, Proplyst tones.
    StatusChip(label = status, tone = toneForStatus(status), modifier = modifier)
}

/** NATIVE_ANDROID_SPEC.md §7/§8: "never silently stale" -- a persistent, visible banner whenever
 * a screen is showing cached (not live) data. */
@Composable
fun CachedDataBanner(relativeTime: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = ProplystTheme.colors.networkBg,
    ) {
        Text(
            text = "Showing cached data from $relativeTime",
            style = ProplystTheme.type.meta,
            color = ProplystTheme.colors.networkText,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
    }
}
