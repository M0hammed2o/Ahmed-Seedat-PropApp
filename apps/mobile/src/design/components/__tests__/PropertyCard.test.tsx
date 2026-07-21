import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PropertyCard } from '../PropertyCard';

const property = {
  id: 'prop-1',
  nickname: 'Sea Point Apartment',
  fullAddress: '12 Beach Road, Sea Point, Cape Town',
  propertyType: 'apartment' as const,
};

describe('PropertyCard', () => {
  it('renders the nickname and address', () => {
    const { getByText } = render(<PropertyCard property={property} />);
    expect(getByText('Sea Point Apartment')).toBeTruthy();
    expect(getByText('12 Beach Road, Sea Point, Cape Town')).toBeTruthy();
  });

  it('calls onPress with the property id when tapped', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<PropertyCard property={property} onPress={onPress} />);
    fireEvent.press(getByLabelText('Open Sea Point Apartment'));
    expect(onPress).toHaveBeenCalledWith('prop-1');
  });
});
