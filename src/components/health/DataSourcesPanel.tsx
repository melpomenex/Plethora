import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, DeviceMobile, Heartbeat } from "@phosphor-icons/react";
import { healthApi } from "../../api/health";
import { isTauri, listen } from "../../lib/tauri";
import { useHealthStore } from "../../stores/healthStore";
import type { HealthConnection, HealthConsentRecord, HealthDataCategory, HealthImportFormat, HealthProviderInfo, HealthProviderId, HealthSourcePreference } from "../../types/health";
import { Button } from "../md3/Button";
import { SettingsSearchTarget } from "../settings/search/SettingsSearchNavigation";
import { HealthDialog } from "./HealthDialog";
import { ManualSleepDialog } from "./ManualSleepDialog";
import { healthError } from "./healthFormat";
import "./health.css";

const categories: Record<HealthDataCategory, string> = {
  sleep: "Sleep times", sleep_stages: "Sleep stages", heart_rate: "Heart rate",
  resting_heart_rate: "Resting heart rate", hrv: "Heart rate variability",
  activity: "Activity", recovery: "Recovery", temperature: "Temperature",
  respiratory_rate: "Respiratory rate",
};

const readiness: Record<HealthProviderInfo["readinessState"], string> = {
  available: "Available", not_configured: "Not configured",
  requires_developer_approval: "Requires developer approval", requires_user_authorization: "Ready to connect",
  connected: "Connected", synchronizing: "Syncing", rate_limited: "Rate limited",
  temporarily_unavailable: "Temporarily unavailable", permission_revoked: "Access revoked",
  unsupported: "Unsupported", feature_disabled_compliance: "Unavailable in this build",
};

function isProviderReady(provider: HealthProviderInfo) {
  return provider.readinessState === "requires_user_authorization" || provider.readinessState === "permission_revoked";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="health-section"><h3>{title}</h3>{children}</section>;
}

type ConfirmDialog = { kind: "wipe" } | { kind: "disconnect" | "eraseProvider"; provider: HealthProviderInfo };
type DialogState = { kind: "manual" | "importEncrypted" | "exportEncrypted" }
  | { kind: "connect"; provider: HealthProviderInfo }
  | ConfirmDialog;

export function DataSourcesPanel({ settings = false }: { settings?: boolean }) {
  const invalidate = useHealthStore((state) => state.invalidate);
  const revision = useHealthStore((state) => state.revision);
  const wipe = useHealthStore((state) => state.wipe);
  const [providers, setProviders] = useState<HealthProviderInfo[]>([]);
  const [connections, setConnections] = useState<HealthConnection[]>([]);
  const [preferences, setPreferences] = useState<HealthSourcePreference[]>([]);
  const [receipts, setReceipts] = useState<HealthConsentRecord[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    Promise.all([healthApi.listProviders(), healthApi.getConnections(), healthApi.getSourcePreferences(), healthApi.getConsentLog()])
      .then(([catalog, links, order, log]) => {
        if (!active) return;
        setProviders(catalog);
        setConnections(links);
        setPreferences(order);
        setReceipts(log);
      }).catch((cause) => { if (active) setError(healthError(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    if (!isTauri()) return;
    const subscription = listen<{ providerId: HealthProviderId; error: string | null }>("health-provider-changed", ({ payload }) => {
      if (payload.error) setError(payload.error);
      else setNotice("Provider connected. Sync now to import available records.");
      invalidate();
    });
    void subscription.catch(() => {});
    return () => { void subscription.then((unlisten) => unlisten()).catch(() => {}); };
  }, [invalidate]);

  async function run(operation: () => Promise<string | undefined>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await operation();
      if (message) setNotice(message);
      setDialog(null);
      invalidate();
    } catch (cause) {
      setError(healthError(cause));
      invalidate();
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) return <p className="health-empty"><DeviceMobile size={24} /> Open the native app to manage the local Health Vault.</p>;

  const sleepOrder = preferences.find((preference) => preference.category === "sleep");
  const order = Array.from(new Set([
    ...(sleepOrder?.orderedProviderIds ?? []),
    ...providers.filter((provider) => provider.category !== "aggregator_bridged").map((provider) => provider.id),
  ]));

  async function moveSource(index: number, direction: number) {
    const updated = order.slice();
    const moved = updated[index];
    updated[index] = updated[index + direction];
    updated[index + direction] = moved;
    await healthApi.setSourcePreferences({ category: "sleep", orderedProviderIds: updated, updatedAtMs: Date.now() });
    return "Source priority saved.";
  }

  function importFile(format: HealthImportFormat) {
    return run(async () => {
      const result = await healthApi.importFile(format);
      return result ? `Imported ${result.sleepImported} sleep entries and ${result.physioImported} measurements.` : undefined;
    });
  }

  async function connect(provider: HealthProviderInfo, values: HealthDataCategory[], history: boolean) {
    if (provider.category === "native_mobile") {
      const report = await healthApi.connectNative(provider.id, values, history);
      return report.warnings[0] ?? `Imported ${report.sleepUpserts} sleep entries.`;
    }
    await healthApi.connectCloud(provider.id);
    return "Finish signing in with the provider in your browser.";
  }

  const renderConfirm = (selection: ConfirmDialog) => {
    const isWipe = selection.kind === "wipe";
    const disconnect = selection.kind === "disconnect";
    const provider = isWipe ? null : selection.provider;
    const title = isWipe ? "Delete all health data?" : disconnect
      ? `Disconnect ${provider.displayName}?` : `Delete data from ${provider.displayName}?`;
    return (
      <HealthDialog title={title} onClose={() => setDialog(null)}>
        <p>{disconnect
          ? "You can keep the imported records and stop future syncs. Revoke access in the provider’s app to remove its authorization."
          : "This permanently removes the selected records from the local Health Vault. Exported copies are managed separately."}</p>
        {error && <p role="alert" className="health-error">{error}</p>}
        <div className="health-actions">
          <Button autoFocus variant="text" onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant={disconnect ? "filled" : "destructive"} disabled={busy} onClick={() => void run(async () => {
            if (isWipe) await wipe();
            else if (disconnect) await healthApi.disconnectProvider(provider.id);
            else await healthApi.deleteProviderData(provider.id);
            return disconnect ? "Provider disconnected. Imported records are still available." : "Health records deleted.";
          })}>{disconnect ? "Disconnect provider" : "Delete data"}</Button>
        </div>
      </HealthDialog>
    );
  };

  return (
    <div className="health-sources">
      {settings && <h2 className="health-title">Health &amp; Wearables</h2>}
      {loading && <p role="status">Loading health sources…</p>}
      {error && !dialog && <p role="alert" className="health-error">{error}</p>}
      {notice && <p role="status" className="health-notice">{notice}</p>}
      <SettingsSearchTarget id="integrations.health.local"><Section title="Local sleep data">
        <p>Log sleep by hand or import a file to the Health Vault on this device.</p>
        <div className="health-actions health-actions-start">
          <Button variant="filled" onClick={() => setDialog({ kind: "manual" })}>Log sleep</Button>
          <Button variant="tonal" disabled={busy} onClick={() => void importFile("csv")}>Import CSV</Button>
          <Button variant="tonal" disabled={busy} onClick={() => void importFile("json")}>Import JSON</Button>
          <Button variant="tonal" disabled={busy} onClick={() => void importFile("apple_health_xml")}>Import Apple Health XML</Button>
        </div>
      </Section></SettingsSearchTarget>
      <SettingsSearchTarget id="integrations.health.providers"><Section title="Wearable connections">
        <ul className="health-provider-list">
          {providers.filter((provider) => provider.category !== "local_import" && provider.category !== "local_manual").map((provider) => {
            const connection = connections.find((link) => link.providerId === provider.id);
            const native = provider.category === "native_mobile";
            return (
              <li key={provider.id} className="health-provider">
                <div>
                  <h4><Heartbeat size={17} aria-hidden="true" />{provider.displayName}</h4>
                  <p><strong>{readiness[provider.readinessState]}</strong> · {provider.readinessReason}</p>
                  {connection?.historyLimitDays && <p>Up to {connection.historyLimitDays} days of history with current access.</p>}
                  {connection?.authState === "partially_authorized" && <p>Only some requested categories were granted.</p>}
                  {connection?.lastErrorMessage && <p className="health-error">{connection.lastErrorMessage}</p>}
                </div>
                <div className="health-actions">
                  {isProviderReady(provider) && <Button variant="tonal" disabled={busy}
                    onClick={() => { setError(""); setDialog({ kind: "connect", provider }); }}>Connect</Button>}
                  {connection && connection.status !== "permission_revoked" && <Button variant="tonal" disabled={busy}
                    onClick={() => void run(async () => {
                      const report = await healthApi.syncProvider(provider.id, native);
                      return report.warnings[0] ?? `Synced ${report.sleepUpserts} sleep entries and ${report.physioUpserts} measurements.`;
                    })}>Sync now</Button>}
                  {connection && <Button variant="text" disabled={busy}
                    onClick={() => setDialog({ kind: "disconnect", provider })}>Disconnect</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      </Section></SettingsSearchTarget>
      <SettingsSearchTarget id="integrations.health.priority"><Section title="Sleep source priority">
        <p>When sources overlap, the highest-ranked source supplies the primary sleep record.</p>
        <ol className="health-order">
          {order.map((id, i) => {
            const name = providers.find((provider) => provider.id === id)?.displayName ?? id;
            return <li key={id}><span>{i + 1}. {name}</span><div className="health-actions">
              <Button variant="text" aria-label={`Move ${name} up`} disabled={busy || i === 0} onClick={() => void run(() => moveSource(i, -1))}><ArrowUp size={16} /></Button>
              <Button variant="text" aria-label={`Move ${name} down`} disabled={busy || i === order.length - 1} onClick={() => void run(() => moveSource(i, 1))}><ArrowDown size={16} /></Button>
            </div></li>;
          })}
        </ol>
      </Section></SettingsSearchTarget>
      <SettingsSearchTarget id="integrations.health.transfer"><Section title="Health file transfer">
        <p>Choose an export location. An encrypted bundle requires a passphrase to open.</p>
        <div className="health-actions health-actions-start">
          <Button variant="tonal" disabled={busy} onClick={() => void run(async () => (await healthApi.exportJson()) ? "JSON export saved." : undefined)}>Export JSON</Button>
          <Button variant="tonal" disabled={busy} onClick={() => { setError(""); setDialog({ kind: "exportEncrypted" }); }}>Export encrypted bundle</Button>
          <Button variant="tonal" disabled={busy} onClick={() => { setError(""); setDialog({ kind: "importEncrypted" }); }}>Import encrypted bundle</Button>
        </div>
      </Section></SettingsSearchTarget>
      <SettingsSearchTarget id="integrations.health.privacy"><Section title="Health privacy and deletion">
        <p>Health observations are stored separately from your library and stay out of Plethora sync, library backups, and AI prompts.</p>
        <details><summary>View consent history</summary>
          {receipts.length === 0 ? <p>No consent records yet.</p> : <ul className="health-consent-list">
            {receipts.map((receipt) => <li key={receipt.id}>
              <time dateTime={new Date(receipt.recordedAtMs).toISOString()}>{new Date(receipt.recordedAtMs).toLocaleString()}</time>
              {" · "}{providers.find((provider) => provider.id === receipt.providerId)?.displayName ?? receipt.providerId} · {receipt.action.replaceAll("_", " ")}
            </li>)}
          </ul>}
        </details>
        <div className="health-actions health-actions-start">
          {providers.filter((provider) => connections.some((link) => link.providerId === provider.id) ||
            receipts.some((receipt) => receipt.providerId === provider.id && receipt.action === "connect")).map((provider) =>
            <Button key={provider.id} variant="text" disabled={busy} onClick={() => { setError(""); setDialog({ kind: "eraseProvider", provider }); }}>Delete data from {provider.displayName}</Button>
          )}
          <Button variant="outlined" disabled={busy} onClick={() => { setError(""); setDialog({ kind: "wipe" }); }}>Delete all health data</Button>
        </div>
      </Section></SettingsSearchTarget>

      {dialog?.kind === "manual" && <ManualSleepDialog onClose={() => setDialog(null)} onSaved={() => {
        setDialog(null); setNotice("Sleep entry saved."); invalidate();
      }} />}
      {dialog?.kind === "connect" && <ConsentDialog provider={dialog.provider} busy={busy} error={error}
        onClose={() => setDialog(null)} onConfirm={(scope, history) => void run(() => connect(dialog.provider, scope, history))} />}
      {dialog && (dialog.kind === "importEncrypted" || dialog.kind === "exportEncrypted") &&
        <PassphraseDialog exporting={dialog.kind === "exportEncrypted"} busy={busy} error={error} onClose={() => setDialog(null)}
          onSubmit={(passphrase) => void run(async () => {
            if (dialog.kind === "exportEncrypted") return (await healthApi.exportEncryptedBundle(passphrase)) ? "Encrypted export saved." : undefined;
            const result = await healthApi.importEncryptedBundle(passphrase);
            return result ? `Imported ${result.sleepImported} sleep entries from the encrypted bundle.` : undefined;
          })} />}
      {dialog && (dialog.kind === "wipe" || dialog.kind === "disconnect" || dialog.kind === "eraseProvider") && renderConfirm(dialog)}
    </div>
  );
}

function ConsentDialog({ provider, busy, error, onClose, onConfirm }: {
  provider: HealthProviderInfo;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (values: HealthDataCategory[], history: boolean) => void;
}) {
  const native = provider.category === "native_mobile";
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<HealthDataCategory[]>(() =>
    provider.supportedCategories.includes("sleep") ? ["sleep"] : []);
  const [history, setHistory] = useState(false);
  return (
    <HealthDialog title={`Connect ${provider.displayName}`} onClose={onClose}>
      {step === 1 ? <>
        <p>Plethora uses the sleep and activity you share to show your history and compare it with study activity on this device.</p>
        <p>{native ? "Your phone will ask for read permission." : "The authorization broker exchanges sign-in codes and tokens. Health records are downloaded directly to your device."}</p>
      </> : <fieldset className="health-choice-list">
        <legend>{native ? "Choose data to share" : "Data covered by the provider connection"}</legend>
        {provider.supportedCategories.map((category) => native
          ? <label key={category}><input type="checkbox" checked={selected.includes(category)}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, category] : current.filter((value) => value !== category))} /> {categories[category]}</label>
          : <span key={category}>{categories[category]}</span>)}
        {provider.id === "android_health_connect" && <label><input type="checkbox" checked={history}
          onChange={(e) => setHistory(e.target.checked)} /> Request history older than 30 days</label>}
      </fieldset>}
      {error && <p role="alert" className="health-error">{error}</p>}
      <div className="health-actions">
        <Button variant="text" onClick={onClose}>Cancel</Button>
        {step === 1 ? <Button variant="filled" onClick={() => setStep(2)}>Continue</Button>
          : <Button variant="filled" disabled={busy || (native && selected.length === 0)}
          onClick={() => onConfirm(native ? selected : provider.supportedCategories, history)}>Authorize</Button>}
      </div>
    </HealthDialog>
  );
}

function PassphraseDialog({ exporting, busy, error, onClose, onSubmit }: {
  exporting: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(passphrase);
  }
  return (
    <HealthDialog title={exporting ? "Export encrypted bundle" : "Import encrypted bundle"} onClose={onClose}>
      <form className="health-form" onSubmit={submit}>
        <label>Bundle passphrase
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required
            autoComplete={exporting ? "new-password" : "off"} minLength={exporting ? 8 : 1} />
        </label>
        {exporting && <p>Use at least eight characters. Keep the passphrase so you can open this bundle later.</p>}
        {error && <p role="alert" className="health-error">{error}</p>}
        <div className="health-actions">
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button variant="filled" type="submit" disabled={busy}>{exporting ? "Choose where to save" : "Choose encrypted file"}</Button>
        </div>
      </form>
    </HealthDialog>
  );
}
