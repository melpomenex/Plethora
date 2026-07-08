/**
 * Obsidian-inspired Knowledge Sphere
 * Beautiful 3D globe visualization of knowledge
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useI18n } from "../../lib/i18n";
import { GraphNodeType, type GraphNode, type GraphEdge } from "./KnowledgeGraph";
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Brain,
  Check,
  Folder,
  GridNine,
  Hand,
  Info,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  PencilSimple,
  Quotes,
  Sparkle,
  Tag,
  Target,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";

export interface ObsidianSphereProps {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onNodeContextMenu?: (node: GraphNode, position: { x: number; y: number }) => void;
  onNodeDelete?: (nodeId: string) => Promise<void> | void;
  onNodeSave?: (nodeId: string, updates: { label?: string; description?: string; category?: string; tags?: string[] }) => Promise<void> | void;
  showHeader?: boolean;
}

interface SphereNode extends GraphNode {
  theta: number;
  phi: number;
  radius: number;
  connections: number;
}

// Node configuration with enhanced visuals
const NODE_CONFIG = {
  [GraphNodeType.Document]: {
    color: "#3b82f6",
    size: 8,
    glow: 20,
    pulseSpeed: 0.8,
  },
  [GraphNodeType.Extract]: {
    color: "#22c55e",
    size: 5,
    glow: 12,
    pulseSpeed: 1.2,
  },
  [GraphNodeType.Flashcard]: {
    color: "#a855f7",
    size: 4,
    glow: 10,
    pulseSpeed: 1.5,
  },
  [GraphNodeType.Category]: {
    color: "#f59e0b",
    size: 7,
    glow: 16,
    pulseSpeed: 1.0,
  },
  [GraphNodeType.Tag]: {
    color: "#06b6d4",
    size: 4,
    glow: 8,
    pulseSpeed: 1.3,
  },
};

const NODE_DETAIL_STYLES = {
  [GraphNodeType.Document]: {
    icon: TextT,
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    textColor: "text-blue-400",
    labelKey: "graph.document",
  },
  [GraphNodeType.Extract]: {
    icon: Quotes,
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20",
    textColor: "text-green-400",
    labelKey: "graph.extract",
  },
  [GraphNodeType.Flashcard]: {
    icon: Brain,
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    textColor: "text-purple-400",
    labelKey: "graph.flashcard",
  },
  [GraphNodeType.Category]: {
    icon: Folder,
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    textColor: "text-amber-400",
    labelKey: "graph.categorySingular",
  },
  [GraphNodeType.Tag]: {
    icon: Tag,
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
    textColor: "text-cyan-400",
    labelKey: "graph.tag",
  },
  [GraphNodeType.Rss]: {
    icon: Sparkle,
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
    textColor: "text-orange-400",
    labelKey: "graph.rss",
  },
};

export function ObsidianSphere({
  nodes,
  edges = [],
  onNodeClick,
  onNodeHover,
  onNodeDoubleClick,
  onNodeContextMenu,
  onNodeDelete,
  onNodeSave,
  showHeader = true,
}: ObsidianSphereProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const { theme } = useTheme();
  const isDark = theme.variant === "dark";

  const rotationRef = useRef({ x: 0.3, y: 0 });
  const targetRotationRef = useRef({ x: 0.3, y: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(isDragging);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const selectedNodeRef = useRef(selectedNode);
  const [autoRotate, setAutoRotate] = useState(true);
  const autoRotateRef = useRef(autoRotate);
  const [showGrid, setShowGrid] = useState(true);
  const [showConstellations, setShowConstellations] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  // Inline edit state for selected node details
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      const node = nodes.find((n) => n.id === selectedNode);
      if (node) {
        setEditLabel(node.label || "");
        setEditCategory(node.category || "");
        setEditTags((node.tags || []).join(", "));
        setEditDescription(node.description || "");
      }
    } else {
      setEditLabel("");
      setEditCategory("");
      setEditTags("");
      setEditDescription("");
    }
    setIsEditing(false);
    setIsSaving(false);
    setSaveError(null);
  }, [selectedNode, nodes]);

  // Sync state values to refs to avoid closure stale state
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Calculate connection count for each node
  const nodeConnections = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((node) => counts.set(node.id, 0));
    edges.forEach((edge) => {
      counts.set(edge.source, (counts.get(edge.source) || 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) || 0) + 1);
    });
    return counts;
  }, [nodes, edges]);

  // Calculate connection counts by relationship type for the selected node
  const connectionCountsByType = useMemo(() => {
    if (!selectedNode || !edges) return {};
    const counts: Record<string, number> = {};
    edges.forEach((edge) => {
      if (edge.source === selectedNode || edge.target === selectedNode) {
        const type = edge.type || "related";
        counts[type] = (counts[type] || 0) + 1;
      }
    });
    return counts;
  }, [selectedNode, edges]);

  // Distribute nodes on sphere using Fibonacci sphere algorithm
  const sphereNodes = useMemo<SphereNode[]>(() => {
    const phi = Math.PI * (3 - Math.sqrt(5));
    const radius = 200;

    return nodes.map((node, i) => {
      const y = 1 - (i / (nodes.length - 1 || 1)) * 2;
      const theta = phi * i;

      return {
        ...node,
        theta,
        phi: Math.acos(y),
        radius,
        connections: nodeConnections.get(node.id) || 0,
      };
    });
  }, [nodes, nodeConnections]);

  const spriteCacheRef = useRef<Record<string, HTMLCanvasElement>>({});

  // Clear sprite cache when theme changes
  useEffect(() => {
    spriteCacheRef.current = {};
  }, [theme]);

  const getOrUpdateSprite = useCallback((
    type: GraphNodeType,
    state: "normal" | "hovered" | "selected" | "dimmed"
  ): HTMLCanvasElement => {
    const themeKey = theme.colors.background + "-" + theme.colors.onBackground;
    const key = `${type}-${state}-${themeKey}`;
    
    if (spriteCacheRef.current[key]) {
      return spriteCacheRef.current[key];
    }
    
    const config = NODE_CONFIG[type];
    const isSelected = state === "selected";
    const isHovered = state === "hovered";
    const isDimmed = state === "dimmed";
    
    const multiplier = isSelected ? 1.3 : isHovered ? 1.2 : 1.0;
    const size = config.size * multiplier;
    const glowSize = config.glow * (isSelected ? 1.5 : isHovered ? 1.3 : 1);
    
    const maxRadius = isDimmed ? size + 4 : Math.max(glowSize, size + 6);
    const canvasSize = Math.ceil(maxRadius * 2) + 8;
    
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    
    // 1. Glow effect
    if (!isDimmed) {
      const glowGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
      glowGradient.addColorStop(0, config.color + (isSelected ? "60" : "30"));
      glowGradient.addColorStop(0.5, config.color + (isSelected ? "20" : "10"));
      glowGradient.addColorStop(1, config.color + "00");
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, glowSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // 2. Node circle
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, size), 0, Math.PI * 2);
    ctx.fillStyle = config.color;
    ctx.fill();
    
    // 3. Inner highlight
    const highlightGradient = ctx.createRadialGradient(
      cx - size * 0.3,
      cy - size * 0.3,
      0,
      cx,
      cy,
      size
    );
    highlightGradient.addColorStop(0, "rgba(255,255,255,0.6)");
    highlightGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlightGradient;
    ctx.fill();
    
    // 4. White ring for selected/hovered nodes
    if (isSelected || isHovered) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    spriteCacheRef.current[key] = canvas;
    return canvas;
  }, [theme]);

  // 3D to 2D projection with perspective
  const project = useCallback(
    (node: SphereNode, currentRotation: { x: number; y: number }, currentZoom: number): { x: number; y: number; scale: number; z: number; visible: boolean } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, scale: 1, z: 0, visible: false };

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Convert spherical to Cartesian
      const x = node.radius * Math.sin(node.phi) * Math.cos(node.theta);
      const y = node.radius * Math.cos(node.phi);
      const z = node.radius * Math.sin(node.phi) * Math.sin(node.theta);

      // Apply rotations
      const cosX = Math.cos(currentRotation.x);
      const sinX = Math.sin(currentRotation.x);
      const cosY = Math.cos(currentRotation.y);
      const sinY = Math.sin(currentRotation.y);

      // Rotate around Y axis
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;

      // Rotate around X axis
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      // Perspective projection
      const fov = 600;
      const distance = fov + z2;
      const scale = (fov / distance) * currentZoom;

      return {
        x: centerX + x1 * scale,
        y: centerY + y2 * scale,
        scale,
        z: z2,
        visible: distance > 0,
      };
    },
    []
  );

  const isConnected = useCallback((nodeId1: string, nodeId2: string, edges: GraphEdge[]): boolean => {
    return edges.some(
      (e) =>
        (e.source === nodeId1 && e.target === nodeId2) ||
        (e.source === nodeId2 && e.target === nodeId1)
    );
  }, []);

  // Draw the sphere
  const draw = useCallback((currentRotation: { x: number; y: number }, currentZoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;

    // Clear with gradient background
    const bgGradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) / 2
    );
    bgGradient.addColorStop(0, isDark ? "#0a0f1a" : "#f8fafc");
    bgGradient.addColorStop(1, isDark ? "#050810" : "#e2e8f0");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    if (showGrid) {
      drawGlobeGrid(ctx, width, height, currentRotation, currentZoom, isDark);
    }

    // Sort nodes by Z depth for proper rendering
    const projectedNodes = sphereNodes.map((node) => ({
      node,
      projected: project(node, currentRotation, currentZoom),
    }));
    projectedNodes.sort((a, b) => a.projected.z - b.projected.z);

    // Draw constellation lines first (behind nodes)
    if (showConstellations) {
      edges.forEach((edge) => {
        const source = projectedNodes.find((p) => p.node.id === edge.source);
        const target = projectedNodes.find((p) => p.node.id === edge.target);

        if (!source || !target) return;
        if (!source.projected.visible || !target.projected.visible) return;

        const avgZ = (source.projected.z + target.projected.z) / 2;
        const depth = (avgZ + 200) / 400;
        const opacity = Math.max(0.05, depth * 0.4);

        const isHighlighted =
          selectedNode && (edge.source === selectedNode || edge.target === selectedNode);
        const isDimmed = selectedNode && !isHighlighted;

        ctx.beginPath();
        ctx.moveTo(source.projected.x, source.projected.y);
        ctx.lineTo(target.projected.x, target.projected.y);

        if (isHighlighted) {
          ctx.strokeStyle = "#3b82f6";
          ctx.lineWidth = 2 * Math.min(source.projected.scale, target.projected.scale);
          ctx.globalAlpha = 0.8;
        } else {
          ctx.strokeStyle = isDark ? "#4a5568" : "#94a3b8";
          ctx.lineWidth = 0.5 * Math.min(source.projected.scale, target.projected.scale);
          ctx.globalAlpha = isDimmed ? 0.05 : opacity;
        }

        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    // Draw nodes
    const time = Date.now() * 0.001;

    projectedNodes.forEach(({ node, projected }) => {
      if (!projected.visible) return;

      const config = NODE_CONFIG[node.type];
      const isHovered = hoveredNode === node.id;
      const isSelected = selectedNode === node.id;
      const isDimmed = selectedNode && !isSelected && !isConnected(node.id, selectedNode, edges);

      // Calculate depth-based opacity
      const depth = (projected.z + 200) / 400;
      const baseOpacity = Math.max(0.3, depth);
      const opacity = isDimmed ? 0.2 : baseOpacity;

      // Pulse effect (only for non-selected/non-hovered nodes)
      const pulse = isSelected
        ? 1.0
        : isHovered
          ? 1.0
          : 1 + Math.sin(time * config.pulseSpeed + node.theta) * 0.1;
      
      const drawScale = projected.scale * pulse;

      ctx.globalAlpha = opacity;

      let state: "normal" | "hovered" | "selected" | "dimmed" = "normal";
      if (isDimmed) state = "dimmed";
      else if (isSelected) state = "selected";
      else if (isHovered) state = "hovered";

      const sprite = getOrUpdateSprite(node.type, state);
      const drawSize = sprite.width * drawScale;

      ctx.drawImage(
        sprite,
        projected.x - drawSize / 2,
        projected.y - drawSize / 2,
        drawSize,
        drawSize
      );

      ctx.globalAlpha = 1;

      // Label for selected/hovered nodes or large scale
      if ((isSelected || isHovered || currentZoom > 1.2) && projected.scale > 0.5) {
        ctx.fillStyle = isDark ? "#ffffff" : "#1a202c";
        ctx.font = `${isSelected ? "bold " : ""}${Math.max(10, 12 * projected.scale)}px ${theme.typography.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        let label = node.label;
        if (label.length > 20) label = label.substring(0, 17) + "...";

        const labelOffset = config.size * drawScale;
        ctx.globalAlpha = opacity;
        ctx.fillText(label, projected.x, projected.y + labelOffset + 8);
        ctx.globalAlpha = 1;
      }
    });

    // Draw center glow
    const centerGradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      100 * currentZoom
    );
    centerGradient.addColorStop(0, isDark ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.05)");
    centerGradient.addColorStop(1, "rgba(59,130,246,0)");
    ctx.fillStyle = centerGradient;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 100 * currentZoom, 0, Math.PI * 2);
    ctx.fill();
  }, [
    sphereNodes,
    edges,
    project,
    showGrid,
    showConstellations,
    isDark,
    theme,
    hoveredNode,
    selectedNode,
    isConnected,
    getOrUpdateSprite,
  ]);

  const isAnimatingRef = useRef(false);
  const requestFrame = useCallback(() => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;
    
    let lastTime = performance.now();
    const animate = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;
      
      let changed = false;
      
      // 1. Handle auto rotation
      if (autoRotateRef.current && !isDraggingRef.current && !selectedNodeRef.current) {
        targetRotationRef.current.y += 0.0003 * delta;
        changed = true;
      }
      
      // 2. Lerp rotation to target
      const dx = targetRotationRef.current.x - rotationRef.current.x;
      const dy = targetRotationRef.current.y - rotationRef.current.y;
      
      if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
        rotationRef.current.x += dx * 0.1;
        rotationRef.current.y += dy * 0.1;
        changed = true;
      } else {
        rotationRef.current.x = targetRotationRef.current.x;
        rotationRef.current.y = targetRotationRef.current.y;
      }
      
      if (isDraggingRef.current) {
        changed = true;
      }
      
      if (changed) {
        draw(rotationRef.current, zoomRef.current);
      }
      
      const shouldKeepRunning = ((autoRotateRef.current && !selectedNodeRef.current) || isDraggingRef.current || Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001)
        // Stop the loop when the tab/page is hidden — background tabs stay
        // mounted, so without this auto-rotate would spin forever in an
        // inactive tab, burning CPU.
        && !document.hidden;

      if (shouldKeepRunning) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        isAnimatingRef.current = false;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [draw]);

  // Trigger animation loop on interactions or state changes
  useEffect(() => {
    requestFrame();
  }, [requestFrame, autoRotate, isDragging, selectedNode]);

  // Resume auto-rotate when the page becomes visible again (it pauses while
  // document.hidden via the shouldKeepRunning check above).
  useEffect(() => {
    if (!autoRotate) return;
    const onVis = () => { if (!document.hidden) requestFrame(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [autoRotate, requestFrame]);

  // Trigger single draw on any relevant state/theme changes
  useEffect(() => {
    draw(rotationRef.current, zoomRef.current);
  }, [draw, hoveredNode, selectedNode, showGrid, showConstellations, zoom, theme]);

  const focusOnNode = () => {
    if (selectedNode) {
      const node = sphereNodes.find((n) => n.id === selectedNode);
      if (node) {
        // Calculate rotation to face the node
        targetRotationRef.current = {
          x: -node.phi + Math.PI / 2,
          y: -node.theta,
        };
        requestFrame();
      }
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw(rotationRef.current, zoomRef.current);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  // Mouse handlers using refs for maximum performance
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setAutoRotate(false);
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDraggingRef.current) {
      const deltaX = (e.clientX - dragStartRef.current.x) * 0.005;
      const deltaY = (e.clientY - dragStartRef.current.y) * 0.005;

      targetRotationRef.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotationRef.current.x + deltaY));
      targetRotationRef.current.y += deltaX;

      dragStartRef.current = { x: e.clientX, y: e.clientY };
    } else {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let hovered: string | null = null;
      for (const node of sphereNodes) {
        const projected = project(node, rotationRef.current, zoomRef.current);
        if (!projected.visible) continue;

        const config = NODE_CONFIG[node.type];
        const dx = mouseX - projected.x;
        const dy = mouseY - projected.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= Math.max(8, config.size * projected.scale + 5)) {
          hovered = node.id;
          break;
        }
      }

      if (hovered !== hoveredNode) {
        setHoveredNode(hovered);
        onNodeHover?.(hovered ? sphereNodes.find((n) => n.id === hovered) || null : null);
      }
    }
  }, [sphereNodes, project, hoveredNode, onNodeHover]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * factor)));
  }, []);

  const handleClick = useCallback(() => {
    if (hoveredNode) {
      const node = sphereNodes.find((n) => n.id === hoveredNode);
      if (node) {
        setSelectedNode(selectedNode === node.id ? null : node.id);
        onNodeClick?.(node);
      }
    } else {
      setSelectedNode(null);
    }
  }, [hoveredNode, sphereNodes, selectedNode, onNodeClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (hoveredNode && onNodeContextMenu) {
      const node = sphereNodes.find((n) => n.id === hoveredNode);
      if (node) {
        onNodeContextMenu(node, { x: e.clientX, y: e.clientY });
      }
    }
  }, [hoveredNode, sphereNodes, onNodeContextMenu]);

  const resetView = useCallback(() => {
    targetRotationRef.current = { x: 0.3, y: 0 };
    setZoom(1);
    setSelectedNode(null);
    setAutoRotate(true);
  }, []);

  const handleSave = async () => {
    if (!selectedNode || !onNodeSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updates = {
        label: editLabel,
        category: editCategory || undefined,
        tags: editTags ? editTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        description: editDescription || undefined,
      };
      await onNodeSave(selectedNode, updates);
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save details");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedNode && onNodeDelete) {
      onNodeDelete(selectedNode);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Top bar */}
      <div className="absolute top-6 left-6 right-6 flex items-center justify-between pointer-events-none">
        {showHeader ? (
          <div className="pointer-events-auto">
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Sparkle className="w-5 h-5 text-primary" />
              {t("graph.knowledgeSphere")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("graph.nodesOrbiting", { count: nodes.length })}
            </p>
          </div>
        ) : (
          <div />
        )}

        <button
          onClick={() => setShowInfo(!showInfo)}
          className={`pointer-events-auto w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all ${showInfo ? "text-primary" : ""}`}
        >
          <Info className="w-5 h-5" />
        </button>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="absolute top-20 left-6 w-72 bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-5 pointer-events-auto">
          <h3 className="font-semibold mb-3">{t("graph.aboutKnowledgeSphere")}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t("graph.knowledgeSphereDescription")}
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
              <span className="text-sm">{t("graph.documents")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              <span className="text-sm">{t("graph.extracts")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
              <span className="text-sm">{t("graph.flashcards")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
              <span className="text-sm">{t("graph.categories")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
              <span className="text-sm">{t("graph.tags")}</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {t("graph.dragRotateScrollZoomClickSelect")}
            </p>
          </div>
        </div>
      )}

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-20 right-6 w-80 bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-5 pointer-events-auto flex flex-col gap-4 max-h-[calc(100vh-220px)] overflow-y-auto z-10 animate-glass-scale-in">
          {(() => {
            const node = sphereNodes.find((n) => n.id === selectedNode);
            if (!node) return null;
            const config = NODE_CONFIG[node.type];
            const detailConfig = NODE_DETAIL_STYLES[node.type] || {
              icon: Sparkle,
              bgColor: "bg-primary/10",
              borderColor: "border-primary/20",
              textColor: "text-primary",
              labelKey: "graph.node",
            };
            const IconComponent = detailConfig.icon;

            if (isEditing) {
              return (
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
                  {(node.type === GraphNodeType.Document || node.type === GraphNodeType.Extract || node.type === GraphNodeType.Flashcard) && (
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
              );
            }

            return (
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
                    onClick={() => setSelectedNode(null)}
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
                  {node.tags && node.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                      <Tag className="w-3.5 h-3.5" />
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Connection Stats */}
                <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connections Breakdown</span>
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
                    <button
                      onClick={focusOnNode}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 text-primary rounded-xl text-sm font-semibold hover:bg-primary/20 transition-colors"
                      title={t("graph.focusView")}
                    >
                      <Target className="w-4.5 h-4.5" />
                      Focus
                    </button>
                    {onNodeDoubleClick && (
                      <button
                        onClick={() => onNodeDoubleClick(node)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-muted text-foreground rounded-xl text-sm font-semibold hover:bg-muted/80 transition-colors"
                      >
                        <ArrowSquareOut className="w-4.5 h-4.5 text-muted-foreground" />
                        Open
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {onNodeSave && (node.type === GraphNodeType.Document || node.type === GraphNodeType.Extract || node.type === GraphNodeType.Flashcard) && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-muted text-muted-foreground rounded-xl text-sm font-semibold hover:bg-muted/80 transition-colors"
                      >
                        <PencilSimple className="w-4.5 h-4.5" />
                        Edit
                      </button>
                    )}
                    {onNodeDelete && (node.type === GraphNodeType.Document || node.type === GraphNodeType.Extract || node.type === GraphNodeType.Flashcard) && (
                      <button
                        onClick={handleDeleteClick}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-destructive/10 text-destructive rounded-xl text-sm font-semibold hover:bg-destructive/20 transition-colors"
                      >
                        <Trash className="w-4.5 h-4.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Floating controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-auto">
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all ${showGrid ? "text-primary" : ""}`}
          title={t("graph.toggleGrid")}
        >
          <GridNine className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowConstellations(!showConstellations)}
          className={`w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all ${showConstellations ? "text-primary" : ""}`}
          title={t("graph.toggleConnections")}
        >
          <Hand className="w-5 h-5" />
        </button>
        <div className="w-10 h-px bg-border my-1" />
        <button
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.zoomIn")}
        >
          <MagnifyingGlassPlus className="w-5 h-5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.zoomOut")}
        >
          <MagnifyingGlassMinus className="w-5 h-5" />
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.resetView")}
        >
          <ArrowCounterClockwise className="w-5 h-5" />
        </button>
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-6 left-6 bg-card/80 backdrop-blur border border-border rounded-xl shadow-lg px-4 py-2">
        <div className="text-xs text-muted-foreground">Zoom: {Math.round(zoom * 100)}%</div>
      </div>
    </div>
  );
}

// Draw globe wireframe grid
function drawGlobeGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rotation: { x: number; y: number },
  zoom: number,
  isDark: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 200 * zoom;

  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  ctx.lineWidth = 1;

  for (let i = 0; i < 12; i++) {
    const theta = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    for (let phi = 0; phi <= Math.PI; phi += 0.1) {
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);

      // Rotate
      const cosX = Math.cos(rotation.x);
      const sinX = Math.sin(rotation.x);
      const cosY = Math.cos(rotation.y);
      const sinY = Math.sin(rotation.y);

      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      const fov = 600;
      const scale = fov / (fov + z2);

      if (phi === 0) {
        ctx.moveTo(centerX + x1 * scale, centerY + y2 * scale);
      } else {
        ctx.lineTo(centerX + x1 * scale, centerY + y2 * scale);
      }
    }
    ctx.stroke();
  }

  for (let i = 1; i < 6; i++) {
    const phi = (i / 6) * Math.PI;
    const r = radius * Math.sin(phi);
    const y = radius * Math.cos(phi);

    ctx.beginPath();
    for (let theta = 0; theta <= Math.PI * 2; theta += 0.1) {
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);

      // Rotate
      const cosX = Math.cos(rotation.x);
      const sinX = Math.sin(rotation.x);
      const cosY = Math.cos(rotation.y);
      const sinY = Math.sin(rotation.y);

      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      const fov = 600;
      const scale = fov / (fov + z2);

      if (theta === 0) {
        ctx.moveTo(centerX + x1 * scale, centerY + y2 * scale);
      } else {
        ctx.lineTo(centerX + x1 * scale, centerY + y2 * scale);
      }
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.strokeStyle = isDark ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
}
