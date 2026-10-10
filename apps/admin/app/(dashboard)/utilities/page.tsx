import { PageHeader } from '@/components/ui/PageHeader';
import { UtilitiesPortfolio } from '@/components/smartUtility/UtilitiesPortfolio';

/**
 * GET /utilities — portfolio view of water & electricity across every property the user can read
 * (docs/HYBRID_UTILITIES_ARCHITECTURE.md §G). Data comes from /api/v1/utilities/portfolio on the user's session (RLS).
 */
export default function UtilitiesPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Utilities" subtitle="Water and electricity across your portfolio: alerts, charges waiting for approval and unpaid utility invoices" />
      <UtilitiesPortfolio />
    </div>
  );
}
