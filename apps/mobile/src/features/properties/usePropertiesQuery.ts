import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PropertyInput } from '@propvault/validation';
import { propertyRepository } from './propertyRepository';
import { DEMO_MODE } from '@/lib/supabase';
import { useDemoStore } from '@/demo/demoStore';

const PROPERTIES_KEY = ['properties'] as const;

/**
 * Every hook here branches on the module-level DEMO_MODE constant (never changes mid-render, so
 * this is a stable hook-order branch, not a rules-of-hooks violation). In demo mode, screens
 * read straight from the reactive Zustand demo store; otherwise they go through TanStack Query
 * + the real Supabase-backed repository — same call sites either way.
 */
export function usePropertiesQuery(status: 'active' | 'archived' = 'active') {
  const demoProperties = useDemoStore((s) => s.properties);
  const query = useQuery({
    queryKey: [...PROPERTIES_KEY, status],
    queryFn: () => propertyRepository.list(status),
    enabled: !DEMO_MODE,
  });

  if (DEMO_MODE) {
    return {
      ...query,
      data: demoProperties.filter((p) => p.status === status),
      isLoading: false,
      isError: false,
    };
  }
  return query;
}

export function usePropertyQuery(id: string) {
  const demoProperty = useDemoStore((s) => s.properties.find((p) => p.id === id) ?? null);
  const query = useQuery({
    queryKey: [...PROPERTIES_KEY, id],
    queryFn: () => propertyRepository.getById(id),
    enabled: !DEMO_MODE && Boolean(id),
  });

  if (DEMO_MODE) {
    return { ...query, data: demoProperty, isLoading: false, isError: !demoProperty };
  }
  return query;
}

export function useCreatePropertyMutation(ownerUserId: string) {
  const queryClient = useQueryClient();
  const addDemoProperty = useDemoStore((s) => s.addProperty);
  return useMutation({
    mutationFn: async (input: PropertyInput) => {
      if (DEMO_MODE) return addDemoProperty(input);
      return propertyRepository.create(input, ownerUserId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }),
  });
}

export function useArchivePropertyMutation() {
  const queryClient = useQueryClient();
  const archiveDemoProperty = useDemoStore((s) => s.archiveProperty);
  return useMutation({
    mutationFn: async (id: string) => {
      if (DEMO_MODE) return archiveDemoProperty(id);
      return propertyRepository.archive(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROPERTIES_KEY }),
  });
}
