/**
 * Knowledge Sphere Tab
 * Beautiful 3D globe visualization of your knowledge
 */

import { useEffect, useState, useCallback } from "react";
import { KnowledgeUniverseLazy } from "../../graph/KnowledgeUniverseLazy";
import { GraphNodeType, type GraphNode, type GraphEdge } from "../../graph/KnowledgeGraph";
import { invokeCommand } from "../../../lib/tauri";
import { useCollectionStore } from "../../../stores/collectionStore";
import { useTabsStore } from "../../../stores/tabsStore";
import { useReviewStore } from "../../../stores/reviewStore";
import { DocumentViewer, ReviewTab } from "../TabRegistry";
import { useToast } from "../../common/Toast";
import { useContextMenu, ContextMenu, ContextMenuItemType } from "../../common/ContextMenu";
import { ConfirmDialog, useConfirmDialog } from "../../common/ConfirmDialog";
import { getDocument, updateDocument, deleteDocument } from "../../../api/documents";
import { updateExtract, deleteExtract } from "../../../api/extracts";
import { useI18n } from "../../../lib/i18n";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Brain,
  Planet,
  Quotes,
  TextT,
  Trash,
} from "@phosphor-icons/react";

export function KnowledgeSphereTab() {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeCollectionId = useCollectionStore((state) => state.activeCollectionId);

  const { addTab } = useTabsStore();
  const toast = useToast();
  const nodeContextMenu = useContextMenu("node-context-menu");
  const confirmDialog = useConfirmDialog();
  const [_contextNode, setContextNode] = useState<GraphNode | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);

    try {
      const documents = await invokeCommand<any[]>("get_documents", { collectionId: activeCollectionId ?? null });
      const extracts = await invokeCommand<any[]>("get_extracts", { documentId: null });
      const learningItems = await invokeCommand<any[]>("get_all_learning_items");

      const inActiveCollection = (documentId?: string | null) => {
        if (!activeCollectionId) return true;
        if (!documentId) return true;
        const doc = documents.find((d: any) => d.id === documentId);
        return doc ? !doc.collectionId || doc.collectionId === activeCollectionId : true;
      };

      const graphNodes: GraphNode[] = [];
      const graphEdges: GraphEdge[] = [];

      // Add documents
      documents.filter((doc: any) => inActiveCollection(doc.id)).forEach((doc: any) => {
        graphNodes.push({
          id: `doc-${doc.id}`,
          type: GraphNodeType.Document,
          label: doc.title || "Untitled",
          description: doc.description,
          x: 0,
          y: 0,
          color: "#3b82f6",
          category: doc.category,
          tags: doc.tags,
        });
      });

      // Add extracts
      extracts.filter((extract: any) => inActiveCollection(extract.documentId)).forEach((extract: any) => {
        graphNodes.push({
          id: `extract-${extract.id}`,
          type: GraphNodeType.Extract,
          label: extract.content ? `${extract.content.substring(0, 30)}...` : "Extract",
          description: extract.note,
          x: 0,
          y: 0,
          color: "#22c55e",
          category: extract.category,
          tags: extract.tags,
          metadata: {
            documentId: extract.documentId,
            pageNumber: extract.pageNumber,
          },
        });

        graphEdges.push({
          id: `edge-extract-${extract.id}`,
          source: `doc-${extract.documentId}`,
          target: `extract-${extract.id}`,
          type: "contains",
        });
      });

      // Add flashcards
      learningItems.filter((item: any) => inActiveCollection(item.documentId)).forEach((item: any) => {
        graphNodes.push({
          id: `card-${item.id}`,
          type: GraphNodeType.Flashcard,
          label: item.question ? `${item.question.substring(0, 20)}...` : "Card",
          description: item.answer,
          x: 0,
          y: 0,
          color: "#a855f7",
          tags: item.tags,
          metadata: {
            documentId: item.documentId,
            extractId: item.extractId,
          },
        });

        if (item.extractId) {
          graphEdges.push({
            id: `edge-card-${item.id}`,
            source: `extract-${item.extractId}`,
            target: `card-${item.id}`,
            type: "derived",
          });
        }
      });

      setNodes(graphNodes);
      setEdges(graphEdges);
    } catch (error) {
      console.error("Failed to load sphere data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [activeCollectionId]);

  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    switch (node.type) {
      case GraphNodeType.Document:
        addTab({
          title: node.label,
          icon: <TextT className="w-4 h-4 text-muted-foreground" />,
          type: "document-viewer",
          content: DocumentViewer,
          closable: true,
          data: { documentId: node.id.replace("doc-", "") },
        });
        break;
      case GraphNodeType.Extract: {
        const parentDocumentId = String(
          node.metadata?.documentId ||
          edges.find((edge) => edge.target === node.id && edge.source.startsWith("doc-"))?.source ||
          ""
        ).replace("doc-", "");
        addTab({
          title: node.label.substring(0, 30),
          icon: <Quotes className="w-4 h-4 text-muted-foreground" />,
          type: "document-viewer",
          content: DocumentViewer,
          closable: true,
          data: {
            documentId: parentDocumentId,
            initialViewMode: "extracts",
          },
        });
        break;
      }
      case GraphNodeType.Flashcard:
        addTab({
          title: "Review",
          icon: <Brain className="w-4 h-4" />,
          type: "review",
          content: ReviewTab,
          closable: true,
        });
        void useReviewStore.getState().startReviewAtItem(node.id.replace("card-", ""));
        break;
    }
  }, [addTab, edges]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    let typeLabel = "Item";
    if (node.type === GraphNodeType.Document) typeLabel = "Document";
    if (node.type === GraphNodeType.Extract) typeLabel = "Extract";
    if (node.type === GraphNodeType.Flashcard) typeLabel = "Flashcard";

    confirmDialog.confirm({
      title: `Delete ${typeLabel}`,
      message: `Are you sure you want to delete "${node.label}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        try {
          if (node.type === GraphNodeType.Document) {
            await deleteDocument(nodeId.replace("doc-", ""));
          } else if (node.type === GraphNodeType.Extract) {
            await deleteExtract(nodeId.replace("extract-", ""));
          } else if (node.type === GraphNodeType.Flashcard) {
            await invokeCommand("delete_learning_item", { itemId: nodeId.replace("card-", "") });
          }
          toast.success("Item deleted successfully");
          await loadData();
        } catch (err: any) {
          console.error(err);
          toast.error(`Failed to delete item: ${err.message || err}`);
        }
      },
    });
  }, [nodes, confirmDialog, toast, loadData]);

  const handleSaveNodeDetails = useCallback(async (
    nodeId: string,
    updates: {
      label?: string;
      description?: string;
      category?: string;
      tags?: string[];
    }
  ) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.type === GraphNodeType.Document) {
      const documentId = node.id.replace("doc-", "");
      const doc = await getDocument(documentId);
      if (!doc) throw new Error("Document not found");

      await updateDocument(documentId, {
        ...doc,
        title: updates.label || doc.title,
        category: updates.category,
        tags: updates.tags ?? doc.tags,
      });
      await loadData();
      toast.success("Document updated successfully");
    } else if (node.type === GraphNodeType.Extract) {
      const extractId = node.id.replace("extract-", "");
      await updateExtract({
        id: extractId,
        content: updates.label,
        tags: updates.tags,
      });
      await loadData();
      toast.success("Extract updated successfully");
    } else if (node.type === GraphNodeType.Flashcard) {
      const itemId = node.id.replace("card-", "");
      await invokeCommand("update_learning_item_content_with_version", {
        itemId,
        question: updates.label,
        tags: updates.tags,
      });
      await loadData();
      toast.success("Flashcard updated successfully");
    }
  }, [nodes, toast, loadData]);

  const handleNodeContextMenu = useCallback(
    (node: GraphNode, position: { x: number; y: number }) => {
      setContextNode(node);
      nodeContextMenu.showMenu(position, [
        {
          id: "open",
          label: "Open Item",
          icon: <ArrowSquareOut className="w-4 h-4" />,
          onClick: () => handleNodeDoubleClick(node),
        },
        ...(node.type === GraphNodeType.Document ||
        node.type === GraphNodeType.Extract ||
        node.type === GraphNodeType.Flashcard
          ? [
              { id: "sep1", type: ContextMenuItemType.Separator, label: "" },
              {
                id: "delete",
                label: "Delete",
                icon: <Trash className="w-4 h-4" />,
                type: ContextMenuItemType.Danger,
                onClick: () => handleNodeDelete(node.id),
              },
            ]
          : []),
      ]);
    },
    [handleNodeDoubleClick, handleNodeDelete, nodeContextMenu]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Planet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">{t("universe.title")}</h2>
                <p className="text-sm text-muted-foreground">{t("universe.tagline")}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-muted-foreground">{t("universe.loading")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Planet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{t("universe.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("universe.subtitle", { count: nodes.length })}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-2 hover:bg-muted rounded-xl text-sm font-medium transition-colors"
        >
          <ArrowsClockwise className="w-4 h-4" />
          {t("universe.refresh")}
        </button>
      </div>

      {/* Universe */}
      <div className="flex-1 relative">
        <KnowledgeUniverseLazy
          nodes={nodes}
          edges={edges}
          datasetKey={activeCollectionId ?? "all"}
          showHeader={false}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeDelete={handleNodeDelete}
          onNodeSave={handleSaveNodeDetails}
        />

        {/* Quick stats overlay */}
        <div className="absolute bottom-6 left-6 bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg p-4 pointer-events-none">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">{t("graph.documents")}:</span>
              <span className="font-medium">
                {nodes.filter((n) => n.type === GraphNodeType.Document).length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-muted-foreground">{t("graph.extracts")}:</span>
              <span className="font-medium">
                {nodes.filter((n) => n.type === GraphNodeType.Extract).length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <span className="text-muted-foreground">{t("graph.flashcards")}:</span>
              <span className="font-medium">
                {nodes.filter((n) => n.type === GraphNodeType.Flashcard).length}
              </span>
            </div>
            <div className="pt-2 border-t border-border mt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("universe.connections")}:</span>
                <span className="font-medium">{edges.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Node Context Menu */}
      <ContextMenu
        menuId="node-context-menu"
        items={nodeContextMenu.items}
        visible={nodeContextMenu.visible}
        position={nodeContextMenu.position}
        onClose={nodeContextMenu.hideMenu}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={confirmDialog.close}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        confirmLabel={confirmDialog.confirmLabel}
      />
    </div>
  );
}
