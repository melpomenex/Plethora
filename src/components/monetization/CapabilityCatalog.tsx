import React from 'react';
import { PRO_FEATURES_CATALOG } from '../../types/paywall';
import { useCapability } from '../../hooks/useCapability';

export const CapabilityCatalog: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="border-b border-border-subtle pb-4">
        <h3 className="text-lg font-bold text-fg-default">Plethora Pro Capabilities</h3>
        <p className="text-sm text-fg-muted">
          All local features (reading, local OCR, local audio, full-text search, FSRS review) remain 100% free forever.
          Pro unlocks server-side AI augmentations and end-to-end encrypted cloud sync.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PRO_FEATURES_CATALOG.map((feature) => (
          <CapabilityCard key={feature.capabilityId} feature={feature} />
        ))}
      </div>
    </div>
  );
};

const CapabilityCard: React.FC<{ feature: (typeof PRO_FEATURES_CATALOG)[0] }> = ({ feature }) => {
  const { enabled, reason } = useCapability(feature.capabilityId);

  return (
    <div className="p-4 border border-border-default rounded-xl bg-bg-elevated flex flex-col justify-between space-y-3">
      <div>
        <div className="flex justify-between items-start gap-2 mb-1">
          <h4 className="font-semibold text-fg-default text-sm">{feature.title}</h4>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              enabled
                ? 'bg-success-muted text-success-fg'
                : 'bg-bg-subtle text-fg-muted border border-border-subtle'
            }`}
          >
            {enabled ? 'Active' : reason || 'Pro'}
          </span>
        </div>
        <p className="text-xs text-fg-muted leading-relaxed">{feature.description}</p>
      </div>

      <div className="text-xs text-fg-subtle pt-2 border-t border-border-subtle flex justify-between">
        <span>Allowance:</span>
        <span className="font-medium text-fg-muted">{feature.quotaWindow}</span>
      </div>
    </div>
  );
};
