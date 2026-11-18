import Hls from "hls.js";

export interface AttachedMediaSource {
  cleanup: () => void;
}

export function isHlsPlaylistUrl(url: string): boolean {
  return /\.m3u8(?:$|\?)/i.test(url);
}

/**
 * Attach a standard media URL or HLS `.m3u8` playlist to an HTMLMediaElement.
 * Uses native HLS where supported (WKWebView / Safari) and hls.js (MSE) on
 * WebKitGTK / WebView2 / Chromium.
 */
export function attachMediaSource(
  video: HTMLVideoElement,
  url: string,
  onFatalError?: (detail: string) => void,
  startPosition?: number,
): AttachedMediaSource {
  if (!isHlsPlaylistUrl(url)) {
    if (video.src !== url) {
      video.src = url;
    }
    return {
      cleanup: () => {
        // Standard src lifecycle is managed by the caller.
      },
    };
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return {
      cleanup: () => {
        video.removeAttribute("src");
        video.load();
      },
    };
  }

  if (!Hls.isSupported()) {
    onFatalError?.("HLS playback is not supported in this browser/webview.");
    return { cleanup: () => {} };
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    startPosition:
      typeof startPosition === "number" && Number.isFinite(startPosition) && startPosition > 0
        ? startPosition
        : -1,
  });

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      onFatalError?.(`${data.type}:${data.details}`);
      hls.destroy();
    }
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  return {
    cleanup: () => {
      hls.destroy();
    },
  };
}
