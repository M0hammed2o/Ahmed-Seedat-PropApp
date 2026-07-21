import type { PropertyStatus, PropertyType } from './enums';

export interface Property {
  id: string;
  ownerUserId: string;
  nickname: string;
  fullAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  propertyType: PropertyType;
  municipalAccountNumber: string | null;
  notes: string | null;
  imagePath: string | null;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
}

export type PropertyDraft = Omit<
  Property,
  'id' | 'ownerUserId' | 'createdAt' | 'updatedAt' | 'status'
>;

export interface PropertyExpectedCategory {
  id: string;
  propertyId: string;
  categoryId: string;
  isExpected: boolean;
  createdAt: string;
  updatedAt: string;
}
