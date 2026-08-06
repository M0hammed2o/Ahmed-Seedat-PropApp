package com.propertyvault.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.propertyvault.app.data.auth.AuthState
import com.propertyvault.app.ui.auth.SignInScreen
import com.propertyvault.app.ui.auth.SplashScreen

/**
 * Auth shell (NATIVE_ANDROID_SPEC.md "Implement the first verified Android vertical slice:
 * Authentication shell") -- launch/splash state while AuthRepository.restoreSession() resolves,
 * sign-in screen, authenticated root. Sign-out is reachable from within OwnerRootScreen's own
 * screens once a Settings/Account screen exists (not yet built, same as the rest of the "More"
 * tab) -- AuthViewModel below exposes signOut() ready for that wiring.
 */
@Composable
fun RootNavGraph() {
    val navController = rememberNavController()
    val authViewModel: RootAuthViewModel = hiltViewModel()
    val authState by authViewModel.authState.collectAsState()

    LaunchedEffect(Unit) {
        authViewModel.restoreSession()
    }

    NavHost(navController = navController, startDestination = Destinations.SPLASH) {
        composable(Destinations.SPLASH) {
            LaunchedEffect(authState) {
                when (authState) {
                    is AuthState.Authenticated -> navController.navigate(Destinations.OWNER_ROOT) {
                        popUpTo(Destinations.SPLASH) { inclusive = true }
                    }
                    is AuthState.Unauthenticated -> navController.navigate(Destinations.SIGN_IN) {
                        popUpTo(Destinations.SPLASH) { inclusive = true }
                    }
                    is AuthState.Loading -> Unit // stay on splash
                }
            }
            SplashScreen()
        }
        composable(Destinations.SIGN_IN) {
            SignInScreen(
                onSignedIn = {
                    navController.navigate(Destinations.OWNER_ROOT) {
                        popUpTo(Destinations.SIGN_IN) { inclusive = true }
                    }
                },
            )
        }
        composable(Destinations.OWNER_ROOT) {
            OwnerRootScreen()
        }
    }
}
