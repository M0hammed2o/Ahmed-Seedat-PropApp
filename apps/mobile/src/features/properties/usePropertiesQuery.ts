import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PropertyInput } from '@propvault/validation';
import { propertyRepository } from './propertyRepository';

const PROPERTIES_KEY = ['properties'] as const;

export function usePropertiesQuery(status: 'active' | 'archived' = 'active') {
  return useQuery({
    queryKey: [...PROPERTIES_KEY, status],
    queryFn: () => propertyRepository.list(status),
  });
}

export function usePropertyQuery(id: string) {
  return useQuery({
    queryKey: [...PROPERTIES_KEY, id],
    queryFn: () => propertyRepository.getById(id),
    enabled: Boolean(id),
  });
}

export function useCreatePropertyMutation(ownerUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PropertyInput) => propertyRepository.create(input, ownerUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }),
  });
}

export function useArchivePropertyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => propertyRepository.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }),
  });
}
