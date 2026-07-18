/**
 * Node detail panel shared by the Knowledge Sphere and Knowledge Universe.
 * Shows a selected node's metadata, connection breakdown, and the inline
 * edit / open / focus / delete actions. Extracted from ObsidianSphere so both
 * renderers share the exact same flows.
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { GraphNodeType, type GraphNode, type GraphEdge } from "./KnowledgeGraph";
import {
  ArrowSquareOut,
  Brain,
  Check,
  Folder,
  PencilSimple,
  Quotes,
  Sparkle,
  Tag,
  Target,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";

const NODE_DETAIL_STYLES = {
  [GraphNodeType.Document]: {
    icon: TextT,
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    textColor: "text-blue-400",
  },
  [GraphNodeType.Extract]: {
    icon: Quotes,
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20",
    textColor: "text-green-400",
  },
  [GraphNodeType.Flashcard]: {
    icon: Brain,
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    textColor: "text-purple-400",
  },
  [GraphNodeType.Category]: {
    icon: Folder,
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    textColor: "text-amber-400",
  },
  [GraphNodeType.Tag]: {
    icon: Tag,
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
    textColor: "text-cyan-400",
  },
  [GraphNodeType.Rss]: {
    icon: Sparkle,
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
    textColor: "text-orange-400",
  },
};

const EDITABLE_TYPES = new Set([
  GraphNodeType.Document,
  GraphNodeType.Extract,
  GraphNodeType.Flashcard,
]);

export interface NodeDetailPanelProps {
  node: GraphNode;
  edges: GraphEdge[];
  onClose: () => void;
  /** Rotate/fly the view to center this node. */
  onFocus?: () => void;
  onOpen?: (node: GraphNode) => void;
  onSave?: (
    nodeId: string,
    updates: { label?: string; description?: string; category?: string; tags?: string[] }
  ) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  className?: string;
}

export function NodeDetailPanel({
  node,
  edges,
  onClose,
  onFocus,
  onOpen,
  onSave,
  onDelete,
  className,
}: NodeDetailPanelProps) {
  const { t } = useI18n();

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditLabel(node.label || "");
    setEditCategory(node.category || "");
    setEditTags((node.tags || []).join(", "));
    setEditDescription(node.description || "");
    setIsEditing(false);
    setIsSaving(false);
    setSaveError(null);
  }, [node.id, node.label, node.category, node.tags, node.description]);

  const connectionCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    edges.forEach((edge) => {
      if (edge.source === node.id || edge.target === node.id) {
        const type = edge.type || "related";
        counts[type] = (counts[type] || 0) + 1;
      }
    });
    return counts;
  }, [node.id, edges]);

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(node.id, {
        label: editLabel,
        category: editCategory || undefined,
        tags: editTags ? editTags.split(",").map((s) => s.trim()).filter(Boolean) : [],
        description: editDescription || undefined,
      });
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save details");
    } finally {
      setIsSaving(false);
    }
  };

  const detailConfig = NODE_DETAIL_STYLES[node.type] || {
    icon: Sparkle,
    bgColor: "bg-primary/10",
    borderColor: "border-primary/20",
    textColor: "text-primary",
  };
  const IconComponent = detailConfig.icon;

  const containerClass =
    className ??
    "absolute top-20 right-6 w-80 bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-5 pointer-events-auto flex flex-col gap-4 max-h-[calc(100vh-220px)] overflow-y-auto z-10 animate-glass-scale-in";

  if (isEditing) {
    return (
      <div className={containerClass}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Edit Node Details</span>
            <button
              onClick={() => setIsEditing(false)}
              className="text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Label</label>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="glass-input rounded-xl px-3 py-1.5 text-sm w-full bg-background/50 border border-border focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
          {node.type === GraphNodeType.Document && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <input
                type="text"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="glass-input rounded-xl px-3 py-1.5 text-sm w-full bg-background/50 border border-border focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
          )}
          {EDITABLE_TYPES.has(node.type) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Tags (comma separated)</label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                className="glass-input rounded-xl px-3 py-1.5 text-sm w-full bg-background/50 border border-border focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
          )}
          {node.type !== GraphNodeType.Flashcard && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Description / Content</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="glass-input rounded-xl px-3 py-1.5 text-sm w-full bg-background/50 border border-border focus:ring-1 focus:ring-primary focus:outline-none resize-none"
              />
            </div>
          )}
          {saveError && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2 mt-1">
              {saveError}
            </div>
          )}
          <div className="flex gap-2 mt-2 pt-2 border-t border-border">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Check className="w-4 h-4" />
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-muted text-muted-foreground rounded-xl text-sm font-semibold hover:bg-muted/80 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-3 pb-2 border-b border-border">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${detailConfig.bgColor} border ${detailConfig.borderColor}`}
          >
            <IconComponent className={`w-5 h-5 ${detailConfig.textColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm line-clamp-2 text-foreground">{node.label}</h3>
            <p className="text-xs text-muted-foreground capitalize">{node.type}</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded-lg transition-colors align-self-start"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        {(node.description || node.metadata?.description) && (
          <div className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-xl border border-border/40 line-clamp-4">
            {node.description || String(node.metadata?.description || "")}
          </div>
        )}

        {/* Metadata tags */}
        <div className="flex flex-wrap gap-1.5">
          {node.category && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Folder className="w-3.5 h-3.5" />
              {node.category}
            </span>
          )}
          {node.tags &&
            node.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-500 border border-cyan-500/20"
              >
                <Tag className="w-3.5 h-3.5" />
                {tag}
              </span>
            ))}
        </div>

        {/* Connection Stats */}
        <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Connections Breakdown
          </span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1">
            {Object.entries(connectionCountsByType).map(([type, count]) => (
              <div key={type} className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground capitalize">{type}:</span>
                <span className="font-semibold text-foreground">{count}</span>
              </div>
            ))}
            {Object.keys(connectionCountsByType).length === 0 && (
              <div className="text-xs text-muted-foreground italic col-span-2">No active connections</div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border mt-1">
          <div className="flex gap-2">
            {onFocus && (
              <button
                onClick={onFocus}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 text-primary rounded-xl text-sm font-semibold hover:bg-primary/20 transition-colors"
                title={t("graph.focusView")}
              >
                <Target className="w-4.5 h-4.5" />
                Focus
              </button>
            )}
            {onOpen && (
              <button
                onClick={() => onOpen(node)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-muted text-foreground rounded-xl text-sm font-semibold hover:bg-muted/80 transition-colors"
              >
                <ArrowSquareOut className="w-4.5 h-4.5 text-muted-foreground" />
                Open
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {onSave && EDITABLE_TYPES.has(node.type) && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-muted text-muted-foreground rounded-xl text-sm font-semibold hover:bg-muted/80 transition-colors"
              >
                <PencilSimple className="w-4.5 h-4.5" />
                Edit
              </button>
            )}
            {onDelete && EDITABLE_TYPES.has(node.type) && (
              <button
                onClick={() => onDelete(node.id)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-destructive/10 text-destructive rounded-xl text-sm font-semibold hover:bg-destructive/20 transition-colors"
              >
                <Trash className="w-4.5 h-4.5" />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
