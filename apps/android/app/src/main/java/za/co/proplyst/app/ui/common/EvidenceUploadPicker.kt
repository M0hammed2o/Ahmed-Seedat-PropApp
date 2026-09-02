package za.co.proplyst.app.ui.common

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import za.co.proplyst.app.ui.theme.ProplystTheme
import java.io.File

/** Camera / Gallery / File evidence capture (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §5/§6 -- "Owner
 * must be able to enter evidence: Camera, Gallery, File"). Reused by Add Expense and Utility
 * Capture rather than duplicated -- both need exactly the same three-source picker feeding the
 * same downstream upload path (the existing secure document upload/malware-scan infrastructure,
 * unchanged by this pass). Returns the picked Uri via [onPicked]; the caller owns what happens
 * next (multipart upload on submit, same as ReportPaymentScreen's own proofUri pattern). */
@Composable
fun EvidenceUploadPicker(
    pickedUri: Uri?,
    onPicked: (Uri?) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Evidence (optional)",
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    val context = LocalContext.current
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success) onPicked(pendingCameraUri) else pendingCameraUri = null
    }
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onPicked(uri)
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) onPicked(uri)
    }

    Column(modifier = modifier) {
        Text(label, style = type.caption, color = colors.textSecondary)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            EvidenceSourceButton(
                icon = Icons.Outlined.CameraAlt,
                label = "Camera",
                modifier = Modifier.weight(1f),
                onClick = {
                    val uri = newCaptureUri(context)
                    pendingCameraUri = uri
                    cameraLauncher.launch(uri)
                },
            )
            EvidenceSourceButton(
                icon = Icons.Outlined.Image,
                label = "Gallery",
                modifier = Modifier.weight(1f),
                onClick = {
                    galleryLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
            )
            EvidenceSourceButton(
                icon = Icons.Outlined.Folder,
                label = "File",
                modifier = Modifier.weight(1f),
                onClick = { filePicker.launch(arrayOf("image/jpeg", "image/png", "application/pdf")) },
            )
        }
        if (pickedUri != null) {
            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = colors.successText, modifier = Modifier.size(16.dp))
                Text("Evidence attached", style = type.caption, color = colors.successText)
            }
        }
    }
}

@Composable
private fun EvidenceSourceButton(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = ProplystTheme.colors
    val type = ProplystTheme.type
    Surface(
        color = colors.inputSurface,
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
        ) {
            Icon(icon, contentDescription = null, tint = colors.primary, modifier = Modifier.size(20.dp))
            Spacer(Modifier.height(4.dp))
            Text(label, style = type.caption, color = colors.textPrimary)
        }
    }
}

private fun newCaptureUri(context: Context): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "za.co.proplyst.app.fileprovider", file)
}
