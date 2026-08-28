/**
 * WebGL2 effect shader registry — every GPU-migrated theme effect.
 *
 * Shaders are pure data modules: fragment source + default palette (+ the
 * jellyfish theme-palette resolver). Adding an effect here registers it in
 * EFFECT_REGISTRY as GPU-preferred with its Canvas2D implementation retained
 * as the fallback.
 */
import type { WebGLEffect } from "../../types";
import { plasmaEffect } from "./plasma";
import { auroraEffect } from "./aurora";
import { nebulaEffect } from "./nebula";
import { oceanwavesEffect } from "./oceanwaves";
import { northernEffect } from "./northern";
import { underwaterEffect } from "./underwater";
import { sunbeamsEffect } from "./sunbeams";
import { synthsunEffect } from "./synthsun";
import { lavalampEffect } from "./lavalamp";
import { cosmicdustEffect } from "./cosmicdust";
import { bioglowEffect } from "./bioglow";
import { starwarpEffect } from "./starwarp";
import { jellyfishEffect } from "./jellyfish";

export const WEBGL_EFFECTS: readonly WebGLEffect[] = [
  plasmaEffect,
  auroraEffect,
  nebulaEffect,
  oceanwavesEffect,
  northernEffect,
  underwaterEffect,
  sunbeamsEffect,
  synthsunEffect,
  lavalampEffect,
  cosmicdustEffect,
  bioglowEffect,
  starwarpEffect,
  jellyfishEffect,
];
