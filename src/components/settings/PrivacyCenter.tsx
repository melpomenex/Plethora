/**
 * Privacy Center (Change C §4.1).
 *
 * Renders every entry of the canonical disclosure registry
 * (`src/lib/privacy/disclosureRegistry.ts`) grouped by category, with the
 * per-disclosure egress facts users need: what leaves the device, where it
 * goes, retention, encryption, third parties, whether it is user-deletable,
 * and the local fallback. Also surfaces the Local-Only shield explanation and
 * a "re-show the cloud-AI disclosure" control.
 *
 * Data comes straight from the registry so the Privacy Center can never drift
 * from what the App Store labels and docs claim (enforced by tests).
 */

import { useMemo, useState } from "react";
import {
  CloudArrowUp,
  Eye,
  Lock,
  Shield,
} from "@phosphor-icons/react";
import {
  getAllDisclosures,
  getDisclosure,
} from "../../lib/privacy/disclosureRegistry";
import {
  getAcknowledgedProviderClass,
  resetCloudAiDisclosure,
} from "../../lib/privacy/cloudAiDisclosure";
import type { PrivacyDisclosure } from "../../types/privacy";

const CATEGORY_ORDER = ["core", "ai", "sync", "media", "integrations", "telemetry"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core Processing",
  ai: "AI & Intelligence",
  sync: "Sync & Backup",
  media: "Audio & Media",
  integrations: "Integrations",
  telemetry: "Telemetry & Diagnostics",
};

const ENCRYPTION_LABELS: Record<PrivacyDisclosure["encryptionState"], string> = {
  none_local_only: "No egress (local only)",
  in_transit_tls: "Encrypted in transit (TLS)",
  stored_encrypted: "Encrypted at rest + in transit",
  e2e_encrypted: "End-to-end encrypted",
};

const TRIGGER_LABELS: Record<PrivacyDisclosure["trigger"], string> = {
  never: "Never",
  manual: "Only when you act",
  opt_in: "Opt-in (off by default)",
  automatic: "Automatic",
  scheduled: "On a schedule",
};

function EgressBadge({ d }: { d: PrivacyDisclosure }) {
  if (!d.dataLeavesDevice) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <Lock className="w-3 h-3" /> Nothing leaves your device
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400">
      <CloudArrowUp className="w-3 h-3" /> Leaves device — {TRIGGER_LABELS[d.trigger].toLowerCase()}
    </span>
  );
}

function DisclosureCard({ d }: { d: PrivacyDisclosure }) {
  return (
    <div className="p-4 bg-card border rounded-lg space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{d.name}</h4>
        <EgressBadge d={d} />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{d.description}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <dt className="inline text-muted-foreground">Destination: </dt>
          <dd className="inline text-foreground">{d.destination}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Protection: </dt>
          <dd className="inline text-foreground">{ENCRYPTION_LABELS[d.encryptionState]}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Retention: </dt>
          <dd className="inline text-foreground">{d.retention}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Third parties: </dt>
          <dd className="inline text-foreground">{d.thirdPartyInvolvement}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">You can delete it: </dt>
          <dd className="inline text-foreground">{d.userDeletable ? "Yes" : "No (see note)"}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Local alternative: </dt>
          <dd className="inline text-foreground">{d.localFallback}</dd>
        </div>
      </dl>
      {!d.userDeletable && d.dataLeavesDevice && (
        <p className="text-xs text-muted-foreground italic">
          This record cannot be deleted on request because it is required for accounting or
          service integrity; it contains no document or reading content.
        </p>
      )}
    </div>
  );
}

export function PrivacyCenter() {
  const disclosures = useMemo(() => getAllDisclosures(), []);
  const grouped = useMemo(() => {
    const map = new Map<string, PrivacyDisclosure[]>();
    for (const d of disclosures) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c)!,
    }));
  }, [disclosures]);

  const [ackClass, setAckClass] = useState<string | null>(getAcknowledgedProviderClass());
  const localOnlyDoc = getDisclosure("cloud_sync");

  return (
    <div className="space-y-6" data-testid="privacy-center">
      {/* Local-Only shield explainer */}
      <div className="p-6 bg-card border rounded-lg space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Local-Only Shield</h3>
            <p className="text-sm text-muted-foreground">Per-document protection against any cloud egress</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Mark any document Local-Only (item details → &ldquo;Local-Only Shield&rdquo;) and every cloud
          pathway — sync, AI, OCR, text-to-speech, transcription — automatically diverts to on-device
          algorithms. The document never leaves this device, regardless of your other settings.
        </p>
      </div>

      {/* Cloud-AI disclosure state */}
      <div className="p-6 bg-card border rounded-lg space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Eye className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Cloud AI Disclosure</h3>
            <p className="text-sm text-muted-foreground">What happens the first time content is sent to a cloud provider</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {ackClass
            ? `Acknowledged for the "${ackClass === "plethora-hosted" ? "Plethora-hosted" : "bring-your-own-key"}" provider class. Switching provider class will re-show it once.`
            : "Not shown yet — it will appear the first time you use a cloud AI feature."}
        </p>
        <button
          onClick={() => {
            resetCloudAiDisclosure();
            setAckClass(null);
          }}
          className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg text-sm font-medium transition-colors"
        >
          Reset — ask me again before cloud AI use
        </button>
      </div>

      {/* Full registry, grouped by category */}
      {grouped.map(({ category, items }) => (
        <div key={category} className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">{CATEGORY_LABELS[category] ?? category}</h3>
          <div className="space-y-3">
            {items.map((d) => (
              <DisclosureCard key={d.id} d={d} />
            ))}
          </div>
        </div>
      ))}

      {localOnlyDoc && (
        <p className="text-xs text-muted-foreground">
          This center is generated from the same registry that powers the App Store privacy labels
          ({disclosures.length} disclosures) and the published privacy architecture document — they
          cannot disagree.
        </p>
      )}
    </div>
  );
}
