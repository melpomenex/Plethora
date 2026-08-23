import { KnowledgeGraphPage } from "../../../pages/KnowledgeGraphPage";
import type { MarketingSceneApplication } from "../../../lib/marketingCapture/sceneApplicators";

export function KnowledgeNetworkTab({
  captureConnection,
}: {
  captureConnection?: MarketingSceneApplication["connectionContext"];
}) {
  return <KnowledgeGraphPage captureConnection={captureConnection} />;
}
