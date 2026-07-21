// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AdminMetricCard } from '../AdminMetricCard';

// Vitest doesn't auto-register Testing Library's cleanup the way Jest does unless `test.globals`
// is enabled — without this, DOM nodes from one test leak into the next test's queries.
afterEach(cleanup);

describe('AdminMetricCard', () => {
  it('renders the label, value, and optional hint', () => {
    render(<AdminMetricCard label="Registered customers" value={42} hint="Last 30 days" />);
    expect(screen.getByText('Registered customers')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Last 30 days')).toBeTruthy();
  });

  it('omits the hint element when none is provided', () => {
    render(<AdminMetricCard label="Total properties" value={7} />);
    expect(screen.queryByText('Last 30 days')).toBeNull();
  });
});
