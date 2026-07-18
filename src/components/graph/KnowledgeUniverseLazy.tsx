/**
 * Lazy entry for the Knowledge Universe. three.js and the engine live in an
 * async chunk, so app startup cost is unchanged until the view is opened.
 */

import { lazy, Suspense } from "react";
import type { KnowledgeUniverseProps } from "./universe/types";

const KnowledgeUniverseInner = lazy(() =>
  import("./KnowledgeUniverse").then((m) => ({ default: m.KnowledgeUniverse }))
);

export function KnowledgeUniverseLazy(props: KnowledgeUniverseProps) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      }
    >
      <KnowledgeUniverseInner {...props} />
    </Suspense>
  );
}
