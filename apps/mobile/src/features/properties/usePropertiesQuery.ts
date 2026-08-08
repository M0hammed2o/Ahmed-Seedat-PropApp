import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PropertyInput } from '@propvault/validation';
import { useRepositories } from '@/data/RepositoryProvider';

const PROPERTIES_KEY = ['mobile-properties'] as const;

export function usePropertiesQuery(status: 'active' | 'archived' = 'active') {
  const { properties } = useRepositories();
  return useQuery({ queryKey: [...PROPERTIES_KEY, status], queryFn: () => properties.list(status) });
}
export function usePropertyQuery(id: string) {
  const { properties } = useRepositories();
  return useQuery({ queryKey: [...PROPERTIES_KEY, id], queryFn: () => properties.getById(id), enabled: Boolean(id) });
}

export function useCreatePropertyMutation(_organizationId?: string) {
  const { properties } = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: PropertyInput) => properties.create(input), onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }) });
}

export function useArchivePropertyMutation() {
  const { properties } = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => properties.archive(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }) });
}
