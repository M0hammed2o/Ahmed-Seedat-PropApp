package za.co.proplyst.app.data.network

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Random

/**
 * prepareUpload() on a real Android runtime (Android V1 P1, 2026-09-15): real BitmapFactory decoding,
 * EXIF handling and JPEG encoding. Stands in for the camera: the photos are generated here, sized
 * and detailed like real phone photos, because a physical camera is not available to automated
 * tests. The server-side scanner limit these must fit under is 3,500,000 bytes.
 */
@RunWith(AndroidJUnit4::class)
class UploadPreparationInstrumentedTest {

    private lateinit var context: Context
    private lateinit var workDir: File

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        workDir = File(context.filesDir, "upload-prep-test").apply { deleteRecursively(); mkdirs() }
    }

    @After
    fun tearDown() {
        workDir.deleteRecursively()
    }

    /** A photo-like image: smooth gradients plus sensor-style noise, which keeps a full-resolution
     * JPEG as large as a real phone photo. */
    private fun writePhoto(name: String, width: Int, height: Int, quality: Int = 95): File {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val random = Random(42)
        val row = IntArray(width)
        fun channel(base: Int) = (base + random.nextInt(61) - 30).coerceIn(0, 255)
        for (y in 0 until height) {
            for (x in 0 until width) {
                row[x] = Color.rgb(channel(x * 255 / width), channel(y * 255 / height), channel(((x + y) * 255) / (width + height)))
            }
            bitmap.setPixels(row, 0, width, 0, y, width, 1)
        }
        // A bright block in the top-left corner, to check where it ends up after orientation.
        Canvas(bitmap).drawRect(0f, 0f, width / 4f, height / 4f, Paint().apply { color = Color.WHITE })
        val file = File(workDir, name)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
        bitmap.recycle()
        return file
    }

    private fun bytesOf(upload: PreparedUpload): ByteArray = Buffer().also { upload.part.body.writeTo(it) }.readByteArray()

    private fun cacheFiles(): Set<String> = context.cacheDir.listFiles().orEmpty().map { it.name }.toSet()

    @Test
    fun aPhotoFarAboveTheScannerLimitIsResizedAndReencodedBelowIt() = runBlocking {
        val source = writePhoto("big.jpg", 5000, 3750)
        assertTrue("source must genuinely exceed the scanner limit, was ${source.length()}", source.length() > 3_500_000)

        prepareUpload(context, Uri.fromFile(source), "test_evidence").use { upload ->
            val bytes = bytesOf(upload)
            assertEquals("image/jpeg", upload.mimeType)
            assertTrue("output ${bytes.size} bytes must fit the budget", bytes.size <= UploadImagePolicy.TARGET_MAX_BYTES)

            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val longEdge = maxOf(bounds.outWidth, bounds.outHeight)
            assertTrue("long edge $longEdge is one of the allowed sizes", UploadImagePolicy.ATTEMPTS.any { it.longEdgePx == longEdge })
            assertTrue("keeps evidence detail: long edge $longEdge", longEdge >= 2048)
            assertTrue("landscape stays landscape", bounds.outWidth > bounds.outHeight)
            assertEquals("aspect ratio kept", 4.0 / 3.0, bounds.outWidth.toDouble() / bounds.outHeight, 0.01)
        }
    }

    @Test
    fun exifOrientationIsAppliedAndLocationMetadataIsRemoved() = runBlocking {
        val source = writePhoto("rotated.jpg", 4000, 3000, quality = 90)
        ExifInterface(source.path).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            setAttribute(ExifInterface.TAG_GPS_LATITUDE, "29/1,51/1,0/1")
            setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF, "S")
            setAttribute(ExifInterface.TAG_GPS_LONGITUDE, "31/1,1/1,0/1")
            setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF, "E")
            saveAttributes()
        }

        prepareUpload(context, Uri.fromFile(source), "test_rotated").use { upload ->
            val out = File(workDir, "out.jpg").apply { writeBytes(bytesOf(upload)) }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(out.path, bounds)
            assertTrue("a 90-degree photo becomes portrait pixels", bounds.outWidth < bounds.outHeight)
            assertEquals("3:4 after rotation", 0.75, bounds.outWidth.toDouble() / bounds.outHeight, 0.01)
            assertTrue(UploadImagePolicy.ATTEMPTS.any { it.longEdgePx == bounds.outHeight })

            val exif = ExifInterface(out.path)
            assertNull("GPS latitude must not survive", exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
            assertNull("GPS longitude must not survive", exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE))
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            assertTrue("no rotation left for a viewer to apply twice", orientation == ExifInterface.ORIENTATION_NORMAL || orientation == ExifInterface.ORIENTATION_UNDEFINED)

            // The bright block was top-left; rotated 90 degrees clockwise it is top-right.
            val decoded = BitmapFactory.decodeFile(out.path)
            val topRight = decoded.getPixel(decoded.width - 40, 40)
            val topLeft = decoded.getPixel(40, 40)
            decoded.recycle()
            assertTrue("top-right should be the white block", Color.red(topRight) > 200 && Color.green(topRight) > 200 && Color.blue(topRight) > 200)
            assertTrue("top-left should be noise, not the block", !(Color.red(topLeft) > 200 && Color.green(topLeft) > 200 && Color.blue(topLeft) > 200))
        }
    }

    @Test
    fun aTransparentPngBecomesAJpegOnWhiteNotBlack() = runBlocking {
        // A transparent background with dark "writing" in the middle, like a scanned signature.
        val bitmap = Bitmap.createBitmap(1200, 800, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.TRANSPARENT)
            Canvas(this).drawRect(500f, 350f, 700f, 450f, Paint().apply { color = Color.BLACK })
        }
        val source = File(workDir, "signature.png")
        source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()

        prepareUpload(context, Uri.fromFile(source), "test_png").use { upload ->
            assertEquals("image/jpeg", upload.mimeType)
            val bytes = bytesOf(upload)
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            val background = decoded.getPixel(40, 40)
            val writing = decoded.getPixel(600, 400)
            decoded.recycle()
            assertTrue("transparent area must be white", Color.red(background) > 240 && Color.green(background) > 240 && Color.blue(background) > 240)
            assertTrue("the writing must stay dark", Color.red(writing) < 40 && Color.green(writing) < 40 && Color.blue(writing) < 40)
        }
    }

    @Test
    fun aPdfIsUploadedByteForByteAndNeverTreatedAsAnImage() = runBlocking {
        val pdfBytes = ("%PDF-1.4\n" + "x".repeat(4_000_000) + "\n%%EOF\n").toByteArray()
        val source = File(workDir, "bill.pdf").apply { writeBytes(pdfBytes) }

        prepareUpload(context, Uri.fromFile(source), "test_pdf").use { upload ->
            assertEquals("application/pdf", upload.mimeType)
            assertArrayEquals(pdfBytes, bytesOf(upload))
        }
    }

    @Test
    fun anUnsupportedFileIsRefusedWithAClearMessage() = runBlocking {
        val source = File(workDir, "notes.txt").apply { writeText("not an upload") }
        try {
            prepareUpload(context, Uri.fromFile(source), "test_txt").close()
            fail("a text file must be refused")
        } catch (e: UploadPreparationException) {
            assertEquals("Choose a photo (JPEG or PNG) or a PDF.", e.message)
        }
    }

    @Test
    fun aFileThatOnlyPretendsToBeAPhotoIsRefusedNotUploaded() = runBlocking {
        val source = File(workDir, "fake.jpg").apply { writeText("this is not a jpeg") }
        try {
            prepareUpload(context, Uri.fromFile(source), "test_fake").close()
            fail("an undecodable 'photo' must be refused")
        } catch (e: UploadPreparationException) {
            assertTrue(e.message!!.contains("couldn't be read"))
        }
    }

    @Test
    fun preparedAndIntermediateFilesAreDeletedFromTheCache() = runBlocking {
        val before = cacheFiles()
        val source = writePhoto("cleanup.jpg", 3000, 2000)
        prepareUpload(context, Uri.fromFile(source), "test_cleanup").use { upload ->
            assertTrue(upload.byteCount > 0)
        }
        assertEquals("no upload files left behind in the cache", before, cacheFiles())
    }
}
