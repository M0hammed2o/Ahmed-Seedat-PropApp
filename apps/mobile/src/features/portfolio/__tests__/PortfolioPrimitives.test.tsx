import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PermissionGate, QueryState } from '@/design/components';
import { ActionCard } from '../PortfolioPrimitives';
import { Text } from 'react-native';

describe('shared portfolio states', () => {
  it('does not render protected financial content when capability is absent', () => {
    const view = render(<PermissionGate allowed={false} fallback={<Text>Restricted</Text>}><Text>Owner distribution R200 000</Text></PermissionGate>);
    expect(view.queryByText('Owner distribution R200 000')).toBeNull();
    expect(view.getByText('Restricted')).toBeTruthy();
  });

  it('renders an empty state and a retryable error state', () => {
    const retry = jest.fn();
    const view = render(<QueryState isLoading={false} error={null} isEmpty emptyTitle="No properties" emptyDescription="Add your first property." onRetry={retry}><Text>Data</Text></QueryState>);
    expect(view.getByText('No properties')).toBeTruthy();
    view.rerender(<QueryState isLoading={false} error="Network unavailable" isEmpty={false} emptyTitle="Empty" emptyDescription="Empty" onRetry={retry}><Text>Data</Text></QueryState>);
    fireEvent.press(view.getByLabelText('Retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('supports device actions without inventing a navigation route', () => {
    const openCamera = jest.fn();
    const view = render(<ActionCard title="Take a photo" description="Use this device’s camera" icon="camera" onPress={openCamera} />);
    fireEvent.press(view.getByLabelText('Take a photo'));
    expect(openCamera).toHaveBeenCalledTimes(1);
  });
});
