import React from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";
import {
  DAQE_KNOBS,
  applyKnobUpdate,
  validateKnob,
  type DaqeKnobs,
  type KnobSpec,
} from "../../lib/daqe/knobs";
import {
  DAQE_PRESETS,
  detectActivePreset,
  type DaqePresetId,
  type QueueStrategyPresetId,
} from "../../lib/daqe/presets";

interface DaqeKnobPanelProps {
  knobs: DaqeKnobs;
  /**
   * The preset dropdown's selection. `null` when the knobs match no preset — which
   * is the normal state after any individual adjustment.
   */
  activePreset: QueueStrategyPresetId | null;
  onKnobChange: (knobs: DaqeKnobs) => void;
  onPresetSelect: (preset: DaqePresetId) => void;
  /** Re-runs the ranking. Called on every change; there is no apply step. */
  onScheduleRerank: () => void;
  /** Whether the slider step applies cleanly to this knob's range. */
  disabled?: boolean;
}

/**
 * The six ranking knobs, plus the four DAQE presets that write them.
 *
 * Two properties this panel is responsible for:
 *
 *  - **No apply step.** Every change re-ranks immediately. A knob the user has to
 *    commit is a knob they will not experiment with, and the whole point of
 *    ranking knobs is experimentation.
 *  - **Honest attribution.** A preset is reported active only while the knobs
 *    match it exactly. Once a slider moves, the panel says no preset is active
 *    rather than continuing to credit one the user has edited away from.
 *
 * The scope note is not decoration: these controls order the queue, they do not
 * schedule reviews, and a user who believes otherwise will distrust every number
 * on the panel.
 */
export const DaqeKnobPanel = React.memo(function DaqeKnobPanel({
  knobs,
  activePreset,
  onKnobChange,
  onPresetSelect,
  onScheduleRerank,
  disabled = false,
}: DaqeKnobPanelProps) {
  const { t } = useI18n();
  const detected = detectActivePreset(knobs);

  const handleChange = (spec: KnobSpec, raw: number) => {
    // An out-of-range value is refused outright, so the stored knob can never
    // hold one — not even transiently while a drag is in flight.
    if (!validateKnob(spec.key, raw).ok) return;
    onKnobChange(applyKnobUpdate(knobs, spec.key, raw));
    onScheduleRerank();
  };

  return (
    <section className="space-y-4" aria-labelledby="daqe-knob-title">
      <div>
        <h3 id="daqe-knob-title" className="text-sm font-medium">
          {t("daqeKnob.title")}
        </h3>
        <p className="mt-1 text-xs opacity-70">{t("daqeKnob.scopeNote")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DAQE_PRESETS.map((preset) => {
          const selected = detected === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onPresetSelect(preset.id)}
              aria-pressed={selected}
              title={t(preset.descriptionKey)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                selected
                  ? "border-accent bg-accent/10 font-medium"
                  : "border-border hover:bg-muted/50",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {selected ? <Check size={12} weight="bold" aria-hidden /> : null}
              {t(preset.labelKey)}
            </button>
          );
        })}
        {activePreset && detected === null ? (
          <p className="w-full text-xs opacity-70">
            {t("daqeKnob.scopeNote")}
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {DAQE_KNOBS.map((spec) => {
          const value = knobs[spec.key];
          const percent = ((value - spec.min) / (spec.max - spec.min)) * 100;
          const controlId = `daqe-knob-${spec.key}`;
          return (
            <div key={spec.key}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={controlId} className="text-xs font-medium">
                  {t(spec.labelKey)}
                </label>
                <span className="font-mono text-xs opacity-70">
                  {spec.integer ? value : value.toFixed(2)}
                </span>
              </div>
              <input
                id={controlId}
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={value}
                disabled={disabled}
                aria-describedby={`${controlId}-desc`}
                onChange={(event) => handleChange(spec, Number(event.target.value))}
                className="mt-1 w-full accent-[var(--color-accent)]"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) ${percent}%, transparent ${percent}%)`,
                }}
              />
              <p id={`${controlId}-desc`} className="mt-0.5 text-xs opacity-60">
                {t(spec.descriptionKey)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
});