import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppearanceSettings } from './appearance-settings';
import { OrganizationSettings } from './organization-settings';
import { ProfileSettings } from './profile-settings';
import { TeamSettings } from './team-settings';
import { NotificationPreferences } from './notification-preferences';
import { Bell, Building2, KeyRound, Palette, User, UsersRound } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { LicenseSettings } from './license-settings';

const tabs = [
  { value: 'organization', label: 'Organization', icon: Building2 },
  { value: 'profile', label: 'Profile', icon: User },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'team', label: 'Team', icon: UsersRound },
  { value: 'team', label: 'Team', icon: UsersRound },
  { value: 'license', label: 'License', icon: KeyRound },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  // The License tab is for the owner. The API enforces it too (license:read).
  const visibleTabs = tabs.filter((t) => t.value !== 'license' || can('license:read'));
  const requested = params.get('tab');
  const active = visibleTabs.find((t) => t.value === requested)?.value ?? 'organization';
  return (
    <>
      <PageHeader title="Settings" description="Manage your organization, profile and team." />
      <Tabs value={active} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="gap-6">
        <div className="overflow-x-auto">
          <TabsList>
            {visibleTabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-2">
                <Icon className="size-4" aria-hidden /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="organization"><OrganizationSettings /></TabsContent>
        <TabsContent value="profile"><ProfileSettings /></TabsContent>
        <TabsContent value="appearance"><AppearanceSettings /></TabsContent>
        <TabsContent value="team"><TeamSettings /></TabsContent>
        <TabsContent value="notifications"><NotificationPreferences /></TabsContent>
        {can('license:read') && <TabsContent value="license"><LicenseSettings /></TabsContent>}
      </Tabs>
    </>
  );
}