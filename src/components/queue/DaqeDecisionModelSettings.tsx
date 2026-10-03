import React from "react";
import { Check, Info, Key, Warning } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { cn } from "../../utils";
import {
  CLEF_MODELS,
  CLEF_PROVIDER_ID,
  DECISION_MODEL_OPTIONS,
  JEV_PROVIDER_ID,
  LAYA_PROVIDER_ID,
  OPENAI_DECISIONS_PROVIDER_ID,
  OPENROUTER_DECISION_MODELS,
  OPENROUTER_DECISIONS_PROVIDER_ID,
  baseUrlFor,
  isClefModel,
  isDecisionModelReady,
  isOpenRouterDecisionModel,
  setupGaps,
  type DecisionModelOption,
} from "../../lib/daqe/decisionModelOptions";
import { clearDecisionApiKey, getMaskedApiKey, setDecisionApiKey } from "../../api/ai";
import { buildDecisionClient, decisionKeyProviderFor, selectionFromSettings } from "./daqeDecisionClient";
import {
  probeDecisionModel,
  probeSelectedModel,
  type ProbeResult,
} from "../../lib/daqe/decisionModelProbe";
import { DaqueDecisionModelDownload } from "../settings/DaqueDecisionModelDownload";

/**
 * The one place a decision model is chosen and configured.
 *
 * Mounted from Smart Queue Settings and from the Queue's Customize Session
 * dialog. There is deliberately no second copy: a reader who configured a
 * provider in one place and saw different state in the other would have no way to
 * tell which was true.
 *
 * ## Two things worth knowing before you fill this in
 *
 * **The key goes in the OS keychain, not in settings.** Settings persists to
 * localStorage, so a metered credential stored there would be plaintext. "Save
 * to keychain" writes through the keychain and the field shows a masked value
 * (last four characters) afterwards. Only "is a key set" is persisted.
 *
 * **OpenRouter is one key for two uses.** Its decision models live in the same
 * keychain slot as chat completions, so a key you already configured for chat is
 * reused rather than re-entered.
 *
 * **Downloading is for Laya only.** Jev, Clef and the OpenRouter models are
 * services — somebody else's weights — so there is nothing to fetch. Laya
 * publishes Apache 2.0 weights, and that download appears once Laya is selected.
 */

/**
 * A stand-in for "a key is stored" when building the readiness config.
 *
 * `setupGaps` only asks whether a credential exists, never what it is, so this
 * boolean is all that crosses into that layer. The secret is read from the
 * keychain only when a call is actually made.
 */
const KEY_PRESENT = "stored-in-keychain";

export const DaqeDecisionModelSettings = React.memo(function DaqeDecisionModelSettings({
  /** Re-runs the ranking once the provider changes. Optional: callers that do not
   *  rank simply omit it rather than passing a no-op. */
  onProviderChange,
}: {
  onProviderChange?: () => void;
} = {}) {
  const { t } = useI18n();
  const daqe = useSettingsStore((s) => s.settings.daqe);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);

  const selected = daqe.decisionModelProviderId ?? "none";
  const option = DECISION_MODEL_OPTIONS.find((o) => o.id === selected);

  // Presence only. The secret never enters this component's state beyond the
  // draft below, and never enters the persisted settings object at all.
  const config = React.useMemo(
    () => ({
      apiKey: daqe.decisionApiKeySet ? KEY_PRESENT : undefined,
      baseUrl: daqe.decisionEngine?.baseUrl,
      openrouterModelId: daqe.openrouterDecisionModelId ?? undefined,
      clefModelId: daqe.clefDecisionModelId ?? undefined,
      cloudflareAccountId: daqe.cloudflareAccountId ?? undefined,
      allowRemote: daqe.allowRemoteDecisionModel,
    }),
    [
      daqe.decisionApiKeySet,
      daqe.decisionEngine?.baseUrl,
      daqe.openrouterDecisionModelId,
      daqe.clefDecisionModelId,
      daqe.cloudflareAccountId,
      daqe.allowRemoteDecisionModel,
    ],
  );
  const gaps = React.useMemo(() => setupGaps(selected, config), [selected, config]);
  const ready = gaps.length === 0;

  const keyProvider = React.useMemo(
    () => decisionKeyProviderFor(selected),
    [selected],
  );
  const [draftKey, setDraftKey] = React.useState("");
  const [savingKey, setSavingKey] = React.useState(false);
  const [maskedKey, setMaskedKey] = React.useState<string | null>(null);
  const keyStored = maskedKey !== null || daqe.decisionApiKeySet === true;

  // Ask the keychain what is stored whenever the chosen provider changes. A
  // missing key is not an error: it is the normal state for a provider the reader
  // has chosen but not yet paid for.
  React.useEffect(() => {
    if (!keyProvider) {
      setMaskedKey(null);
      return;
    }
    let cancelled = false;
    void getMaskedApiKey(keyProvider)
      .then((masked) => {
        if (cancelled) return;
        setMaskedKey(masked);
        updateSettingsCategory("daqe", { decisionApiKeySet: masked !== null });
      })
      .catch(() => {
        if (!cancelled) setMaskedKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [keyProvider, updateSettingsCategory]);

  const onSaveKey = React.useCallback(async () => {
    if (!keyProvider || !draftKey.trim()) return;
    setSavingKey(true);
    try {
      const masked = await setDecisionApiKey(keyProvider, draftKey.trim());
      setMaskedKey(masked);
      updateSettingsCategory("daqe", { decisionApiKeySet: masked !== null });
    } catch {
      setMaskedKey(null);
    } finally {
      // Drop the secret from component state either way.
      setDraftKey("");
      setSavingKey(false);
    }
  }, [keyProvider, draftKey, updateSettingsCategory]);

  const onClearKey = React.useCallback(async () => {
    if (!keyProvider) return;
    await clearDecisionApiKey(keyProvider).catch(() => {});
    setMaskedKey(null);
    updateSettingsCategory("daqe", { decisionApiKeySet: false });
  }, [keyProvider, updateSettingsCategory]);

  // ── Connection test ──────────────────────────────────────────────────
  //
  // The picker can only tell whether a field is non-empty. That is a
  // configuration check, not a connection check, and the difference matters: a
  // revoked key looks identical to a good one from here, and the queue would
  // quietly rank by item type instead. So the reader gets an actual round trip.
  const [probing, setProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<ProbeResult | null>(null);

  const runProbe = React.useCallback(async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const daqe = useSettingsStore.getState().settings.daqe;
      const selection = selectionFromSettings(daqe);
      const providerId = selection.providerId;

      if (providerId === "none" || providerId === "spine") {
        setProbeResult({
          outcome: "failed",
          latencyMs: 0,
          error: { reason: "unconfigured", message: "" },
        });
        return;
      }

      // The backend route first. It is the only one that works for a provider
      // without browser CORS — Cloudflare's API answers no preflight, so from the
      // renderer the request dies as `Load failed` before leaving the machine.
      const viaBackend = await probeSelectedModel(providerId, selection.config);
      if (viaBackend) {
        setProbeResult(viaBackend);
        return;
      }

      // No backend (a browser build): fall back to a direct call rather than
      // reporting a connection failure that is really an environment limit.
      const client = await buildDecisionClient(selection);
      if (!client) {
        setProbeResult({
          outcome: "failed",
          latencyMs: 0,
          error: { reason: "unconfigured", message: "" },
        });
        return;
      }
      setProbeResult(await probeDecisionModel(client));
    } catch (error) {
      setProbeResult({
        outcome: "failed",
        latencyMs: 0,
        error: { reason: "unreachable", message: String(error) },
      });
    } finally {
      setProbing(false);
    }
  }, []);

  const setProvider = (id: string) => {
    updateSettingsCategory("daqe", {
      decisionModelProviderId: id === "none" ? null : id,
      // Selecting a remote route does not silently grant the opt-in. That box is
      // the only thing standing between a reader's documents and a network call,
      // so it has to be a deliberate act they can see themselves making.
      allowRemoteDecisionModel:
        id === daqe.decisionModelProviderId ? daqe.allowRemoteDecisionModel : false,
    });
    // A new provider is a new endpoint: any previous result describes something
    // else and would be misleading.
    setProbeResult(null);
    onProviderChange?.();
  };

  const needsEndpoint =
    selected === JEV_PROVIDER_ID ||
    selected === LAYA_PROVIDER_ID ||
    selected === "local-decision-engine";
  const invalid = (field: string) =>
    gaps.includes(field) ? "border-amber-500/70" : undefined;

  return (
    <section className="space-y-3" aria-labelledby="daqe-model-title">
      <div>
        <h4 id="daqe-model-title" className="text-sm font-medium">
          {t("daqeModel.title")}
        </h4>
        <p className="mt-1 text-xs opacity-70">{t("daqeModel.scopeNote")}</p>
      </div>

      <div className="space-y-1.5" role="radiogroup" aria-label={t("daqeModel.title")}>
        {DECISION_MODEL_OPTIONS.map((candidate) => (
          <ProviderRow
            key={candidate.id}
            option={candidate}
            selected={selected === candidate.id}
            onSelect={() => setProvider(candidate.id)}
          />
        ))}
      </div>

      {keyProvider ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
          <label className="block text-xs">
            <span className="flex items-center gap-1 opacity-70">
              <Key size={11} aria-hidden />
              {selected === OPENROUTER_DECISIONS_PROVIDER_ID
                ? t("daqeModel.openrouterKey")
                : selected === CLEF_PROVIDER_ID
                  ? t("daqeModel.cloudflareKey")
                  : selected === OPENAI_DECISIONS_PROVIDER_ID
                    ? t("daqeModel.openaiKey")
                    : t("daqeModel.apiKey")}
            </span>
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={keyStored ? (maskedKey ?? t("daqeModel.keyStored")) : undefined}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px]",
                invalid(
                  selected === OPENROUTER_DECISIONS_PROVIDER_ID
                    ? "openrouterApiKey"
                    : selected === OPENAI_DECISIONS_PROVIDER_ID
                      ? "openaiApiKey"
                      : "apiKey",
                ) && "border-amber-500/70",
              )}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!draftKey.trim() || savingKey}
              onClick={onSaveKey}
              className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50 disabled:opacity-40"
            >
              {savingKey ? t("daqeModel.keySaving") : t("daqeModel.keySave")}
            </button>
            {keyStored ? (
              <>
                <span className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                  <Check size={11} weight="bold" aria-hidden />
                  {maskedKey ?? t("daqeModel.keyStored")}
                </span>
                <button
                  type="button"
                  onClick={onClearKey}
                  className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50"
                >
                  {t("daqeModel.keyClear")}
                </button>
              </>
            ) : null}
          </div>
          <p className="text-[10px] opacity-60">{t("daqeModel.keychainNote")}</p>
        </div>
      ) : null}

      {needsEndpoint ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          {selected !== JEV_PROVIDER_ID ? (
            <p className="text-[11px] opacity-70">{t("daqeModel.localEngineHint")}</p>
          ) : null}
          <label className="block text-[11px]">
            <span className="opacity-70">{t("daqeModel.endpoint")}</span>
            <input
              type="url"
              value={daqe.decisionEngine?.baseUrl ?? ""}
              onChange={(e) =>
                updateSettingsCategory("daqe", {
                  decisionEngine: {
                    baseUrl: e.target.value.trim(),
                    model: daqe.decisionEngine?.model ?? "",
                    timeoutMs: daqe.decisionEngine?.timeoutMs,
                  },
                })
              }
              placeholder={baseUrlFor(selected, config)}
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
            />
          </label>
        </div>
      ) : null}

      {selected === CLEF_PROVIDER_ID ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <label className="block text-[11px]">
            <span className="opacity-70">{t("daqeModel.clefModel")}</span>
            <select
              value={daqe.clefDecisionModelId ?? CLEF_MODELS[0].id}
              onChange={(e) =>
                updateSettingsCategory("daqe", {
                  clefDecisionModelId: isClefModel(e.target.value)
                    ? e.target.value
                    : CLEF_MODELS[0].id,
                })
              }
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
            >
              {CLEF_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {t(model.labelKey)} — ${model.inputUsdPerMillion}/M (~{model.latencyMs}ms)
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px]">
            <span className="opacity-70">{t("daqeModel.cloudflareAccount")}</span>
            <input
              type="text"
              value={daqe.cloudflareAccountId ?? ""}
              onChange={(e) =>
                updateSettingsCategory("daqe", { cloudflareAccountId: e.target.value.trim() })
              }
              className={cn(
                "mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px]",
                invalid("cloudflareAccountId") && "border-amber-500/70",
              )}
            />
          </label>
        </div>
      ) : null}

      {selected === OPENROUTER_DECISIONS_PROVIDER_ID ? (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <label className="block text-[11px]">
            <span className="opacity-70">{t("daqeModel.openrouterModel")}</span>
            <select
              value={daqe.openrouterDecisionModelId ?? OPENROUTER_DECISION_MODELS[0].id}
              onChange={(e) =>
                updateSettingsCategory("daqe", {
                  openrouterDecisionModelId: isOpenRouterDecisionModel(e.target.value)
                    ? e.target.value
                    : OPENROUTER_DECISION_MODELS[0].id,
                })
              }
              className={cn(
                "mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px]",
                invalid("openrouterModelId") && "border-amber-500/70",
              )}
            >
              {OPENROUTER_DECISION_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {t(model.labelKey)}
                  {model.inputUsdPerMillion === 0
                    ? ` — ${t("daqeModel.openrouterFree")}`
                    : ` — $${model.inputUsdPerMillion}/M`}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 flex items-start gap-1 text-[10px] opacity-60">
            <Info size={11} className="mt-px shrink-0" aria-hidden />
            {t("daqeModel.openrouterNote")}
          </p>
        </div>
      ) : null}

      {/* ── Connection test ────────────────────────────────────────────────
          Placed above the opt-in deliberately: a reader who has just typed a key
          wants to press the button before reading anything else about privacy. */}
      {keyProvider ? (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3">
          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={probing}
            className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50 disabled:opacity-40"
          >
            {probing ? t("daqeProbe.running") : t("daqeProbe.test")}
          </button>
          {probeResult ? <ProbeReport result={probeResult} /> : (
            <p className="text-[10px] opacity-60">{t("daqeProbe.hint")}</p>
          )}
        </div>
      ) : null}

      {/* The remote opt-in. Present for every remote route, and absent for the
          ones that cannot phone home — a checkbox that never does anything is
          worse than no checkbox. */}
      {option?.privacy === "remote" ? (
        <label className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
          <input
            type="checkbox"
            checked={daqe.allowRemoteDecisionModel}
            onChange={(e) => {
              updateSettingsCategory("daqe", { allowRemoteDecisionModel: e.target.checked });
              onProviderChange?.();
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">{t("daqeModel.remoteOptIn")}</span>
            <span className="mt-0.5 block opacity-70">{t("daqeModel.remoteOptInDesc")}</span>
          </span>
        </label>
      ) : null}

      {option && !ready ? (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <Warning size={13} className="mt-px shrink-0" aria-hidden />
          {t("daqeModel.notReady")}
        </p>
      ) : null}

      {/* The one route whose weights are the user's to fetch. */}
      <DaqueDecisionModelDownload providerId={selected} />
    </section>
  );
});

function ProviderRow({
  option,
  selected,
  onSelect,
}: {
  option: DecisionModelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
        selected ? "border-accent bg-accent/10" : "border-border hover:bg-muted/50",
      )}
    >
      <span className="mt-0.5 w-3.5 shrink-0">
        {selected ? <Check size={14} weight="bold" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">{t(option.labelKey)}</span>
          <PrivacyBadge option={option} />
          {option.docsUrl ? (
            <a
              href={option.docsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] underline opacity-60 hover:opacity-100"
            >
              {t("daqeModel.docs")}
            </a>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[11px] opacity-70">{t(option.descriptionKey)}</span>
      </span>
    </button>
  );
}

/**
 * Where content goes for this option.
 *
 * Shown because it is the one fact a user cannot infer, and the one that decides
 * whether they can trust the setting they just changed.
 */
function PrivacyBadge({ option }: { option: DecisionModelOption }) {
  const { t } = useI18n();
  const tone =
    option.privacy === "remote"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : option.privacy === "local"
        ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  return (
    <span className={cn("rounded px-1 py-0.5 text-[10px]", tone)}>
      {t(`daqeModel.privacy.${option.privacy}`)}
    </span>
  );
}

/** Re-exported so callers can check readiness without importing the options module. */
export { isDecisionModelReady };

/**
 * What the probe found.
 *
 * Reports the three things that answer "is this working?" — is it reachable, did
 * it answer, and what did the call cost. The reason text is kept machine-readable
 * in the result and translated here, because the same reasons arrive from
 * ranking calls as well as probes and both must read the same way.
 */
function ProbeReport({ result }: { result: ProbeResult }) {
  const { t } = useI18n();
  const tone =
    result.outcome === "ok"
      ? "text-emerald-700 dark:text-emerald-400"
      : result.outcome === "answered-unexpectedly"
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const reasonKey = result.error?.reason ? `daqeProbe.reason.${result.error.reason}` : null;
  const reasonText = reasonKey ? t(reasonKey) : null;

  return (
    <div className={cn("space-y-0.5 text-[10px]", tone)}>
      <div className="flex items-center gap-1">
        {result.outcome === "ok" ? <Check size={11} weight="bold" aria-hidden /> : <Warning size={11} aria-hidden />}
        <span>{t(`daqeProbe.outcome.${result.outcome}`)}</span>
        <span className="opacity-60">· {Math.round(result.latencyMs)} ms</span>
      </div>
      {result.resolvedModel ? (
        <p className="font-mono opacity-60">{result.resolvedModel}</p>
      ) : null}
      {result.detail ? <p className="opacity-70">{result.detail}</p> : null}
      {reasonText ? <p className="opacity-80">{reasonText}</p> : null}
      {result.error?.message ? (
        <p className="opacity-60">{result.error.message}</p>
      ) : null}
      {result.inputTokens !== undefined ? (
        <p className="opacity-50">{t("daqeProbe.billed", { tokens: result.inputTokens })}</p>
      ) : null}
    </div>
  );
}
