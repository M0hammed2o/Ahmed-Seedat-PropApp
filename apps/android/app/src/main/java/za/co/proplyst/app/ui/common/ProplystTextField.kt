package za.co.proplyst.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import za.co.proplyst.app.ui.theme.ProplystFontFamily
import za.co.proplyst.app.ui.theme.ProplystTheme
import androidx.compose.ui.text.font.FontWeight

/**
 * Proplyst text field (fidelity audit §0.6) -- replaces Material's `OutlinedTextField` wherever
 * the design shows the 50 dp / radius-14 / `#F6F8FB` input: no floating label (the label is an
 * external 13/600 line 6 dp above), 1 px `#E5E9F0` border at rest, and on focus a blue border
 * with a 3 dp `#E8F0FE` halo ring. `error = true` tints the border `#FCA5A5` (invalid-credential
 * state). [dark] renders the on-navy variant (Properties search: 44 dp, `rgba(255,255,255,.08)`
 * bg, `.12` border, white text).
 */
@Composable
fun ProplystTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    enabled: Boolean = true,
    error: Boolean = false,
    dark: Boolean = false,
    height: Int = 50,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val colors = ProplystTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()

    val containerColor = if (dark) Color.White.copy(alpha = 0.08f) else colors.inputSurface
    val restBorder = if (dark) Color.White.copy(alpha = 0.12f) else colors.border
    val borderColor = when {
        error -> Color(0xFFFCA5A5)
        focused -> colors.primary
        else -> restBorder
    }
    val textColor = if (dark) Color.White else colors.textPrimary
    val placeholderColor = if (dark) colors.navySecondaryOn else colors.textTertiary
    val textStyle = TextStyle(
        fontFamily = ProplystFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = if (dark) 14.sp else 15.sp,
        color = textColor,
    )

    Column(modifier = modifier) {
        if (label != null) {
            Text(
                label,
                style = ProplystTheme.type.captionEmphasis,
                color = if (dark) colors.navyTertiaryOn else Color(0xFF3A4A5E),
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (focused && !dark) {
                        Modifier
                            .background(colors.blueTint, RoundedCornerShape(17.dp))
                            .padding(3.dp)
                    } else {
                        Modifier
                    },
                ),
        ) {
            Surface(
                color = containerColor,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, borderColor),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(height.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(start = 14.dp, end = 4.dp),
                ) {
                    if (leadingIcon != null) {
                        Box(modifier = Modifier.padding(end = 10.dp)) { leadingIcon() }
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, style = textStyle.copy(color = placeholderColor))
                        }
                        BasicTextField(
                            value = value,
                            onValueChange = onValueChange,
                            enabled = enabled,
                            singleLine = true,
                            textStyle = textStyle,
                            cursorBrush = SolidColor(if (dark) Color.White else colors.primary),
                            visualTransformation = visualTransformation,
                            keyboardOptions = keyboardOptions,
                            interactionSource = interactionSource,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (trailingIcon != null) {
                        Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) { trailingIcon() }
                    }
                }
            }
        }
    }
}
