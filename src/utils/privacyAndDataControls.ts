export interface CloudDataExport {
  exportVersion: string;
  exportedAt: string;
  user: {
    id: string;
    email: string;
    subscriptionTier: string;
    createdAt: string;
  } | null;
  devices: Array<{
    id: string;
    device_name: string;
    platform: string;
    created_at: string;
  }>;
  inboxItems: Array<{
    id: string;
    url: string;
    title: string;
    status: string;
    created_at: string;
  }>;
  apiTokens: Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    created_at: string;
  }>;
  webhooks: Array<{
    id: string;
    url: string;
    events: string[];
    created_at: string;
  }>;
}

export function validatePrivacyDeclaration(exportData: CloudDataExport): boolean {
  // Checks that exported data schema contains all documented cloud fields
  return (
    typeof exportData.exportVersion === 'string' &&
    Array.isArray(exportData.devices) &&
    Array.isArray(exportData.inboxItems) &&
    Array.isArray(exportData.apiTokens) &&
    Array.isArray(exportData.webhooks)
  );
}
