/**
 * Knowledge Universe — WebGL engine
 *
 * Owns the three.js scene, the render-on-demand frame loop, camera travel,
 * focus transitions, and picking. React (KnowledgeUniverse.tsx) owns all UI
 * chrome and receives semantic events through EngineCallbacks.
 *
 * Performance contract (see openspec/changes/knowledge-universe):
 * - Zero frames when idle: the rAF loop dies whenever no animation source is
 *   active; ambient drift is 30 fps-capped and auto-pauses after 30 s.
 * - Constant draw calls: one Points cloud for nodes, one LineSegments for
 *   edges, one Points starfield, ≤8 nebula sprites, one instanced ring mesh.
 * - State changes (hover/selection/search/focus) write buffer attributes or
 *   uniforms — scene objects are never created per node.
 */

import * as THREE from "three";
import {
  NODE_VERTEX,
  NODE_FRAGMENT,
  EDGE_VERTEX,
  EDGE_FRAGMENT,
  STAR_VERTEX,
  STAR_FRAGMENT,
} from "./shaders";
import { rand01 } from "./layout";
import { anchorShift, computeCameraRange } from "./cameraFit";
import {
  TWIST_ENGAGE_RAD,
  isTwoFingerTap,
  pinchZoomFactor,
  twistDelta,
} from "./gestureMath";
import {
  NODE_VISUALS,
  NodeClass,
  NodeState,
  type FocusState,
  type UniverseLayout,
  type UniverseSystem,
} from "./types";
import type { GraphNode, GraphEdge } from "../KnowledgeGraph";

const AMBIENT_TIMEOUT_MS = 30_000;
const AMBIENT_FRAME_MS = 33; // 30 fps cap
const MAX_DPR = 2;
const STAR_COUNT = 1400;
const MAX_NEBULAE = 8;
const FOCUS_TWEEN_MS = 600;
const WARP_TWEEN_MS = 950;
const HOVER_THROTTLE_MS = 33;
const DRAG_THRESHOLD_PX = 5;
const TAP_ZOOM_TWEEN_MS = 380;
const CLICK_SUPPRESS_WINDOW_MS = 400;

export class WebGLUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("WebGL context could not be created");
    this.name = "WebGLUnavailableError";
    this.cause = cause;
  }
}

export interface UniverseThemeSpec {
  isDark: boolean;
  background: string;
  accent: string;
}

export interface EngineCallbacks {
  /** Hovered node changed (null on leave). */
  onHoverChange?: (id: string | null) => void;
  /** Called after each rendered frame — sync HTML overlay label positions here. */
  onFrame?: () => void;
  /** WebGL context irrecoverably lost — caller should switch to the fallback. */
  onContextLost?: () => void;
}

interface Tween {
  elapsed: number;
  duration: number;
  update: (k: number) => void;
  onDone?: () => void;
}

interface OrbitCamera {
  target: THREE.Vector3;
  theta: number;
  phi: number;
  dist: number;
}

function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function shortestAngle(from: number, to: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return from + d;
}

export class UniverseEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private callbacks: EngineCallbacks;

  private nodePoints: THREE.Points | null = null;
  private nodeMaterial: THREE.ShaderMaterial | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private edgeMaterial: THREE.ShaderMaterial | null = null;
  private starField: THREE.Points | null = null;
  private starMaterial: THREE.ShaderMaterial | null = null;
  private nebulaGroup = new THREE.Group();
  private nebulaTexture: THREE.CanvasTexture | null = null;
  private ringMesh: THREE.InstancedMesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;

  // Node data
  private layout: UniverseLayout | null = null;
  private nodesById = new Map<string, GraphNode>();
  private ids: string[] = [];
  private indexById = new Map<string, number>();
  private positions: Float32Array = new Float32Array(0);
  private sizes: Float32Array = new Float32Array(0);
  private classes: Float32Array = new Float32Array(0);
  private systemsAttr: Float32Array = new Float32Array(0);
  private stateAttr: THREE.BufferAttribute | null = null;

  // Interaction state
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private searchMatches = new Set<string>();

  // Focus
  private focus: FocusState = { level: "universe" };
  private focusSystemIndex = -1;
  private expansion = 0;

  // Camera
  private orbit: OrbitCamera = { target: new THREE.Vector3(), theta: 0.6, phi: 1.05, dist: 320 };
  private homeTarget = new THREE.Vector3();
  private homeDist = 320;
  private minDist = 14;
  private maxDist = 1200;
  private baseFov = 55;
  private layoutBounds = 0;
  private layoutCoreBounds = 0;

  // Frame loop
  private frameRequested = false;
  private loopAlive = false;
  private disposed = false;
  private contextLost = false;
  private active = true;
  private ambientEnabled = true;
  private reducedMotion: boolean;
  private lastInteractionAt = 0;
  private lastRenderAt = 0;
  private timeSec = 0;
  private tweens: Tween[] = [];
  private warp = 0;

  // Drag / inertia
  private pointerDown = false;
  private dragging = false;
  private suppressClickUntil = 0;
  private lastPointer = { x: 0, y: 0 };
  private velocity = { theta: 0, phi: 0 };
  private inertiaActive = false;
  private lastHoverPickAt = 0;

  // Touch / Pan variables
  private activePointers = new Map<number, { x: number; y: number }>();
  private viewportOffset = 0;
  private lastPinchDist = 0;
  private lastPinchCenter = { x: 0, y: 0 };
  private lastPinchAngle: number | null = null;
  private isPanningMode = false;
  private gestureHadMultiTouch = false;
  private twistAccum = 0;
  private twistEngaged = false;
  private twoFingerStartAt = 0;
  private twoFingerMovement = 0;
  private zoomVelocity = 1;
  private zoomInertia = 1;
  private zoomInertiaActive = false;

  // Debug counters (exposed for the performance verification pass)
  public framesRendered = 0;

  private detachFns: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, opts: { reducedMotion?: boolean; callbacks?: EngineCallbacks } = {}) {
    this.canvas = canvas;
    this.callbacks = opts.callbacks ?? {};
    this.reducedMotion = opts.reducedMotion ?? false;

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
      if (!this.renderer.getContext()) throw new Error("no context");
    } catch (err) {
      throw new WebGLUnavailableError(err);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.5, 20000);
    this.scene.add(this.nebulaGroup);

    this.buildStarfield();
    this.buildRings();
    this.attachEvents();
  }

  // ---------------------------------------------------------------- events

  private attachEvents() {
    const c = this.canvas;

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K | string,
      fn: (ev: any) => void,
      opts?: AddEventListenerOptions
    ) => {
      target.addEventListener(type as string, fn, opts);
      this.detachFns.push(() => target.removeEventListener(type as string, fn, opts));
    };

    on(c, "pointerdown", this.handlePointerDown);
    on(c, "pointermove", this.handlePointerMove);
    on(c, "pointerup", this.handlePointerUp);
    on(c, "pointercancel", this.handlePointerUp);
    on(c, "pointerleave", this.handlePointerLeave);
    on(c, "wheel", this.handleWheel, { passive: false });
    on(c, "webglcontextlost", this.handleContextLost);
    on(document, "visibilitychange", this.handleVisibility);
  }

  private handleContextLost = (ev: Event) => {
    ev.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.();
  };

  private handleVisibility = () => {
    if (!document.hidden) this.invalidate();
    // When hidden the frame callback exits before doing any work.
  };

  private handlePointerDown = (ev: PointerEvent) => {
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.touch();

    // Check if it's right-click or middle-click or shift/ctrl-left-click for panning
    const isPanButton = ev.button === 2 || ev.button === 1 || (ev.button === 0 && (ev.shiftKey || ev.ctrlKey));

    if (this.activePointers.size > 1) {
      // Multi-touch: disable normal single-pointer drag rotation and velocity
      this.pointerDown = false;
      this.dragging = false;
      this.velocity = { theta: 0, phi: 0 };
      this.inertiaActive = false;
      this.zoomInertiaActive = false;
      this.gestureHadMultiTouch = true;
      this.lastPinchDist = 0;
      this.lastPinchCenter = { x: 0, y: 0 };
      this.lastPinchAngle = null;
      this.twistAccum = 0;
      this.twistEngaged = false;
      this.zoomVelocity = 1;
      if (this.activePointers.size === 2) {
        this.twoFingerStartAt = performance.now();
        this.twoFingerMovement = 0;
      } else {
        this.twoFingerStartAt = 0;
      }
    } else {
      if (ev.button !== 0 && ev.button !== 2) return;
      this.pointerDown = true;
      this.dragging = false;
      this.inertiaActive = false;
      this.lastPointer = { x: ev.clientX, y: ev.clientY };
      this.velocity = { theta: 0, phi: 0 };
      this.isPanningMode = isPanButton;
    }

    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* not critical */
    }
  };

  private panCameraTarget(dx: number, dy: number) {
    if (dx === 0 && dy === 0) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const scale = this.orbit.dist * 0.0016;
    this.orbit.target.addScaledVector(right, -dx * scale);
    this.orbit.target.addScaledVector(up, dy * scale);
    this.invalidate();
  }

  private handlePointerMove = (ev: PointerEvent) => {
    this.touch();

    if (this.activePointers.has(ev.pointerId)) {
      this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    } else {
      const now = performance.now();
      if (now - this.lastHoverPickAt < HOVER_THROTTLE_MS) return;
      this.lastHoverPickAt = now;
      const id = this.pickAt(ev.clientX, ev.clientY);
      if (id !== this.hoveredId) {
        this.setHovered(id);
        this.callbacks.onHoverChange?.(id);
        this.canvas.style.cursor = id ? "pointer" : "grab";
      }
      return;
    }

    if (this.activePointers.size === 2) {
      const entries = Array.from(this.activePointers.entries());
      const [, pos1] = entries[0];
      const [, pos2] = entries[1];

      const currDist = Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
      const currCenter = { x: (pos1.x + pos2.x) / 2, y: (pos1.y + pos2.y) / 2 };
      const currAngle = Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);

      if (this.lastPinchDist > 0 && currDist > 0) {
        const zoomFactor = pinchZoomFactor(this.lastPinchDist, currDist);
        // Focal-point zoom: the world point under the gesture center stays put.
        this.zoomToward(currCenter.x, currCenter.y, zoomFactor);
        this.zoomVelocity = this.zoomVelocity * 0.7 + zoomFactor * 0.3;

        const dx = currCenter.x - this.lastPinchCenter.x;
        const dy = currCenter.y - this.lastPinchCenter.y;
        this.panCameraTarget(dx, dy);

        if (this.lastPinchAngle !== null) {
          const dTwist = twistDelta(this.lastPinchAngle, currAngle);
          this.twistAccum += dTwist;
          // Dead-zone so a pure pinch doesn't jitter the heading.
          if (!this.twistEngaged && Math.abs(this.twistAccum) > TWIST_ENGAGE_RAD) {
            this.twistEngaged = true;
          }
          // Sign: scene follows the fingers (verified empirically — camera
          // azimuth must decrease for a clockwise screen twist).
          if (this.twistEngaged) this.orbit.theta -= dTwist;
        }

        this.twoFingerMovement +=
          Math.hypot(dx, dy) + Math.abs(currDist - this.lastPinchDist);

        this.invalidate();
      }

      this.lastPinchDist = currDist;
      this.lastPinchCenter = currCenter;
      this.lastPinchAngle = currAngle;
      return;
    }

    if (this.pointerDown && this.activePointers.size === 1) {
      const dx = ev.clientX - this.lastPointer.x;
      const dy = ev.clientY - this.lastPointer.y;
      if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.dragging = true;
      if (this.dragging) {
        if (this.isPanningMode) {
          this.panCameraTarget(dx, dy);
        } else {
          const dTheta = -dx * 0.005;
          const dPhi = -dy * 0.005;
          this.orbit.theta += dTheta;
          this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + dPhi, 0.15, Math.PI - 0.15);
          this.velocity = { theta: dTheta, phi: dPhi };
        }
        this.lastPointer = { x: ev.clientX, y: ev.clientY };
        this.invalidate();
      }
      return;
    }
  };

  private handlePointerUp = (ev: PointerEvent) => {
    const prevSize = this.activePointers.size;
    this.activePointers.delete(ev.pointerId);

    if (this.activePointers.size < 2) {
      this.lastPinchDist = 0;
      this.lastPinchCenter = { x: 0, y: 0 };
      this.lastPinchAngle = null;
    }

    // Pinch just ended (2 → 1): classify a two-finger tap or hand off momentum.
    if (prevSize === 2 && this.activePointers.size === 1 && this.twoFingerStartAt > 0) {
      const elapsed = performance.now() - this.twoFingerStartAt;
      this.twoFingerStartAt = 0;
      if (ev.type !== "pointercancel" && isTwoFingerTap(elapsed, this.twoFingerMovement)) {
        this.zoomBy(1.9, { animated: true });
      } else if (!this.reducedMotion && Math.abs(this.zoomVelocity - 1) > 0.006) {
        this.zoomInertia = THREE.MathUtils.clamp(this.zoomVelocity, 0.9, 1.1);
        this.zoomInertiaActive = true;
        this.invalidate();
      }
      this.zoomVelocity = 1;
    }

    if (this.activePointers.size === 0) {
      const hadMultiTouch = this.gestureHadMultiTouch;
      this.gestureHadMultiTouch = false;
      if (hadMultiTouch) {
        // Lifting off a multi-touch gesture must never read as a tap.
        this.suppressClickUntil = performance.now() + CLICK_SUPPRESS_WINDOW_MS;
      }
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* not critical */
      }
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.dragging) {
        this.suppressClickUntil = performance.now() + CLICK_SUPPRESS_WINDOW_MS;
        this.dragging = false;
        if (!this.isPanningMode && Math.hypot(this.velocity.theta, this.velocity.phi) > 0.0005) {
          this.inertiaActive = true;
          this.invalidate();
        }
      } else if (!hadMultiTouch) {
        this.suppressClickUntil = 0;
      }
    } else if (this.activePointers.size === 1) {
      const [, pos] = Array.from(this.activePointers.entries())[0];
      this.pointerDown = true;
      this.dragging = false;
      this.lastPointer = { x: pos.x, y: pos.y };
      this.isPanningMode = false;
    }
  };

  private handlePointerLeave = () => {
    if (this.hoveredId) {
      this.setHovered(null);
      this.callbacks.onHoverChange?.(null);
      this.canvas.style.cursor = "grab";
    }
  };

  private handleWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    this.touch();
    const factor = ev.deltaY > 0 ? 1.1 : 0.9;
    this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * factor, this.minDist, this.maxDist);
    this.invalidate();
  };

  /**
   * True when the click event that follows pointerup came from a drag or a
   * multi-touch gesture. Time-boxed because touch browsers often skip the
   * synthesized click entirely — a stale flag must not swallow the next
   * genuine tap.
   */
  consumeClickSuppression(): boolean {
    const s = performance.now() < this.suppressClickUntil;
    this.suppressClickUntil = 0;
    return s;
  }

  private touch() {
    this.lastInteractionAt = performance.now();
  }

  // ------------------------------------------------------------ frame loop

  invalidate = () => {
    if (this.disposed || this.contextLost) return;
    if (document.hidden) {
      // rAF never fires in a hidden document, so paint one synchronous frame
      // (data/theme/selection changes stay visible) but never start a loop —
      // the hidden-document contract is "no continuous rendering".
      this.render();
      return;
    }
    if (this.frameRequested) return;
    this.frameRequested = true;
    this.loopAlive = true;
    requestAnimationFrame(this.frame);
  };

  /** True while the rAF loop is scheduled (debug/verification). */
  isLoopRunning(): boolean {
    return this.loopAlive;
  }

  private frame = (t: number) => {
    this.frameRequested = false;
    if (this.disposed || this.contextLost) {
      this.loopAlive = false;
      return;
    }
    if (!this.active || document.hidden) {
      // Hard stop — resumes via invalidate() on visibility/activation.
      this.loopAlive = false;
      return;
    }

    const ambientActive =
      this.ambientEnabled && !this.reducedMotion && t - this.lastInteractionAt < AMBIENT_TIMEOUT_MS;
    const hasWork =
      this.tweens.length > 0 ||
      this.dragging ||
      this.inertiaActive ||
      this.zoomInertiaActive ||
      this.pointerDown;

    if (!hasWork && ambientActive && t - this.lastRenderAt < AMBIENT_FRAME_MS) {
      // Ambient-only frames are capped at 30 fps: keep the loop alive but
      // skip all render work this tick.
      this.frameRequested = true;
      requestAnimationFrame(this.frame);
      return;
    }

    const dt = this.lastRenderAt === 0 ? 16 : Math.min(t - this.lastRenderAt, 100);
    this.lastRenderAt = t;
    this.timeSec += dt / 1000;

    // Advance tweens
    if (this.tweens.length > 0) {
      const done: Tween[] = [];
      for (const tw of this.tweens) {
        tw.elapsed += dt;
        const k = Math.min(1, tw.elapsed / tw.duration);
        tw.update(easeInOutCubic(k));
        if (k >= 1) done.push(tw);
      }
      if (done.length) {
        this.tweens = this.tweens.filter((tw) => !done.includes(tw));
        for (const tw of done) tw.onDone?.();
      }
    }

    // Inertia
    if (this.inertiaActive) {
      this.orbit.theta += this.velocity.theta;
      this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + this.velocity.phi, 0.15, Math.PI - 0.15);
      this.velocity.theta *= 0.92;
      this.velocity.phi *= 0.92;
      if (Math.hypot(this.velocity.theta, this.velocity.phi) < 0.0002) this.inertiaActive = false;
    }

    // Pinch-zoom momentum — decays like rotate inertia; never under reduced motion.
    if (this.zoomInertiaActive) {
      this.orbit.dist = THREE.MathUtils.clamp(
        this.orbit.dist * this.zoomInertia,
        this.minDist,
        this.maxDist
      );
      this.zoomInertia = 1 + (this.zoomInertia - 1) * 0.92;
      if (
        Math.abs(this.zoomInertia - 1) < 0.0015 ||
        this.orbit.dist === this.minDist ||
        this.orbit.dist === this.maxDist
      ) {
        this.zoomInertiaActive = false;
      }
    }

    // Ambient drift — barely-perceptible parallax
    if (ambientActive && !this.dragging && this.tweens.length === 0) {
      this.orbit.theta += 0.0000225 * dt;
    }

    this.render();

    const keepAlive =
      this.tweens.length > 0 ||
      this.dragging ||
      this.inertiaActive ||
      this.zoomInertiaActive ||
      ambientActive;
    if (keepAlive) {
      this.frameRequested = true;
      requestAnimationFrame(this.frame);
    } else {
      this.loopAlive = false; // idle: zero frames until the next invalidate()
    }
  };

  private render() {
    this.applyCamera();
    const u = this.nodeMaterial?.uniforms;
    if (u) {
      u.uTime.value = this.timeSec;
      u.uExpansion.value = this.expansion;
      u.uFocusSystem.value = this.focusSystemIndex;
    }
    const eu = this.edgeMaterial?.uniforms;
    if (eu) {
      eu.uExpansion.value = this.expansion;
      eu.uFocusSystem.value = this.focusSystemIndex;
    }
    const su = this.starMaterial?.uniforms;
    if (su) {
      su.uTime.value = this.timeSec;
      su.uWarp.value = this.warp;
    }
    this.updateRings();
    this.renderer.render(this.scene, this.camera);
    this.framesRendered++;
    this.callbacks.onFrame?.();
  }

  private applyCamera() {
    const { target, theta, phi, dist } = this.orbit;
    this.camera.position.set(
      target.x + dist * Math.sin(phi) * Math.cos(theta),
      target.y + dist * Math.cos(phi),
      target.z + dist * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------- lifecycle

  resize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    const wasAtHome = this.isAtHomeView();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.updateCameraRange();
    if (wasAtHome) {
      this.orbit.target.copy(this.homeTarget);
      this.orbit.dist = this.homeDist;
    }
    this.updateProjection();
    this.invalidate();
  }

  private isAtHomeView(): boolean {
    if (this.focus.level !== "universe") return false;
    const distanceTolerance = Math.max(0.01, this.homeDist * 0.0001);
    return (
      this.orbit.target.distanceToSquared(this.homeTarget) <= 1.0 &&
      Math.abs(this.orbit.dist - this.homeDist) <= Math.max(1.0, distanceTolerance)
    );
  }

  /** Derive zoom limits from the layout size and the current viewport aspect. */
  private updateCameraRange() {
    if (this.layoutBounds <= 0) return;
    const range = computeCameraRange(
      this.layoutBounds,
      this.layoutCoreBounds,
      this.baseFov,
      this.camera.aspect
    );
    this.homeDist = range.homeDist;
    this.maxDist = range.maxDist;
    this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist, this.minDist, this.maxDist);
    this.repositionStarfield(this.layoutBounds);
  }

  setViewportOffset(offset: number) {
    this.viewportOffset = offset;
    this.updateProjection();
    this.invalidate();
  }

  private updateProjection() {
    const width = this.canvas.clientWidth || this.canvas.width || 800;
    const height = this.canvas.clientHeight || this.canvas.height || 600;

    if (this.viewportOffset !== 0) {
      this.camera.setViewOffset(
        width,
        height,
        this.viewportOffset,
        0,
        width,
        height
      );
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.invalidate();
  }

  setAmbientEnabled(enabled: boolean) {
    this.ambientEnabled = enabled;
    if (enabled) {
      this.touch();
      this.invalidate();
    }
  }

  isAmbientEnabled(): boolean {
    return this.ambientEnabled;
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.tweens = [];
    this.disposeData();
    this.starField?.geometry.dispose();
    this.starMaterial?.dispose();
    this.ringMesh?.geometry.dispose();
    this.ringMaterial?.dispose();
    this.nebulaTexture?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private disposeData() {
    if (this.nodePoints) {
      this.scene.remove(this.nodePoints);
      this.nodePoints.geometry.dispose();
      this.nodeMaterial?.dispose();
      this.nodePoints = null;
      this.nodeMaterial = null;
    }
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      this.edgeMaterial?.dispose();
      this.edgeLines = null;
      this.edgeMaterial = null;
    }
    for (const sprite of [...this.nebulaGroup.children]) {
      this.nebulaGroup.remove(sprite);
      (sprite as THREE.Sprite).material.dispose();
    }
  }

  // ------------------------------------------------------------------ data

  setData(layout: UniverseLayout, nodes: GraphNode[], edges: GraphEdge[]) {
    // Detect this before replacing the layout/home values. A camera that is
    // zoomed, panned, or focused must not be reset merely because data changed.
    const followUpdatedHome = this.layout === null || this.isAtHomeView();
    this.disposeData();
    this.layout = layout;
    this.nodesById = new Map(nodes.map((n) => [n.id, n]));
    this.ids = [];
    this.indexById.clear();

    const n = layout.placements.size;
    this.positions = new Float32Array(n * 3);
    const origins = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.classes = new Float32Array(n);
    this.systemsAttr = new Float32Array(n);
    const states = new Float32Array(n);
    const seeds = new Float32Array(n);

    const color = new THREE.Color();
    let i = 0;
    for (const p of layout.placements.values()) {
      this.ids.push(p.id);
      this.indexById.set(p.id, i);
      this.positions[i * 3] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;
      origins[i * 3] = p.origin.x;
      origins[i * 3 + 1] = p.origin.y;
      origins[i * 3 + 2] = p.origin.z;
      const visuals = NODE_VISUALS[p.nodeClass];
      const node = this.nodesById.get(p.id);
      color.set(node?.color || visuals.color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      this.sizes[i] = p.paged ? 0 : visuals.size;
      this.classes[i] = p.nodeClass;
      this.systemsAttr[i] = p.systemIndex;
      states[i] = NodeState.Normal;
      seeds[i] = rand01(p.id, "seed");
      i++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("aOrigin", new THREE.BufferAttribute(origins, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute("aClass", new THREE.BufferAttribute(this.classes, 1));
    geo.setAttribute("aSystem", new THREE.BufferAttribute(this.systemsAttr, 1));
    this.stateAttr = new THREE.BufferAttribute(states, 1);
    this.stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aState", this.stateAttr);
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(layout.center.x, layout.center.y, layout.center.z),
      layout.bounds * 2
    );

    this.nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX,
      fragmentShader: NODE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uExpansion: { value: 0 },
        uFocusSystem: { value: -1 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uSizeScale: { value: 2.6 },
        uLight: { value: 0 },
      },
    });
    this.nodePoints = new THREE.Points(geo, this.nodeMaterial);
    this.nodePoints.frustumCulled = false;
    this.nodePoints.renderOrder = 3;
    this.scene.add(this.nodePoints);

    this.buildEdges(layout, edges);

    // Camera bounds: aspect-aware so the whole universe fits at max zoom-out
    // on any orientation (recomputed again on every resize).
    this.layoutBounds = layout.bounds;
    this.layoutCoreBounds = layout.coreBounds;
    this.homeTarget.set(layout.center.x, layout.center.y, layout.center.z);
    this.updateCameraRange();
    if (this.focus.level === "universe" && followUpdatedHome) {
      this.orbit.target.copy(this.homeTarget);
      this.orbit.dist = this.homeDist;
    }

    // Restore transient visual state onto the fresh buffers
    this.refreshStates();
    this.rebuildNebulae();
    this.invalidate();
  }

  private buildEdges(layout: UniverseLayout, edges: GraphEdge[]) {
    const usable = edges.filter((e) => {
      const s = layout.placements.get(e.source);
      const t = layout.placements.get(e.target);
      return s && t && !s.paged && !t.paged;
    });
    const m = usable.length;
    const positions = new Float32Array(m * 6);
    const origins = new Float32Array(m * 6);
    const systems = new Float32Array(m * 2);
    const kinds = new Float32Array(m * 2);
    const alphas = new Float32Array(m * 2);

    usable.forEach((e, j) => {
      const s = layout.placements.get(e.source)!;
      const t = layout.placements.get(e.target)!;
      const child = e.type === "contains" || e.type === "derived";
      const system = child ? t.systemIndex : -2;
      const baseAlpha = e.type === "contains" ? 0.4 : e.type === "derived" ? 0.3 : 0.16;
      for (const [end, p] of [s, t].entries()) {
        const v = j * 2 + end;
        positions[v * 3] = p.position.x;
        positions[v * 3 + 1] = p.position.y;
        positions[v * 3 + 2] = p.position.z;
        origins[v * 3] = p.origin.x;
        origins[v * 3 + 1] = p.origin.y;
        origins[v * 3 + 2] = p.origin.z;
        systems[v] = system;
        kinds[v] = child ? 1 : 0;
        alphas[v] = baseAlpha;
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aOrigin", new THREE.BufferAttribute(origins, 3));
    geo.setAttribute("aSystem", new THREE.BufferAttribute(systems, 1));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), (this.layout?.bounds ?? 500) * 2);

    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERTEX,
      fragmentShader: EDGE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uExpansion: { value: 0 },
        uFocusSystem: { value: -1 },
        uEdgeColor: { value: new THREE.Color("#64748b") },
        uAccent: { value: new THREE.Color("#3b82f6") },
      },
    });
    this.edgeLines = new THREE.LineSegments(geo, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.edgeLines.renderOrder = 2;
    this.scene.add(this.edgeLines);
  }

  // ------------------------------------------------------------- backdrop

  private buildStarfield() {
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const seeds = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const id = `bgstar-${i}`;
      const y = 1 - 2 * rand01(id, "y");
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = rand01(id, "a") * Math.PI * 2;
      const radius = 0.75 + rand01(id, "r") * 0.5;
      positions[i * 3] = r * Math.cos(a) * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = r * Math.sin(a) * radius;
      sizes[i] = 1 + rand01(id, "s") * 2.2;
      seeds[i] = rand01(id, "seed");
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWarp: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, MAX_DPR) },
        uStarColor: { value: new THREE.Color("#dbe4ff") },
        uLight: { value: 0 },
      },
    });
    this.starField = new THREE.Points(geo, this.starMaterial);
    this.starField.frustumCulled = false;
    this.starField.renderOrder = 0;
    this.scene.add(this.starField);
  }

  private repositionStarfield(bounds: number) {
    // The unit sphere of stars wraps the whole galaxy — and always stays
    // outside the zoom-out limit (narrow viewports push maxDist far beyond
    // the bounds-based shell).
    this.starField?.scale.setScalar(Math.max(bounds * 5 + 800, this.maxDist * 1.25));
  }

  private buildRings() {
    const geo = new THREE.RingGeometry(0.982, 1.0, 128);
    geo.rotateX(-Math.PI / 2);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#8ea8ff"),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ringMesh = new THREE.InstancedMesh(geo, this.ringMaterial, 16);
    this.ringMesh.count = 0;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 1;
    this.scene.add(this.ringMesh);
  }

  private updateRings() {
    if (!this.ringMesh || !this.layout) return;
    const system = this.focusedSystem();
    if (!system || this.expansion <= 0.01) {
      this.ringMesh.count = 0;
      return;
    }
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3(system.center.x, system.center.y, system.center.z);
    const count = Math.min(system.rings.length, 16);
    for (let i = 0; i < count; i++) {
      const ring = system.rings[i];
      quat.setFromEuler(new THREE.Euler(ring.tiltX, 0, ring.tiltZ));
      const r = ring.radius * this.expansion;
      scale.set(r, 1, r);
      mat.compose(pos, quat, scale);
      this.ringMesh.setMatrixAt(i, mat);
    }
    this.ringMesh.count = count;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMaterial) {
      this.ringMaterial.opacity = 0.16 * this.expansion;
    }
  }

  private rebuildNebulae() {
    for (const sprite of [...this.nebulaGroup.children]) {
      this.nebulaGroup.remove(sprite);
      (sprite as THREE.Sprite).material.dispose();
    }
    if (!this.layout) return;
    if (!this.nebulaTexture) {
      const size = 256;
      const cv = document.createElement("canvas");
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      this.nebulaTexture = new THREE.CanvasTexture(cv);
    }
    const top = [...this.layout.clusters]
      .sort((a, b) => b.docCount - a.docCount)
      .slice(0, MAX_NEBULAE);
    const isLight = (this.nodeMaterial?.uniforms.uLight.value ?? 0) > 0.5;
    for (const cluster of top) {
      const mat = new THREE.SpriteMaterial({
        map: this.nebulaTexture,
        transparent: true,
        depthWrite: false,
        blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
        opacity: isLight ? 0.09 : 0.17,
      });
      mat.color.setHSL(cluster.hue / 360, isLight ? 0.55 : 0.7, isLight ? 0.72 : 0.5);
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(cluster.center.x, cluster.center.y, cluster.center.z);
      sprite.scale.setScalar(cluster.radius * 3.4);
      sprite.renderOrder = 1;
      this.nebulaGroup.add(sprite);
    }
  }

  // ------------------------------------------------------------------ theme

  setTheme(spec: UniverseThemeSpec) {
    const bg = new THREE.Color(spec.background);
    if (spec.isDark) {
      bg.lerp(new THREE.Color("#01030a"), 0.55); // push toward deep space
    }
    this.renderer.setClearColor(bg, 1);

    if (this.nodeMaterial) {
      this.nodeMaterial.uniforms.uLight.value = spec.isDark ? 0 : 1;
      this.nodeMaterial.blending = spec.isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.nodeMaterial.needsUpdate = true;
    }
    if (this.edgeMaterial) {
      const edge = this.edgeMaterial.uniforms.uEdgeColor.value as THREE.Color;
      edge.set(spec.isDark ? "#64748b" : "#475569");
      (this.edgeMaterial.uniforms.uAccent.value as THREE.Color).set(spec.accent);
      this.edgeMaterial.blending = spec.isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.edgeMaterial.needsUpdate = true;
    }
    if (this.starMaterial) {
      this.starMaterial.uniforms.uLight.value = spec.isDark ? 0 : 1;
      (this.starMaterial.uniforms.uStarColor.value as THREE.Color).set(
        spec.isDark ? "#dbe4ff" : "#7a8db0"
      );
      this.starMaterial.blending = spec.isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.starMaterial.needsUpdate = true;
    }
    if (this.ringMaterial) {
      this.ringMaterial.color.set(spec.isDark ? "#8ea8ff" : "#5872b5");
    }
    this.rebuildNebulae();
    this.invalidate();
  }

  // ------------------------------------------------------- interaction state

  private setStateFor(id: string | null, prevId: string | null) {
    if (prevId) this.writeState(prevId);
    if (id) this.writeState(id);
  }

  /** Recompute one node's aState from hover/selection/search sets. */
  private writeState(id: string) {
    const i = this.indexById.get(id);
    if (i === undefined || !this.stateAttr) return;
    let s = NodeState.Normal;
    if (this.searchMatches.has(id)) s = NodeState.SearchMatch;
    if (id === this.hoveredId) s = NodeState.Hovered;
    if (id === this.selectedId) s = NodeState.Selected;
    (this.stateAttr.array as Float32Array)[i] = s;
    this.stateAttr.needsUpdate = true;
  }

  private refreshStates() {
    if (!this.stateAttr) return;
    const arr = this.stateAttr.array as Float32Array;
    arr.fill(NodeState.Normal);
    for (const id of this.searchMatches) {
      const i = this.indexById.get(id);
      if (i !== undefined) arr[i] = NodeState.SearchMatch;
    }
    if (this.hoveredId) {
      const i = this.indexById.get(this.hoveredId);
      if (i !== undefined) arr[i] = NodeState.Hovered;
    }
    if (this.selectedId) {
      const i = this.indexById.get(this.selectedId);
      if (i !== undefined) arr[i] = NodeState.Selected;
    }
    this.stateAttr.needsUpdate = true;
  }

  setHovered(id: string | null) {
    if (id === this.hoveredId) return;
    const prev = this.hoveredId;
    this.hoveredId = id;
    this.setStateFor(id, prev);
    this.invalidate();
  }

  setSelected(id: string | null) {
    if (id === this.selectedId) return;
    const prev = this.selectedId;
    this.selectedId = id;
    this.setStateFor(id, prev);
    this.invalidate();
  }

  setSearchMatches(ids: Set<string>) {
    this.searchMatches = ids;
    this.refreshStates();
    this.touch(); // searching counts as interaction so match pulses animate
    this.invalidate();
  }

  // ----------------------------------------------------------------- focus

  getFocus(): FocusState {
    return this.focus;
  }

  private focusedSystem(): UniverseSystem | null {
    if (!this.layout || this.focusSystemIndex < 0) return null;
    return this.layout.systemList[this.focusSystemIndex] ?? null;
  }

  private clearCameraTweens() {
    this.tweens = this.tweens.filter((t) => !(t as Tween & { isCamera?: boolean }).isCamera);
  }

  private tweenTo(
    target: { target?: THREE.Vector3; dist?: number; phi?: number; theta?: number; expansion?: number },
    duration: number,
    opts: { warp?: boolean; onDone?: () => void } = {}
  ) {
    const from = {
      target: this.orbit.target.clone(),
      dist: this.orbit.dist,
      phi: this.orbit.phi,
      theta: this.orbit.theta,
      expansion: this.expansion,
    };
    const to = {
      target: target.target ?? from.target,
      dist: target.dist ?? from.dist,
      phi: target.phi ?? from.phi,
      theta: target.theta !== undefined ? shortestAngle(from.theta, target.theta) : from.theta,
      expansion: target.expansion ?? from.expansion,
    };

    // Hidden documents get no animation frames — apply transitions instantly
    // there so focus changes never stall half-way.
    if (this.reducedMotion || duration <= 0 || document.hidden) {
      this.orbit.target.copy(to.target);
      this.orbit.dist = to.dist;
      this.orbit.phi = to.phi;
      this.orbit.theta = to.theta;
      this.expansion = to.expansion;
      this.warp = 0;
      opts.onDone?.();
      this.invalidate();
      return;
    }

    this.clearCameraTweens();
    const tween: Tween & { isCamera?: boolean } = {
      elapsed: 0,
      duration,
      isCamera: true,
      update: (k) => {
        this.orbit.target.lerpVectors(from.target, to.target, k);
        this.orbit.dist = THREE.MathUtils.lerp(from.dist, to.dist, k);
        this.orbit.phi = THREE.MathUtils.lerp(from.phi, to.phi, k);
        this.orbit.theta = THREE.MathUtils.lerp(from.theta, to.theta, k);
        this.expansion = THREE.MathUtils.lerp(from.expansion, to.expansion, k);
        if (opts.warp) {
          const wave = Math.sin(Math.PI * k);
          this.warp = wave;
          this.camera.fov = this.baseFov + 14 * wave;
          this.camera.updateProjectionMatrix();
        }
      },
      onDone: () => {
        if (opts.warp) {
          this.warp = 0;
          this.camera.fov = this.baseFov;
          this.camera.updateProjectionMatrix();
        }
        opts.onDone?.();
      },
    };
    this.tweens.push(tween);
    this.invalidate();
  }

  private systemViewDist(system: UniverseSystem): number {
    const maxRing = system.rings.length ? system.rings[system.rings.length - 1].radius : 20;
    return Math.max(maxRing * 3.1, 78);
  }

  setFocus(focus: FocusState, opts: { instant?: boolean; warp?: boolean } = {}) {
    if (!this.layout) {
      this.focus = focus;
      return;
    }
    this.focus = focus;
    const duration = opts.instant ? 0 : opts.warp ? WARP_TWEEN_MS : FOCUS_TWEEN_MS;

    if (focus.level === "universe") {
      // Collapse orbits, fly home; clear the focused system once collapsed.
      this.tweenTo(
        { target: this.homeTarget.clone(), dist: this.homeDist, phi: 1.05, expansion: 0 },
        duration,
        {
          onDone: () => {
            this.focusSystemIndex = -1;
            this.invalidate();
          },
        }
      );
      return;
    }

    const system = this.layout.systems.get(focus.docId);
    if (!system) return;

    const switching = this.focusSystemIndex >= 0 && this.focusSystemIndex !== system.index;
    if (switching || this.focusSystemIndex < 0) {
      // Snap-collapse any previously expanded system, then expand the new one.
      this.expansion = 0;
      this.focusSystemIndex = system.index;
    }

    if (focus.level === "system") {
      this.tweenTo(
        {
          target: new THREE.Vector3(system.center.x, system.center.y, system.center.z),
          dist: this.systemViewDist(system),
          expansion: 1,
        },
        duration,
        { warp: opts.warp }
      );
    } else {
      const i = this.indexById.get(focus.nodeId);
      const p = i !== undefined
        ? new THREE.Vector3(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2])
        : new THREE.Vector3(system.center.x, system.center.y, system.center.z);
      this.tweenTo({ target: p, dist: 34, expansion: 1 }, duration, { warp: opts.warp });
    }
  }

  resetView(instant = false) {
    this.setFocus({ level: "universe" }, { instant });
  }

  /** Warp jump (search travel): big tween with FOV kick + starfield streaks. */
  warpTo(focus: FocusState) {
    this.touch();
    this.setFocus(focus, { warp: true });
  }

  /** Fly the camera to an arbitrary point (halo tags, belt orphans). */
  flyToPoint(x: number, y: number, z: number, dist = 60, warp = false) {
    this.touch();
    this.tweenTo(
      { target: new THREE.Vector3(x, y, z), dist },
      warp ? WARP_TWEEN_MS : FOCUS_TWEEN_MS,
      { warp }
    );
  }

  // ---------------------------------------------------------------- picking

  /** Visible-for-picking test mirroring the vertex shader's visibility rules. */
  private isPickable(i: number): boolean {
    if (this.sizes[i] <= 0) return false; // paged
    const cls = this.classes[i];
    if (cls === NodeClass.Planet || cls === NodeClass.Moon) {
      const sys = this.systemsAttr[i];
      if (sys < 0) return true; // belt
      return sys === this.focusSystemIndex && this.expansion > 0.5;
    }
    return true;
  }

  /**
   * Screen-space nearest-node pick. Runs only on discrete pointer events.
   * Returns the node id or null.
   */
  pickAt(clientX: number, clientY: number): string | null {
    if (!this.layout || this.ids.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    this.applyCamera();
    const viewProj = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    const v = new THREE.Vector4();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    const cam = this.camera.position;
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.ids.length; i++) {
      if (!this.isPickable(i)) continue;
      const wx = this.positions[i * 3];
      const wy = this.positions[i * 3 + 1];
      const wz = this.positions[i * 3 + 2];
      v.set(wx, wy, wz, 1);
      v.applyMatrix4(viewProj);
      if (v.w <= 0) continue; // behind the camera
      const sx = (v.x / v.w) * halfW + halfW;
      const sy = -(v.y / v.w) * halfH + halfH;
      const dx = sx - px;
      const dy = sy - py;
      const distSq = dx * dx + dy * dy;
      // Screen radius mirrors the shader: aSize * atten / 2 (CSS px) + slack
      const camDist = Math.sqrt((wx - cam.x) ** 2 + (wy - cam.y) ** 2 + (wz - cam.z) ** 2);
      const radius = Math.max(7, (this.sizes[i] * (160 / Math.max(1, camDist))) / 2 + 5);
      if (distSq <= radius * radius && distSq < bestDist) {
        bestDist = distSq;
        bestId = this.ids[i];
      }
    }
    return bestId;
  }

  /** Project a node to CSS-pixel screen coordinates (for HTML overlay labels). */
  projectToScreen(id: string): { x: number; y: number; visible: boolean } | null {
    const i = this.indexById.get(id);
    if (i === undefined) return null;
    return this.projectPoint(
      this.positions[i * 3],
      this.positions[i * 3 + 1],
      this.positions[i * 3 + 2]
    );
  }

  projectPoint(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector4(x, y, z, 1);
    const viewProj = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    v.applyMatrix4(viewProj);
    if (v.w <= 0) return { x: 0, y: 0, visible: false };
    const sx = (v.x / v.w + 1) * 0.5 * rect.width;
    const sy = (1 - (v.y / v.w + 1) * 0.5) * rect.height;
    const visible = sx >= -80 && sx <= rect.width + 80 && sy >= -40 && sy <= rect.height + 40;
    return { x: sx, y: sy, visible };
  }

  getDrawCalls(): number {
    return this.renderer.info.render.calls;
  }

  zoomBy(factor: number, opts: { animated?: boolean } = {}) {
    this.touch();
    const dist = THREE.MathUtils.clamp(this.orbit.dist * factor, this.minDist, this.maxDist);
    if (opts.animated) {
      this.tweenTo({ dist }, TAP_ZOOM_TWEEN_MS);
    } else {
      this.orbit.dist = dist;
      this.invalidate();
    }
  }

  /**
   * Focal-point zoom: scale the orbit distance while keeping the world point
   * under the given screen position visually anchored (pinch center,
   * double-tap point).
   */
  zoomToward(clientX: number, clientY: number, factor: number, opts: { animated?: boolean } = {}) {
    this.touch();
    const newDist = THREE.MathUtils.clamp(this.orbit.dist * factor, this.minDist, this.maxDist);
    if (newDist === this.orbit.dist) return;
    const anchor = this.anchorOnTargetPlane(clientX, clientY);
    let target = this.orbit.target;
    if (anchor) {
      const shifted = anchorShift(anchor, this.orbit.target, this.orbit.dist, newDist);
      target = new THREE.Vector3(shifted.x, shifted.y, shifted.z);
    }
    if (opts.animated) {
      this.tweenTo({ target: target.clone(), dist: newDist }, TAP_ZOOM_TWEEN_MS);
    } else {
      this.orbit.target.copy(target);
      this.orbit.dist = newDist;
      this.invalidate();
    }
  }

  /** Intersect the pointer ray with the plane through the orbit target that is
   * perpendicular to the view direction (the anchor plane for focal zoom). */
  private anchorOnTargetPlane(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.applyCamera();
    const ndc = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
      0.5
    );
    const dir = ndc.unproject(this.camera).sub(this.camera.position).normalize();
    const viewDir = this.orbit.target.clone().sub(this.camera.position).normalize();
    const denom = dir.dot(viewDir);
    if (denom < 1e-4) return null;
    return this.camera.position.clone().addScaledVector(dir, this.orbit.dist / denom);
  }
}
