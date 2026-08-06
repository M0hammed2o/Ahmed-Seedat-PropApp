import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colorLight } from '@propvault/ui';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-phase errors anywhere below it in the tree and shows a recoverable screen
 * instead of a blank/crashed app (launch-readiness audit finding, 2026-07-22 — previously there
 * was no error boundary anywhere in the app). Deliberately class-based: error boundaries are
 * not expressible as hooks in React. Uses static `colorLight` rather than `useTheme()` since a
 * broken render tree may itself be the reason the theme hook is unsafe to call here.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // No error-monitoring backend is wired in Phase 1/2 (see KNOWN_BUGS.md) — this is the one
    // safe place to log without depending on app state that may itself be broken.
    console.error('[ErrorBoundary] Unhandled render error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView
          style={{ flex: 1, backgroundColor: colorLight.surface, justifyContent: 'center' }}
        >
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                color: colorLight.textPrimary,
                textAlign: 'center',
              }}
            >
              Something went wrong
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: colorLight.textSecondary,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              PropVault ran into an unexpected error. Your data is safe — try again below.
            </Text>
            <View style={{ marginTop: 24, width: '100%' }}>
              <PrimaryButton label="Try again" onPress={this.reset} />
            </View>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}
