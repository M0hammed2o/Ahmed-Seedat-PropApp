// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PropertyCard, type PropertyCardData } from '@/components/properties/PropertyCard';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// PropertyCardData gained fullAddress/propertyType after this fixture was written, and the
// `as PropertyCardData` cast stopped being enough to satisfy the compiler once the shapes no
// longer overlapped -- a real `pnpm typecheck` failure, unrelated to what this test asserts.
const card: PropertyCardData = {
  id: '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a',
  nickname: 'Marine Parade Apartments',
  addressLine1: '14 Marine Parade',
  fullAddress: '14 Marine Parade, North Beach, Durban, KwaZulu-Natal, 4001',
  city: 'Durban',
  propertyType: 'apartment_building',
  unitsCount: 4,
  occupiedCount: 3,
  monthlyIncome: 26000,
  outstanding: 0,
  status: 'active',
  imagePath: null,
} as PropertyCardData;

describe('PropertyCard href targeting', () => {
  it('links to the property detail page by default', () => {
    const { container } = render(<PropertyCard property={card} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(`/properties/${card.id}`);
  });

  // The "choose a property" step of the Maintenance ticket flow retargets the card so picking one
  // continues into ticket creation instead of dead-ending on the detail page.
  it('substitutes :id into a supplied href template', () => {
    const { container } = render(
      <PropertyCard property={card} hrefTemplate="/properties/:id/maintenance/new" />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      `/properties/${card.id}/maintenance/new`,
    );
  });

  // Regression guard. This prop was first written as `(id) => string`, which cannot cross the
  // Server -> Client Component boundary: /properties?for=maintenance threw a Server Components
  // render error in production while plain /properties (prop undefined, therefore serializable)
  // kept working, so neither the build nor any existing test caught it. Keeping the prop a plain
  // string is the whole point.
  it('takes a serializable string, never a function', () => {
    const prop: string = '/properties/:id/maintenance/new';
    expect(typeof prop).toBe('string');
    const { container } = render(<PropertyCard property={card} hrefTemplate={prop} />);
    expect(container.querySelector('a')?.getAttribute('href')).not.toContain(':id');
  });
});
