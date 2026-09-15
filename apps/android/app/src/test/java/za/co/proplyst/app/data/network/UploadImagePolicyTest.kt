package za.co.proplyst.app.data.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Upload preparation rules (Android V1 P1, 2026-09-15). The server's malware scanner refuses files
 * above 3,500,000 bytes, and a normal phone photo is 5-15 MB, so photos are resized and re-encoded
 * on the device before upload. These pin the decisions; UploadPreparationInstrumentedTest runs the
 * real decode/encode on an Android runtime.
 */
class UploadImagePolicyTest {

    @Test
    fun `photos, PDFs and everything else are told apart by MIME type, with the file name as fallback`() {
        for (mime in listOf("image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "IMAGE/JPEG", "image/jpeg; charset=binary")) {
            assertEquals(mime, UploadImagePolicy.Kind.PHOTO, UploadImagePolicy.kindOf(mime))
        }
        assertEquals(UploadImagePolicy.Kind.PDF, UploadImagePolicy.kindOf("application/pdf"))
        for (mime in listOf("image/gif", "image/svg+xml", "video/mp4", "text/plain", "application/zip")) {
            assertEquals(mime, UploadImagePolicy.Kind.UNSUPPORTED, UploadImagePolicy.kindOf(mime))
        }
        // A provider that reports no type (or a generic one) falls back to the file name.
        assertEquals(UploadImagePolicy.Kind.PHOTO, UploadImagePolicy.kindOf(null, "capture_1.jpg"))
        assertEquals(UploadImagePolicy.Kind.PDF, UploadImagePolicy.kindOf("application/octet-stream", "bill.PDF"))
        assertEquals(UploadImagePolicy.Kind.UNSUPPORTED, UploadImagePolicy.kindOf(null, "notes.txt"))
        assertEquals(UploadImagePolicy.Kind.UNSUPPORTED, UploadImagePolicy.kindOf(null, null))
        // A declared non-image type is never overridden by a misleading extension.
        assertEquals(UploadImagePolicy.Kind.UNSUPPORTED, UploadImagePolicy.kindOf("text/html", "photo.jpg"))
    }

    @Test
    fun `the byte budget sits below the server scanner limit`() {
        assertTrue(UploadImagePolicy.TARGET_MAX_BYTES < 3_500_000L)
        assertEquals(2560, UploadImagePolicy.MAX_LONG_EDGE_PX)
    }

    @Test
    fun `encoding attempts start at the full size and only ever step down`() {
        val attempts = UploadImagePolicy.ATTEMPTS
        assertEquals(UploadImagePolicy.MAX_LONG_EDGE_PX, attempts.first().longEdgePx)
        for ((previous, next) in attempts.zipWithNext()) {
            assertTrue(next.longEdgePx <= previous.longEdgePx)
            assertTrue(next.jpegQuality <= previous.jpegQuality)
            assertTrue(next.longEdgePx < previous.longEdgePx || next.jpegQuality < previous.jpegQuality)
        }
        assertTrue("never degrade below a readable size", attempts.last().longEdgePx >= 1280)
        assertTrue(attempts.all { it.jpegQuality in 60..95 })
    }

    @Test
    fun `decode sample size keeps memory bounded without decoding below the needed size`() {
        assertEquals(1, UploadImagePolicy.sampleSizeFor(2000, 1500, 2560)) // already small
        assertEquals(1, UploadImagePolicy.sampleSizeFor(4000, 3000, 2560)) // 12 MP phone photo: half would be too small
        assertEquals(2, UploadImagePolicy.sampleSizeFor(8160, 6120, 2560)) // 50 MP
        assertEquals(4, UploadImagePolicy.sampleSizeFor(16320, 12240, 2560)) // 200 MP sensor mode
        assertEquals(2, UploadImagePolicy.sampleSizeFor(3000, 6000, 2560)) // portrait
        for ((w, h) in listOf(4000 to 3000, 8160 to 6120, 16320 to 12240, 3000 to 6000)) {
            val sample = UploadImagePolicy.sampleSizeFor(w, h, 2560)
            assertTrue("decoded long edge must still cover the target", maxOf(w, h) / sample >= 2560)
        }
    }

    @Test
    fun `resizing caps the long edge, keeps the aspect ratio and never enlarges`() {
        assertEquals(2560 to 1920, UploadImagePolicy.scaledSize(4000, 3000, 2560))
        assertEquals(1440 to 2560, UploadImagePolicy.scaledSize(2250, 4000, 2560))
        assertEquals(1000 to 800, UploadImagePolicy.scaledSize(1000, 800, 2560))
        assertEquals(2560 to 2560, UploadImagePolicy.scaledSize(2560, 2560, 2560))
        assertEquals(2560 to 1, UploadImagePolicy.scaledSize(10000, 2, 2560)) // never collapses to zero
    }

    @Test
    fun `absurd or unreadable dimensions are refused before decoding`() {
        assertTrue(UploadImagePolicy.isAcceptableSource(16320, 12240)) // 200 MP is a real phone mode
        assertFalse(UploadImagePolicy.isAcceptableSource(20000, 20000)) // 400 MP: decompression bomb
        assertFalse(UploadImagePolicy.isAcceptableSource(65535, 65535))
        assertFalse(UploadImagePolicy.isAcceptableSource(0, 100))
        assertFalse(UploadImagePolicy.isAcceptableSource(-1, -1))
    }

    @Test
    fun `EXIF orientation maps to the rotation and mirroring a viewer would apply`() {
        val expected = mapOf(
            1 to (0 to false), 2 to (0 to true), 3 to (180 to false), 4 to (180 to true),
            5 to (90 to true), 6 to (90 to false), 7 to (270 to true), 8 to (270 to false),
            0 to (0 to false),
        )
        for ((tag, pair) in expected) {
            assertEquals("orientation $tag rotation", pair.first, UploadImagePolicy.rotationDegrees(tag))
            assertEquals("orientation $tag mirror", pair.second, UploadImagePolicy.isMirrored(tag))
        }
    }

    @Test
    fun `every repository that uploads a picked file goes through prepareUpload`() {
        val root = File("src/main/java/za/co/proplyst/app/data")
        val uploaders = listOf(
            "expenses/WebApiExpensesRepository.kt",
            "utilities/WebApiUtilitiesRepository.kt",
            "paymentreports/WebApiPaymentReportsRepository.kt",
            "maintenance/PostgrestMaintenanceRepository.kt",
        )
        for (path in uploaders) {
            val source = File(root, path).readText()
            assertTrue("$path uses prepareUpload", source.contains("prepareUpload("))
            assertFalse("$path must not copy picked files raw", source.contains("createTempFile("))
            assertFalse("$path must not keep the old helper", source.contains("uriToMultipart"))
        }
        val offenders = root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.name != "UploadPreparation.kt" }
            .filter { it.readText().contains("MultipartBody.Part.createFormData(") }
            .map { it.name }
            .toList()
        assertEquals("only UploadPreparation.kt builds file parts", emptyList<String>(), offenders)
    }
}
