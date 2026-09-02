package za.co.proplyst.app.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest

/**
 * Property photo with the approved Navy Deck fallback (design handoff: "No photo fallback:
 * diagonal navy stripes `#0F1B2D`/`#152540` with building glyph `#3B6FD9`") -- used by both the
 * Properties grid card and the property detail hero, so a missing/loading/failed photo never
 * renders a blank grey rectangle. `imageUrl` is treated uniformly whether it's a real signed
 * Supabase Storage URL or a mock `android.resource://` URI (see [za.co.proplyst.app.data
 * .properties.MockPropertiesRepository]) -- Coil resolves both the same way.
 */
@Composable
fun PropertyPhoto(
    imageUrl: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    shape: Shape? = null,
) {
    val clipped = if (shape != null) modifier.clip(shape) else modifier
    if (imageUrl.isNullOrBlank()) {
        PropertyPhotoFallback(modifier = clipped)
        return
    }
    var showFallback by remember(imageUrl) { mutableStateOf(false) }
    Box(modifier = clipped) {
        AsyncImage(
            model = ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                .data(imageUrl)
                .crossfade(true)
                .build(),
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
            onState = { state -> showFallback = state is AsyncImagePainter.State.Error },
        )
        if (showFallback) {
            PropertyPhotoFallback(modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun PropertyPhotoFallback(modifier: Modifier = Modifier) {
    val stripeA = Color(0xFF0F1B2D)
    val stripeB = Color(0xFF152540)
    val glyphTint = Color(0xFF3B6FD9)
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawRect(color = stripeA)
            val stripeWidthPx = 12.dp.toPx()
            val diagonalSpan = size.width + size.height
            var offset = -size.height
            while (offset < diagonalSpan) {
                drawLine(
                    color = stripeB,
                    start = Offset(offset, size.height),
                    end = Offset(offset + size.height, 0f),
                    strokeWidth = stripeWidthPx,
                    cap = StrokeCap.Butt,
                )
                offset += stripeWidthPx * 2
            }
        }
        Icon(
            imageVector = Icons.Filled.Apartment,
            contentDescription = null,
            tint = glyphTint,
            modifier = Modifier.fillMaxSize(0.28f),
        )
    }
}
