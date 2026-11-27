import { apiRequest } from '@/lib/api-client';
import type { LicenseOverview, LicenseStatus } from '@/types/license';

export const licenseService = {
  status: (signal?: AbortSignal) => apiRequest<LicenseStatus>('/licenses/status', { signal }),
  current: (signal?: AbortSignal) => apiRequest<LicenseOverview>('/licenses/current', { signal }),
  activate: (licenseKey: string) => apiRequest<LicenseOverview>('/licenses/activate', { method: 'POST', body: { licenseKey } }),
  deactivate: () => apiRequest<LicenseOverview>('/licenses/deactivate', { method: 'POST' }),
};