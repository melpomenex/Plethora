import { useEffect, useRef, useState } from "react";
import type { AnimatedImagePack } from "../../../themes/animatedImage/contracts";
import { FramePackPlayer } from "./framePackPlayer";

type DrawableImage = CanvasImageSource & { close?: () => void };

interface AnimatedFrameBackdropProps {
  readonly pack: AnimatedImagePack;
  readonly posterSrc: string;
  readonly visible: boolean;
  readonly mobile: boolean;
  readonly filter: string;
  readonly transform: string;
  readonly onFallback?: (reason: string) => void;
}

/** A single serial canvas player layered over the independent still poster. */
export function AnimatedFrameBackdrop({
  pack,
  posterSrc,
  visible,
  mobile,
  filter,
  transform,
  onFallback,
}: AnimatedFrameBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<FramePackPlayer<DrawableImage> | null>(null);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) {
      onFallbackRef.current?.("canvas-unavailable");
      return;
    }

    canvas.width = pack.width;
    canvas.height = pack.height;
    setHasFrame(false);
    const player = new FramePackPlayer<DrawableImage>({
      pack,
      maxFps: mobile ? 12 : 20,
      decode: decodeStillFrame,
      present: (frame) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        setHasFrame(true);
      },
      onFallback: (reason) => {
        setHasFrame(false);
        onFallbackRef.current?.(reason);
      },
    });
    playerRef.current = player;
    player.start(!visible);
    return () => {
      player.stop();
      if (playerRef.current === player) playerRef.current = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [pack, mobile]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (visible) player.resume();
    else player.pause();
  }, [visible]);

  return (
    <>
      <img
        src={posterSrc}
        alt=""
        className="theme-image-frame-layer"
        style={{ filter, transform }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="theme-image-frame-layer theme-image-frame-canvas"
        style={{ filter, transform, opacity: visible && hasFrame ? 1 : 0 }}
      />
    </>
  );
}

async function decodeStillFrame(blob: Blob): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob) as Promise<DrawableImage>;
  }

  const url = URL.createObjectURL(blob);
  return new Promise<DrawableImage>((resolve, reject) => {
    const image = new Image() as HTMLImageElement & { close?: () => void };
    const cleanHandlers = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanHandlers();
      image.close = () => URL.revokeObjectURL(url);
      resolve(image as DrawableImage);
    };
    image.onerror = () => {
      cleanHandlers();
      URL.revokeObjectURL(url);
      reject(new Error("Image frame could not be decoded."));
    };
    image.src = url;
  });
}
