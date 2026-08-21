import type { ItemTagTarget } from "./types";
import {
  extractOrganizationContainer,
  withOrganizationContainer,
  type BrowserOrganizationMetadata,
} from "../smartTagging/browserImportOrganization";

function recordBrowserTagAuthority(
  organization: BrowserOrganizationMetadata | undefined,
  previousTags: string[],
  nextTags: string[],
): BrowserOrganizationMetadata | undefined {
  if (!organization) return undefined;
  const manualTags = new Set(organization.manualTags || []);
  const dismissedTags = new Set(organization.dismissedTags || []);
  for (const tag of nextTags) {
    if (!previousTags.includes(tag)) manualTags.add(tag);
  }
  for (const tag of previousTags) {
    if (!nextTags.includes(tag)) dismissedTags.add(tag);
  }
  return {
    ...organization,
    status: "completed",
    manualTags: Array.from(manualTags),
    dismissedTags: Array.from(dismissedTags),
    userConfirmedAt: new Date().toISOString(),
  };
}

/**
 * One item-type mutation adapter for persisted tag arrays. Dispatches to the
 * existing document / extract / learning-item update APIs (no new backend
 * command) and always persists the COMPLETE next tag array, matching current
 * persistence semantics. Returns the persisted tag list for reconciliation.
 *
 * Web-mode caveat: the Tauri-only `update_learning_item_tags` command is a
 * silent no-op in the browser/PWA shell (no browser-backend handler), so in
 * web mode learning-item tag saves route through the generic
 * `update_learning_item` partial-update handler instead.
 *
 * All API/tauri modules are imported lazily (dynamic import) so surfaces that
 * merely embed the shared editor — especially virtualized Schedule rows — do
 * not pull the api/browser-backend chain into their module graph at load
 * time, and component tests keep their own mocks.
 */
export async function persistItemTags(target: ItemTagTarget, nextTags: string[]): Promise<string[]> {
  if (target.type === "document") {
    // The Rust Document struct has no #[serde(default)] on `tags`, so a
    // partial payload fails deserialization: always spread the full doc.
    const { getDocument, updateDocument } = await import("../../api/documents");
    const doc = await getDocument(target.id);
    if (!doc) throw new Error("Document not found");

    const prevTags = doc.tags || [];
    const isBrowserImport = doc.metadata?.source === "browser_extension"
      || doc.metadata?.captureProvenance?.source === "browser_extension"
      || Boolean(doc.metadata?.browserCaptureContext || doc.metadata?.organization);
    const prevDetails = isBrowserImport && doc.metadata?.smartTagDetails
      ? [...doc.metadata.smartTagDetails]
      : [];
    const now = new Date().toISOString();
    const organization = isBrowserImport
      ? recordBrowserTagAuthority(doc.metadata?.organization, prevTags, nextTags)
      : undefined;

    // 1. Added tags marked as manual
    for (const tag of nextTags) {
      if (!prevTags.includes(tag)) {
        const existingIdx = prevDetails.findIndex((d) => d.tag.toLowerCase() === tag.toLowerCase());
        const detail = {
          tag,
          provenance: "manual" as const,
          confidence: 1.0,
          reason: "Manually added by user",
          assignedAt: now,
          dismissed: false,
        };
        if (existingIdx >= 0) {
          prevDetails[existingIdx] = detail;
        } else {
          prevDetails.push(detail);
        }
      }
    }

    // 2. Removed tags marked as dismissed
    for (const tag of prevTags) {
      if (!nextTags.includes(tag)) {
        const existingIdx = prevDetails.findIndex((d) => d.tag.toLowerCase() === tag.toLowerCase());
        if (existingIdx >= 0) {
          prevDetails[existingIdx] = {
            ...prevDetails[existingIdx],
            dismissed: true,
          };
        } else {
          prevDetails.push({
            tag,
            provenance: "manual" as const,
            confidence: 1.0,
            reason: "Dismissed by user",
            assignedAt: now,
            dismissed: true,
          });
        }
      }
    }

    const updatedMetadata = isBrowserImport
      ? {
          ...(doc.metadata || {}),
          smartTagDetails: prevDetails,
          ...(organization ? { organization } : {}),
        }
      : undefined;

    await updateDocument(target.id, {
      ...doc,
      tags: nextTags,
      ...(updatedMetadata ? { metadata: updatedMetadata } : {}),
    });
    return nextTags;
  }

  if (target.type === "extract") {
    const extractsApi = await import("../../api/extracts");
    const updateExtract = extractsApi.updateExtract;
    const getExtract = "getExtract" in extractsApi
      ? (extractsApi as typeof extractsApi & {
          getExtract: (id: string) => Promise<Awaited<ReturnType<typeof extractsApi.updateExtract>> | null>;
        }).getExtract
      : undefined;
    // Preserve the minimal update contract for embedded editor consumers that
    // only provide the historical updateExtract mock/API surface.
    if (!getExtract) {
      await updateExtract({ id: target.id, tags: nextTags });
      return nextTags;
    }
    const extract = await getExtract(target.id);
    if (!extract) throw new Error("Extract not found");
    const container = extractOrganizationContainer(extract.selection_context);
    const organization = recordBrowserTagAuthority(container.organization, extract.tags || [], nextTags);
    await updateExtract({
      id: target.id,
      tags: nextTags,
      ...(organization ? {
        selection_context: withOrganizationContainer(extract.selection_context, {
          captureContext: container.captureContext,
          organization,
        }),
      } : {}),
    });
    return nextTags;
  }

  if (target.type === "learning-item") {
    const [learningItemsApi, tauriApi] = await Promise.all([
      import("../../api/learning-items"),
      import("../../lib/tauri"),
    ]);
    const updateLearningItemTags = learningItemsApi.updateLearningItemTags;
    const getLearningItem = "getLearningItem" in learningItemsApi
      ? (learningItemsApi as typeof learningItemsApi & {
          getLearningItem: (id: string) => Promise<Awaited<ReturnType<typeof learningItemsApi.updateLearningItemTags>> | null>;
        }).getLearningItem
      : undefined;
    const { invokeCommand, isTauri } = tauriApi;
    // As with extracts, retain the pre-organization path for callers that
    // expose only the existing tag mutation API.
    if (!getLearningItem) {
      if (isTauri()) await updateLearningItemTags(target.id, nextTags);
      else await invokeCommand("update_learning_item", { id: target.id, tags: nextTags });
      return nextTags;
    }
    const item = await getLearningItem(target.id);
    if (!item) throw new Error("Learning item not found");
    const container = extractOrganizationContainer(item.interaction_metadata);
    const organization = recordBrowserTagAuthority(container.organization, item.tags || [], nextTags);
    const interactionMetadata = organization
      ? {
          ...(item.interaction_metadata || {}),
          ...withOrganizationContainer(item.interaction_metadata, {
            captureContext: container.captureContext,
            organization,
          }),
        }
      : undefined;
    if (isTauri()) {
      await updateLearningItemTags(target.id, nextTags, interactionMetadata);
    } else {
      await invokeCommand("update_learning_item", {
        id: target.id,
        tags: nextTags,
        ...(interactionMetadata ? { interactionMetadata } : {}),
      });
    }
    return nextTags;
  }

  throw new Error(`Unsupported tag target type: ${(target as { type: string }).type}`);
}
