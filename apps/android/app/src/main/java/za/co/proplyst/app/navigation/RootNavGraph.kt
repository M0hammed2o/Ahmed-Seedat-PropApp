package za.co.proplyst.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import za.co.proplyst.app.data.auth.AuthState
import za.co.proplyst.app.ui.auth.SignInScreen
import za.co.proplyst.app.ui.auth.SplashScreen

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
                when (val state = authState) {
                    is AuthState.Authenticated -> navController.navigate(destinationForRole(state)) {
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
                    // Real role is only known once RootAuthViewModel's authState actually flips to
                    // Authenticated (signIn() already fetched both memberships and tenancies) --
                    // re-navigating through SPLASH re-runs the LaunchedEffect above with that real
                    // state, rather than guessing OWNER_ROOT here and potentially routing a
                    // tenant-only account to a portal with zero organizations to show.
                    navController.navigate(Destinations.SPLASH) {
                        popUpTo(Destinations.SIGN_IN) { inclusive = true }
                    }
                },
            )
        }
        composable(Destinations.OWNER_ROOT) {
            OwnerRootScreen()
        }
        composable(Destinations.TENANT_ROOT) {
            TenantRootScreen()
        }
    }
}

/** Owner/staff (has an org membership) takes precedence over tenant when an account somehow holds
 * both -- mirrors the web app's own destinationResolver.ts precedence (an org-staff caller lands
 * on the staff dashboard first). Neither -- the genuine "signed in, no portal access" edge case --
 * falls back to SIGN_IN rather than crashing on a portal with nothing to show. */
private fun destinationForRole(state: AuthState.Authenticated): String = when {
    state.organizations.isNotEmpty() -> Destinations.OWNER_ROOT
    state.tenancies.isNotEmpty() -> Destinations.TENANT_ROOT
    else -> Destinations.SIGN_IN
}
