package za.co.proplyst.app.data.network

/**
 * The decisions behind preparing a picked file for upload (Android V1 P1, 2026-09-15) -- pure, so
 * they are unit-tested on the JVM; [prepareUpload] applies them with the Android image APIs.
 *
 * Why photos are re-encoded: every uploaded file is malware-scanned server-side, and the scanner's
 * plan refuses files above 3,500,000 bytes (apps/admin/lib/providers/malwareScan.ts). A modern phone
 * photo is routinely 5-15 MB, so evidence captured with the Camera button was being refused. Photos
 * are therefore resized to at most [MAX_LONG_EDGE_PX] on their long edge -- plenty to read a receipt
 * or a meter, or to see damage -- and re-encoded as JPEG under [TARGET_MAX_BYTES]. The server's own
 * size, type and malware checks are unchanged; this only stops ordinary photos hitting them.
 *
 * Re-encoding also drops the photo's EXIF metadata, including any GPS position a camera app wrote --
 * the app declares that it collects no location data, and a photo's embedded location would be
 * exactly that. PDFs are never touched.
 */
object UploadImagePolicy {
    /** Long edge after resizing: 2560 px is 4.9 MP at 4:3. */
    const val MAX_LONG_EDGE_PX = 2560

    /** Below the scanner's 3,500,000-byte limit, with headroom. */
    const val TARGET_MAX_BYTES = 3_000_000L

    /** A picture claiming more pixels than this is refused before decoding -- a phone's largest
     * sensor mode is 200 MP; anything beyond is a decompression bomb, not a photo. */
    const val MAX_SOURCE_PIXELS = 250_000_000L

    const val PDF_MIME = "application/pdf"
    const val JPEG_MIME = "image/jpeg"

    private val PHOTO_MIME_TYPES = setOf("image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/heic", "image/heif", "image/webp")

    enum class Kind { PHOTO, PDF, UNSUPPORTED }

    /** Encoding steps tried in order until the output fits [TARGET_MAX_BYTES]. */
    data class Attempt(val longEdgePx: Int, val jpegQuality: Int)

    val ATTEMPTS: List<Attempt> = listOf(
        Attempt(2560, 88),
        Attempt(2560, 80),
        Attempt(2048, 80),
        Attempt(1600, 75),
        Attempt(1280, 70),
    )

    /** From the resolver's MIME type, falling back to the file name when a provider reports none. */
    fun kindOf(mimeType: String?, fileName: String? = null): Kind {
        val mime = mimeType?.substringBefore(';')?.trim()?.lowercase()
        if (mime == PDF_MIME) return Kind.PDF
        if (mime != null && mime in PHOTO_MIME_TYPES) return Kind.PHOTO
        if (mime != null && mime != "application/octet-stream") return Kind.UNSUPPORTED
        return when (fileName?.substringAfterLast('.', "")?.lowercase()) {
            "pdf" -> Kind.PDF
            "jpg", "jpeg", "png", "heic", "heif", "webp" -> Kind.PHOTO
            else -> Kind.UNSUPPORTED
        }
    }

    fun isAcceptableSource(width: Int, height: Int): Boolean =
        width > 0 && height > 0 && width.toLong() * height.toLong() <= MAX_SOURCE_PIXELS

    /**
     * The largest power-of-two decode sample size that still leaves the decoded long edge at or
     * above [targetLongEdge] -- memory stays bounded (a 200 MP photo decodes at 1/4 scale) without
     * decoding below the size the final image needs.
     */
    fun sampleSizeFor(width: Int, height: Int, targetLongEdge: Int): Int {
        val longEdge = maxOf(width, height)
        var sample = 1
        while (longEdge / (sample * 2) >= targetLongEdge) sample *= 2
        return sample
    }

    /** Dimensions scaled so the long edge is at most [maxLongEdge]; never enlarged. */
    fun scaledSize(width: Int, height: Int, maxLongEdge: Int): Pair<Int, Int> {
        val longEdge = maxOf(width, height)
        if (longEdge <= maxLongEdge) return width to height
        val scale = maxLongEdge.toDouble() / longEdge
        return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
    }

    /** Clockwise rotation for an EXIF orientation value (1-8). */
    fun rotationDegrees(exifOrientation: Int): Int = when (exifOrientation) {
        3, 4 -> 180
        5, 6 -> 90
        7, 8 -> 270
        else -> 0
    }

    /** Whether that EXIF orientation also mirrors the image horizontally (applied after rotation). */
    fun isMirrored(exifOrientation: Int): Boolean = exifOrientation in setOf(2, 4, 5, 7)
}
