package za.co.proplyst.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Fidelity-audit pass -- the activity rows' trailing timestamp ("now"/"5m"/"3h"/"2d"/short
 * date). Pinned with a fixed `now` so these never flake with the clock. */
class RelativeTimeTest {

    private val now: Instant = Instant.parse("2026-09-02T12:00:00Z")

    @Test
    fun `under a minute is now`() {
        assertEquals("now", relativeTimeLabel("2026-09-02T11:59:30Z", now))
    }

    @Test
    fun `minutes and hours and days`() {
        assertEquals("5m", relativeTimeLabel("2026-09-02T11:55:00Z", now))
        assertEquals("3h", relativeTimeLabel("2026-09-02T09:00:00Z", now))
        assertEquals("2d", relativeTimeLabel("2026-08-31T12:00:00Z", now))
    }

    @Test
    fun `a week or older falls back to a short date, and junk input renders empty, never crashes`() {
        // The month name is locale-dependent by design (device locale on a real phone), so only
        // the day-of-month prefix is pinned here.
        assertTrue(relativeTimeLabel("2026-08-16T10:00:00Z", now).startsWith("16 "))
        assertEquals("", relativeTimeLabel("not-a-timestamp", now))
    }
}
