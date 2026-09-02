package za.co.proplyst.app.ui.common

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/** Compact trailing timestamp for activity rows (fidelity audit §2): "now", "5m", "3h", "2d",
 * then a short date ("16 Aug"). Accepts the backend's ISO-8601 instants; anything unparseable
 * renders as an empty string rather than crashing a list row. */
fun relativeTimeLabel(isoTimestamp: String, now: Instant = Instant.now()): String {
    val instant = runCatching { Instant.parse(isoTimestamp) }.getOrNull() ?: return ""
    val minutes = ChronoUnit.MINUTES.between(instant, now)
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 60 * 24 -> "${minutes / 60}h"
        minutes < 60 * 24 * 7 -> "${minutes / (60 * 24)}d"
        // instant.atZone(...).toLocalDate() rather than LocalDate.ofInstant(...) -- the latter is
        // API 34+ (a real NewApi lint error against minSdk 26); this form is API 26-safe.
        else -> instant.atZone(ZoneId.systemDefault()).toLocalDate().format(DateTimeFormatter.ofPattern("d MMM"))
    }
}
