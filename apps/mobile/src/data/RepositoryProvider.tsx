import React, { createContext, useContext, useMemo } from 'react';
import type { MobileRepositories } from './contracts';
import { createMockRepositories } from './mock/createMockRepositories';

const RepositoryContext = createContext<MobileRepositories | null>(null);

export function RepositoryProvider({
  children,
  repositories,
}: {
  children: React.ReactNode;
  repositories?: MobileRepositories;
}) {
  const value = useMemo(() => repositories ?? createMockRepositories(), [repositories]);
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): MobileRepositories {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('useRepositories must be used inside RepositoryProvider');
  return context;
}
