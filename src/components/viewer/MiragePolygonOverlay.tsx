import { useState } from "react";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";

export interface MiragePolygonOverlayProps {
  regions: ImageOcclusionRegion[];
  onRegionClick: (region: ImageOcclusionRegion) => void | Promise<void>;
  createdRegionIds?: ReadonlySet<string>;
  disabled?: boolean;
}

/**
 * Interactive SVG overlay for Mirage polygon segmentation masks (`mask_format="polygons"`)
 * and OCR text bounding boxes in `0–100` percentage space. Clicking any region
 * immediately triggers Tap-to-Mask flashcard creation.
 */
export function MiragePolygonOverlay({
  regions,
  onRegionClick,
  createdRegionIds,
  disabled = false,
}: MiragePolygonOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (regions.length === 0) {
    return null;
  }

  return (
    <svg
      data-testid="mirage-polygon-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-auto"
    >
      {regions.map((region, idx) => {
        const key = region.id ?? `mirage-region-${idx}`;
        const isHovered = hoveredId === key;
        const isCreated = createdRegionIds?.has(key) ?? false;
        const baseColor = isCreated ? "#10b981" : region.color || "#6366f1";
        const fillOpacity = isCreated ? 0.36 : isHovered ? 0.34 : 0.14;
        const strokeWidth = isHovered || isCreated ? 0.65 : 0.35;

        const handleSelect = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (!disabled) {
            void onRegionClick(region);
          }
        };

        const titleText = region.label
          ? `${region.label}${isCreated ? " (Masked card created)" : " (Click to mask)"}`
          : "Click to create occlusion card";

        if (region.points && region.points.length >= 3) {
          const ptsAttr = region.points.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <polygon
              key={key}
              data-testid="mirage-overlay-region"
              data-region-id={key}
              data-created={isCreated ? "true" : "false"}
              points={ptsAttr}
              fill={baseColor}
              fillOpacity={fillOpacity}
              stroke={baseColor}
              strokeWidth={strokeWidth}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={() => setHoveredId(key)}
              onMouseLeave={() => setHoveredId((prev) => (prev === key ? null : prev))}
              onClick={handleSelect}
            >
              <title>{titleText}</title>
            </polygon>
          );
        }

        return (
          <rect
            key={key}
            data-testid="mirage-overlay-region"
            data-region-id={key}
            data-created={isCreated ? "true" : "false"}
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            rx={0.5}
            fill={baseColor}
            fillOpacity={fillOpacity}
            stroke={baseColor}
            strokeWidth={strokeWidth}
            className="cursor-pointer transition-all duration-150"
            onMouseEnter={() => setHoveredId(key)}
            onMouseLeave={() => setHoveredId((prev) => (prev === key ? null : prev))}
            onClick={handleSelect}
          >
            <title>{titleText}</title>
          </rect>
        );
      })}
    </svg>
  );
}
