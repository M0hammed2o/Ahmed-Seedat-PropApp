package za.co.proplyst.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import za.co.proplyst.app.navigation.RootNavGraph
import za.co.proplyst.app.ui.theme.ProplystTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ProplystTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    RootNavGraph()
                }
            }
        }
    }
}
