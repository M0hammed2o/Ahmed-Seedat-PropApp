package za.co.proplyst.app.ui.common

// Extracted after a real bug (2026-08-01, WORKLOG.md): Kotlin's default Double.toString() always
// keeps a trailing decimal ("R10650.0"), which shipped to a real device screenshot on
// UnitDetailScreen before being caught. LeaseDetailScreen needs the identical formatting for
// rentAmount/depositAmount, so this is a shared helper rather than a second copy-pasted bug
// waiting to happen.
fun formatCurrency(value: Double): String =
    if (value % 1.0 == 0.0) "%,d".format(value.toLong()) else "%,.2f".format(value)

fun formatArea(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else "%.1f".format(value)
