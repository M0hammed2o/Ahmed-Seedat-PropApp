'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { NotificationCategory, Organization } from '@propvault/types';
import { NOTIFICATION_CATEGORIES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';

// Overnight platform pass (WORKLOG.md this date), Phases 5-6: a single, clearly-grouped
// "Communication" section rather than folding these fields into the existing registration/tax
// OrganizationSettingsForm (task brief: "do not build a confusing giant settings screen"). Two
// related but distinct things live here: (1) the branding shown inside outbound email/WhatsApp
// templates (organizations.support_contact_name/support_phone/support_email/
// communication_footer, PATCH /api/v1/organizations/:orgId), and (2) the per-category channel
// policy (organization_notification_settings, PUT .../notification-settings) --
// dispatchEmail()/dispatchWhatsApp() both now check this before the per-user preference.

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  rent: 'Rent reminders & statements',
  maintenance: 'Maintenance updates',
  lease: 'Lease notices',
  inspections: 'Inspections',
  announcements: 'Announcements',
  security: 'Security alerts',
  promotional: 'Promotional',
  owner_summary: 'Monthly property summary',
};

interface CategorySetting {
  category: NotificationCategory;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export function CommunicationPreferencesPanel({
  orgId,
  organization,
}: {
  orgId: string;
  organization: Organization;
}) {
  const [supportContactName, setSupportContactName] = useState(
    organization.supportContactName ?? '',
  );
  const [supportPhone, setSupportPhone] = useState(organization.supportPhone ?? '');
  const [supportEmail, setSupportEmail] = useState(organization.supportEmail ?? '');
  const [communicationFooter, setCommunicationFooter] = useState(
    organization.communicationFooter ?? '',
  );
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);

  const [settings, setSettings] = useState<CategorySetting[] | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const res = await fetch(`/api/v1/organizations/${orgId}/notification-settings`);
    const body = await safeJson(res);
    setSettings(
      body.settings ??
        NOTIFICATION_CATEGORIES.map((category) => ({
          category,
          emailEnabled: true,
          whatsappEnabled: false,
        })),
    );
  }, [orgId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function saveBranding(e: FormEvent) {
    e.preventDefault();
    setBrandingSaving(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      const response = await fetch(`/api/v1/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supportContactName: supportContactName || null,
          supportPhone: supportPhone || null,
          supportEmail: supportEmail || null,
          communicationFooter: communicationFooter || null,
        }),
      });
      const body = await safeJson(response);
      if (!response.ok) {
        setBrandingError(body.error?.message ?? 'Failed to save communication branding.');
        return;
      }
      setBrandingSaved(true);
    } finally {
      setBrandingSaving(false);
    }
  }

  function toggle(category: NotificationCategory, channel: 'emailEnabled' | 'whatsappEnabled') {
    setSettings((prev) =>
      (prev ?? []).map((s) => (s.category === category ? { ...s, [channel]: !s[channel] } : s)),
    );
  }

  async function saveSettings() {
    if (!settings) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch(`/api/v1/organizations/${orgId}/notification-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (!response.ok) {
        const body = await safeJson(response);
        setSettingsError(body.error?.message ?? 'Failed to save channel preferences.');
        return;
      }
      await loadSettings();
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Communication branding"
        description="Shown inside emails and WhatsApp messages sent to tenants and owners, since WhatsApp uses one shared Proplyst number across every organization."
      >
        <form onSubmit={saveBranding} className="max-w-lg space-y-3">
          {brandingError ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {brandingError}
            </p>
          ) : null}
          <label className="block text-xs">
            <span className="text-muted-foreground">Support contact name</span>
            <input
              value={supportContactName}
              onChange={(e) => setSupportContactName(e.target.value)}
              placeholder="e.g. Ahmed Seedat"
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Support phone</span>
            <input
              value={supportPhone}
              onChange={(e) => setSupportPhone(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Support email</span>
            <input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Message footer (optional)</span>
            <textarea
              value={communicationFooter}
              onChange={(e) => setCommunicationFooter(e.target.value)}
              rows={2}
              maxLength={500}
              className={inputClass}
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" size="sm" disabled={brandingSaving}>
              {brandingSaving ? 'Saving…' : 'Save branding'}
            </Button>
            {brandingSaved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
          </div>
        </form>
      </Panel>

      <Panel
        title="Notification channels"
        description="Choose which channels each type of message may use. A recipient's own preferences can narrow this further, never widen it."
      >
        {settingsError ? (
          <p className="mb-3 rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {settingsError}
          </p>
        ) : null}
        {!settings ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Category</th>
                    <th className="py-1.5 pr-3 font-medium">Email</th>
                    <th className="py-1.5 pr-3 font-medium">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.map((s) => (
                    <tr
                      key={s.category}
                      className="border-t border-light-border dark:border-dark-border"
                    >
                      <td className="py-1.5 pr-3 text-foreground">{CATEGORY_LABELS[s.category]}</td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="checkbox"
                          checked={s.emailEnabled}
                          onChange={() => toggle(s.category, 'emailEnabled')}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="checkbox"
                          checked={s.whatsappEnabled}
                          onChange={() => toggle(s.category, 'whatsappEnabled')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              disabled={settingsSaving}
              onClick={saveSettings}
            >
              {settingsSaving ? 'Saving…' : 'Save channel preferences'}
            </Button>
          </>
        )}
      </Panel>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
