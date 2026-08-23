import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  sourceSet,
  type ShowcaseAsset,
  type ShowcaseHotspot,
} from './showcase.ts';

const decodedScenes = new Set<string>();

export interface SceneImageProps {
  asset: ShowcaseAsset;
  interactive?: boolean;
  visibleActionIds?: readonly string[];
  recommendedActionId?: string;
  focusRequest?: number;
  loading?: 'eager' | 'lazy';
  sizes?: string;
  onAction?: (hotspot: ShowcaseHotspot) => void;
  onAssetFailure?: () => void;
}

function withRetry(path: string, attempt: number): string {
  return attempt === 0 ? path : `${path}?retry=${attempt}`;
}

function retriedSourceSet(asset: ShowcaseAsset, format: 'avif' | 'webp', attempt: number): string {
  if (attempt === 0) return sourceSet(asset.formats[format]);
  return asset.formats[format]
    .map((source) => `${withRetry(source.path, attempt)} ${source.width}w`)
    .join(', ');
}

export function SceneImage({
  asset,
  interactive = false,
  visibleActionIds,
  recommendedActionId,
  focusRequest = 0,
  loading = 'lazy',
  sizes,
  onAction,
  onAssetFailure,
}: SceneImageProps) {
  const cacheKey = `${asset.sceneId}:${asset.layout}`;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    decodedScenes.has(cacheKey) ? 'ready' : 'loading',
  );
  const imageRef = useRef<HTMLImageElement>(null);
  const failureReportedRef = useRef(false);

  const failAsset = useCallback(() => {
    if (failureReportedRef.current) return;
    failureReportedRef.current = true;
    setStatus('error');
    onAssetFailure?.();
  }, [onAssetFailure]);

  useEffect(() => {
    failureReportedRef.current = false;
    setAttempt(0);
    setStatus(decodedScenes.has(cacheKey) ? 'ready' : 'loading');
  }, [cacheKey]);

  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = window.setTimeout(failAsset, 3_500);
    return () => window.clearTimeout(timeout);
  }, [attempt, cacheKey, failAsset, status]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image?.complete || image.naturalWidth === 0) return;
    void image
      .decode()
      .then(() => {
        decodedScenes.add(cacheKey);
        setStatus('ready');
      })
      .catch(() => {
        failAsset();
      });
  }, [attempt, cacheKey, failAsset]);

  const png = asset.formats.png.at(-1)!;
  const frameStyle: CSSProperties = {
    aspectRatio: `${asset.intrinsicSize.width} / ${asset.intrinsicSize.height}`,
  };
  const visibleHotspots = asset.hotspots.filter(
    (hotspot) => !visibleActionIds || visibleActionIds.includes(hotspot.id),
  );

  async function finishDecode() {
    const image = imageRef.current;
    if (!image) return;
    try {
      await image.decode();
      decodedScenes.add(cacheKey);
      setStatus('ready');
    } catch {
      failAsset();
    }
  }

  return (
    <div
      className={`showcase-scene-image showcase-scene-image--${asset.layout}`}
      style={frameStyle}
      data-scene-image={asset.sceneId}
      data-image-state={status}
    >
      {status !== 'error' ? (
        <picture key={`${cacheKey}:${attempt}`}>
          <source
            type="image/avif"
            srcSet={retriedSourceSet(asset, 'avif', attempt)}
            sizes={sizes}
          />
          <source
            type="image/webp"
            srcSet={retriedSourceSet(asset, 'webp', attempt)}
            sizes={sizes}
          />
          <img
            ref={imageRef}
            src={withRetry(png.path, attempt)}
            width={asset.intrinsicSize.width}
            height={asset.intrinsicSize.height}
            loading={loading}
            decoding="async"
            alt={asset.accessibleDescription}
            onLoad={() => void finishDecode()}
            onError={failAsset}
          />
        </picture>
      ) : (
        <div className="showcase-asset-error" role="status">
          <p>The product scene could not be loaded.</p>
          <button
            type="button"
            className="showcase-button showcase-button--quiet"
            onClick={() => {
              failureReportedRef.current = false;
              setAttempt((current) => current + 1);
              setStatus('loading');
            }}
          >
            Retry
          </button>
        </div>
      )}

      {status === 'loading' ? <span className="showcase-loading">Loading product scene</span> : null}

      {interactive && status === 'ready'
        ? visibleHotspots.map((hotspot) => {
            const centerX = hotspot.rect.x + hotspot.rect.width / 2;
            const centerY = hotspot.rect.y + hotspot.rect.height / 2;
            const style: CSSProperties = {
              left: `${centerX * 100}%`,
              top: `${centerY * 100}%`,
              width: `${hotspot.rect.width * 100}%`,
              height: `${hotspot.rect.height * 100}%`,
            };
            const recommended = hotspot.id === recommendedActionId;
            return (
              <button
                key={hotspot.id}
                type="button"
                className="showcase-hotspot"
                style={style}
                aria-label={hotspot.actionLabel}
                autoFocus={recommended && focusRequest > 0}
                data-showcase-hotspot={hotspot.id}
                data-recommended={recommended ? 'true' : 'false'}
                onClick={() => onAction?.(hotspot)}
              >
                <span>{hotspot.actionLabel}</span>
              </button>
            );
          })
        : null}
    </div>
  );
}
