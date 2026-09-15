package za.co.proplyst.app.data.network

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.ByteArrayOutputStream
import java.io.File

/** A user-facing reason a picked file cannot be uploaded. The message is shown as-is. */
class UploadPreparationException(message: String) : Exception(message)

/** A multipart file part backed by a private cache file; [close] deletes that file. */
class PreparedUpload(val part: MultipartBody.Part, val mimeType: String, private val file: File) : AutoCloseable {
    val byteCount: Long get() = file.length()
    override fun close() {
        file.delete()
    }
}

/**
 * Turns a picked content:// (or file://) Uri into an uploadable part, applying [UploadImagePolicy]:
 * photos are oriented, resized and re-encoded as JPEG under the scanner's size limit; PDFs are
 * copied byte-for-byte; anything else is refused with a clear message. Close the result once the
 * upload call returns.
 *
 * Runs on Dispatchers.IO: decoding a multi-megabyte photo on the main thread would freeze the UI
 * (the same ANR the repositories' original copy-to-cache code already had to avoid).
 */
suspend fun prepareUpload(context: Context, uri: Uri, baseName: String): PreparedUpload = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val mimeType = resolver.getType(uri)
    val displayName = displayNameOf(context, uri)
    when (UploadImagePolicy.kindOf(mimeType, displayName)) {
        UploadImagePolicy.Kind.PDF -> {
            val file = File.createTempFile(baseName, ".pdf", context.cacheDir)
            try {
                copyInto(context, uri, file)
            } catch (e: Exception) {
                file.delete()
                throw e
            }
            PreparedUpload(
                MultipartBody.Part.createFormData("file", file.name, file.asRequestBody(UploadImagePolicy.PDF_MIME.toMediaTypeOrNull())),
                UploadImagePolicy.PDF_MIME,
                file,
            )
        }
        UploadImagePolicy.Kind.PHOTO -> preparePhoto(context, uri, baseName)
        UploadImagePolicy.Kind.UNSUPPORTED -> throw UploadPreparationException("Choose a photo (JPEG or PNG) or a PDF.")
    }
}

private fun preparePhoto(context: Context, uri: Uri, baseName: String): PreparedUpload {
    val source = File.createTempFile("${baseName}_source", ".img", context.cacheDir)
    try {
        copyInto(context, uri, source)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw UploadPreparationException("This photo couldn't be read on this device. Choose a JPEG or PNG photo, or a PDF.")
        }
        if (!UploadImagePolicy.isAcceptableSource(bounds.outWidth, bounds.outHeight)) {
            throw UploadPreparationException("This image is too large to process. Choose a smaller photo.")
        }

        val orientation = runCatching {
            ExifInterface(source.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

        val base = decodeOriented(source, bounds.outWidth, bounds.outHeight, orientation)
        try {
            for (attempt in UploadImagePolicy.ATTEMPTS) {
                val (w, h) = UploadImagePolicy.scaledSize(base.width, base.height, attempt.longEdgePx)
                val sized = if (w == base.width && h == base.height) base else Bitmap.createScaledBitmap(base, w, h, true)
                val bytes = try {
                    ByteArrayOutputStream().also { sized.compress(Bitmap.CompressFormat.JPEG, attempt.jpegQuality, it) }.toByteArray()
                } finally {
                    if (sized !== base) sized.recycle()
                }
                if (bytes.size <= UploadImagePolicy.TARGET_MAX_BYTES) {
                    val out = File.createTempFile(baseName, ".jpg", context.cacheDir)
                    try {
                        out.writeBytes(bytes)
                    } catch (e: Exception) {
                        out.delete()
                        throw e
                    }
                    return PreparedUpload(
                        MultipartBody.Part.createFormData("file", out.name, out.asRequestBody(UploadImagePolicy.JPEG_MIME.toMediaTypeOrNull())),
                        UploadImagePolicy.JPEG_MIME,
                        out,
                    )
                }
            }
        } finally {
            base.recycle()
        }
        throw UploadPreparationException("This photo is too large to upload, even after reducing it. Try a PDF or a simpler photo.")
    } finally {
        source.delete()
    }
}

/** Decodes at a bounded sample size, then applies the EXIF rotation/mirror and the first size limit. */
private fun decodeOriented(source: File, width: Int, height: Int, orientation: Int): Bitmap {
    val firstEdge = UploadImagePolicy.ATTEMPTS.first().longEdgePx
    var sample = UploadImagePolicy.sampleSizeFor(width, height, firstEdge)
    val decoded = try {
        BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (_: OutOfMemoryError) {
        sample *= 2
        BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw UploadPreparationException("This photo couldn't be read on this device. Choose a JPEG or PNG photo, or a PDF.")

    val degrees = UploadImagePolicy.rotationDegrees(orientation)
    val mirrored = UploadImagePolicy.isMirrored(orientation)
    val (w, h) = UploadImagePolicy.scaledSize(decoded.width, decoded.height, firstEdge)
    val transformed = if (degrees == 0 && !mirrored && w == decoded.width && h == decoded.height) {
        decoded
    } else {
        val matrix = Matrix().apply {
            postScale(w.toFloat() / decoded.width, h.toFloat() / decoded.height)
            if (degrees != 0) postRotate(degrees.toFloat())
            if (mirrored) postScale(-1f, 1f)
        }
        try {
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        } finally {
            decoded.recycle()
        }
    }
    return flattenOntoWhite(transformed)
}

/** JPEG has no transparency: a transparent PNG would otherwise encode its see-through areas as
 * black, hiding dark writing on a scanned receipt or signature. Paper-white is what a viewer expects. */
private fun flattenOntoWhite(bitmap: Bitmap): Bitmap {
    if (!bitmap.hasAlpha()) return bitmap
    val flat = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    Canvas(flat).apply {
        drawColor(Color.WHITE)
        drawBitmap(bitmap, 0f, 0f, null)
    }
    bitmap.recycle()
    return flat
}

private fun copyInto(context: Context, uri: Uri, file: File) {
    val input = context.contentResolver.openInputStream(uri)
        ?: throw UploadPreparationException("The selected file couldn't be opened. Choose it again.")
    input.use { stream -> file.outputStream().use { stream.copyTo(it) } }
}

private fun displayNameOf(context: Context, uri: Uri): String? = runCatching {
    if (uri.scheme == "file") return@runCatching uri.lastPathSegment
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    }
}.getOrNull() ?: uri.lastPathSegment
