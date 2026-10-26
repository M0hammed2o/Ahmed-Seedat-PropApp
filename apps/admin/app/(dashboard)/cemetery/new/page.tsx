import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { CemeterySetupForm } from '@/components/cemetery/CemeterySetupForm';
import { getCemeteryContext } from '@/lib/cemetery/access';

export const dynamic = 'force-dynamic';

export default async function NewCemeteryPage() {
  const ctx = await getCemeteryContext();
  if (!ctx || !ctx.canManage) notFound();
  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Set up a cemetery" subtitle="Cemetery → sections / blocks → grave sites. Sites are numbered per section (A-001, A-002…)." />
      <CemeterySetupForm />
    </div>
  );
}
