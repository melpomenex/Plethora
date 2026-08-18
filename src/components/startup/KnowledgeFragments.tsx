/**
 * KnowledgeFragments — the abstract, language-neutral token cards and
 * connector lines of the Knowledge Peck scene.
 *
 * Cards are pure shape: two rounded text-bars + a dot on a dark-glass card
 * with a purple accent edge. No words anywhere (spec: fragment content must
 * be abstract and language-neutral). The peck transforms a "raw" token into
 * an emphasized "card" — a discrete data-visual state on the driver-owned
 * part element (the timeline driver mutates it per frame; React only sets
 * the initial value). Positions/opacities are owned by the driver via
 * data-kp-part transforms.
 */

import type { FragmentVisualState } from "../../lib/startupAnimation/timeline";

/** A horizontal connector span between two card slots (scene px). */
export interface ConnectorSpan {
  x: number;
  y: number;
  width: number;
}

interface KnowledgeFragmentsProps {
  count: number;
  card: { width: number; height: number };
  /** Connector spans between consecutive slots, from sceneLayout. */
  connectors: ConnectorSpan[];
  /** Discrete visual state per fragment ("raw" | "card" | "gone"). */
  visualStates: FragmentVisualState[];
  /** Static variants (e-ink stills) draw connectors at this scaleX. */
  connectorScaleX?: number;
}

function TokenCard({ width, height }: { width: number; height: number }) {
  const barHeight = Math.max(5, Math.round(height * 0.14));
  return (
    <div
      className="kp-card"
      style={{
        width,
        height,
        borderRadius: Math.round(height * 0.23),
        padding: Math.round(height * 0.15),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: barHeight,
      }}
    >
      <div
        className="kp-card-bar"
        style={{ height: barHeight, width: "72%", borderRadius: barHeight }}
      />
      <div
        className="kp-card-bar"
        style={{ height: barHeight, width: "46%", borderRadius: barHeight }}
      />
      <div className="kp-card-dot" style={{ height: barHeight, width: barHeight }} />
    </div>
  );
}

export function KnowledgeFragments({
  count,
  card,
  connectors,
  visualStates,
  connectorScaleX = 0,
}: KnowledgeFragmentsProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-kp-part={`fragment-${i + 1}`}
          data-visual={visualStates[i] ?? "raw"}
          className="kp-fragment"
        >
          <div style={{ transform: "translate(-50%, -50%)" }}>
            <TokenCard width={card.width} height={card.height} />
          </div>
        </div>
      ))}
      {connectors.map((span, i) => (
        <div
          key={`connector-${i}`}
          aria-hidden="true"
          data-kp-part={`connector-${i + 1}`}
          className="kp-connector"
          style={{
            left: span.x,
            top: span.y,
            width: span.width,
            transform: `scaleX(${connectorScaleX})`,
          }}
        />
      ))}
    </>
  );
}
