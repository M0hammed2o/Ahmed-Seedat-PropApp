import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { AuthScaffold } from '../AuthScaffold';
import { FormTextField } from '../FormTextField';
import { deviceMediaPermissionCopy } from '@/features/deviceMediaPermissions';

describe('iOS-ready shared primitives', () => {
  it('keeps authentication forms scrollable and keyboard-aware', () => {
    const view = render(
      <AuthScaffold title="Sign in" subtitle="Continue to Proplyst">
        <Text>Email field</Text>
      </AuthScaffold>,
    );
    const scrollView = view.getByTestId('auth-scroll-view');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(scrollView.props.keyboardDismissMode).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
  });

  it('announces field validation errors', () => {
    const view = render(<FormTextField label="Email address" value="bad" errorMessage="Enter a valid email address" />);
    expect(view.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    expect(view.getByLabelText('Email address').props.accessibilityHint).toBe('Enter a valid email address');
  });

  it('uses platform-specific recovery copy for denied permissions', () => {
    const copy = deviceMediaPermissionCopy('camera');
    expect(copy.title).toBe('Camera access needed');
    expect(copy.message).toContain(Platform.OS === 'ios' ? 'iPhone Settings' : 'device settings');
  });
});
