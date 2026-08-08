import { useRepositories } from '@/data/RepositoryProvider';
import { useRepositoryQuery } from '@/data/useRepositoryQuery';

export function useUnits(propertyId?: string) { const { units } = useRepositories(); return useRepositoryQuery(() => units.list(propertyId), [units, propertyId]); }
export function useUnit(id: string) { const { units } = useRepositories(); return useRepositoryQuery(() => units.getById(id), [units, id]); }
export function useTenants() { const { tenants } = useRepositories(); return useRepositoryQuery(() => tenants.list(), [tenants]); }
export function useTenant(id: string) { const { tenants } = useRepositories(); return useRepositoryQuery(() => tenants.getById(id), [tenants, id]); }
export function useLeases() { const { leases } = useRepositories(); return useRepositoryQuery(() => leases.list(), [leases]); }
export function useLease(id: string) { const { leases } = useRepositories(); return useRepositoryQuery(() => leases.getById(id), [leases, id]); }
export function useAccounting() { const { accounting } = useRepositories(); return useRepositoryQuery(() => accounting.getOverview(), [accounting]); }
export function useOwners() { const { owners } = useRepositories(); return useRepositoryQuery(() => owners.list(), [owners]); }
export function useOwner(id: string) { const { owners } = useRepositories(); return useRepositoryQuery(() => owners.getById(id), [owners, id]); }
export function useDocuments() { const { documents } = useRepositories(); return useRepositoryQuery(() => documents.list(), [documents]); }
export function useDocument(id: string) { const { documents } = useRepositories(); return useRepositoryQuery(() => documents.getById(id), [documents, id]); }
export function useMaintenance() { const { maintenance } = useRepositories(); return useRepositoryQuery(() => maintenance.list(), [maintenance]); }
export function useMaintenanceTicket(id: string) { const { maintenance } = useRepositories(); return useRepositoryQuery(() => maintenance.getById(id), [maintenance, id]); }
export function useInspections() { const { inspections } = useRepositories(); return useRepositoryQuery(() => inspections.list(), [inspections]); }
export function useInspection(id: string) { const { inspections } = useRepositories(); return useRepositoryQuery(() => inspections.getById(id), [inspections, id]); }
export function useMeters() { const { meters } = useRepositories(); return useRepositoryQuery(() => meters.list(), [meters]); }
export function useReports() { const { reports } = useRepositories(); return useRepositoryQuery(() => reports.list(), [reports]); }
export function useNotifications() { const { notifications } = useRepositories(); return useRepositoryQuery(() => notifications.list(), [notifications]); }
export function useNotificationPreferences() { const { notifications } = useRepositories(); return useRepositoryQuery(() => notifications.getPreferences(), [notifications]); }

export function usePortfolioActions() {
  const repositories = useRepositories();
  return {
    createLease: repositories.leases.create.bind(repositories.leases),
    beginDocumentUpload: repositories.documents.beginUpload.bind(repositories.documents),
    reviewDocumentExtraction: repositories.documents.reviewExtraction.bind(repositories.documents),
    createMaintenance: repositories.maintenance.create.bind(repositories.maintenance),
    createInspection: repositories.inspections.create.bind(repositories.inspections),
    addMeterReading: repositories.meters.add.bind(repositories.meters),
    requestReportExport: repositories.reports.requestExport.bind(repositories.reports),
    markNotificationRead: repositories.notifications.markRead.bind(repositories.notifications),
    saveNotificationPreferences: repositories.notifications.updatePreferences.bind(repositories.notifications),
  };
}
