import { useQuery } from '@tanstack/react-query';
import { useRepositories } from '@/data/RepositoryProvider';

export function useCurrentOrgId() {
  const { organizations } = useRepositories();
  return useQuery({ queryKey: ['mobile-current-organization'], queryFn: async () => (await organizations.getCurrent())?.id ?? null });
}
