import { redirect } from 'next/navigation';

// The bare /platform-admin path has no dashboard of its own -- every real page lives one segment
// deeper (overview, customers, system, ...). Authentication/AAL2-MFA is already fully enforced by
// the (super-admin) layout this page renders under, before this component ever runs -- this file
// only supplies the missing destination for the segment itself, so it stops 404ing.
export default function PlatformAdminIndexPage() {
  redirect('/platform-admin/overview');
}
