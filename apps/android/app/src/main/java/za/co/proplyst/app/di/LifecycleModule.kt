package za.co.proplyst.app.di

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Auth/session hardening pass (WORKLOG.md this date) -- provides the app (not Activity)
 * lifecycle for [za.co.proplyst.app.ui.biometric.BiometricGateViewModel]'s "foreground-from-
 * background" observer. Provided through Hilt, rather than the ViewModel calling
 * `ProcessLifecycleOwner.get()` itself, specifically so a unit test can inject a mocked
 * `Lifecycle` instead -- `ProcessLifecycleOwner.get()` requires real Android process/Looper
 * initialization this project's pure-JVM (no Robolectric) unit tests don't have, confirmed live
 * this pass (a direct `ProcessLifecycleOwner.get()` call inside the ViewModel's own `init{}`
 * threw at test-construction time). */
@Module
@InstallIn(SingletonComponent::class)
object LifecycleModule {
    @Provides
    fun provideProcessLifecycle(): Lifecycle = ProcessLifecycleOwner.get().lifecycle
}
