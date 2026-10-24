import { useEffect, useId, useRef, type RefObject } from "react";
import { appAudioFocus, type AudioOutputLease } from "../services/audio/audioFocus";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "../services/audio/audioPlaybackRollout";

/** A local media element may start only while its focus request is still current. */
export function useMediaOutput(element: RefObject<HTMLMediaElement | null>, source: string) {
  const id = useId();
  const lease = useRef<AudioOutputLease | null>(null);
  const request = useRef(0);

  const pause = () => {
    request.current++;
    element.current?.pause();
  };

  useEffect(() => {
    const media = element.current;
    const handleEnded = () => {
      lease.current?.release();
      lease.current = null;
    };
    media?.addEventListener?.("ended", handleEnded);
    return () => {
      media?.removeEventListener?.("ended", handleEnded);
      request.current++;
      if (!lease.current?.isCurrent()) return;
      media?.pause();
      lease.current.release();
      lease.current = null;
    };
  }, [element, source]);

  const play = async (): Promise<boolean> => {
    const media = element.current;
    if (!media) return false;
    const intent = ++request.current;
    if (GLOBAL_AUDIO_PLAYBACK_ENABLED) {
      const acquired = await appAudioFocus.acquire(`media-element:${id}`, () => {
        pause();
        if (!media.paused) throw new Error("Media did not acknowledge pause");
      });
      if (intent !== request.current || !acquired.isCurrent()) {
        acquired.release();
        return false;
      }
      lease.current = acquired;
    }
    await media.play();
    if (intent === request.current) return true;
    media.pause();
    return false;
  };

  return { play, pause };
}
