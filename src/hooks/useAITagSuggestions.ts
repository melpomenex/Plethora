/**
 * AI Tag Suggestions Hook
 * Suggests tags for documents based on content analysis
 */

import { useState, useCallback } from "react";
import { suggestTags } from "../lib/ai/extractAI";

export interface TagSuggestion {
  tag: string;
  confidence: "high" | "medium" | "low";
  category: "topic" | "type" | "difficulty" | "custom";
}

interface UseAITagSuggestionsReturn {
  suggestions: TagSuggestion[];
  isLoading: boolean;
  error: string | null;
  suggestTags: (content: string, title?: string) => Promise<TagSuggestion[]>;
  clearSuggestions: () => void;
}

export function useAITagSuggestions(): UseAITagSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestTagsForContent = useCallback(
    async (content: string, title?: string): Promise<TagSuggestion[]> => {
      setIsLoading(true);
      setError(null);

      try {
        const contentPreview = content.slice(0, 2000);
        const tags = await suggestTags(
          title ? `${title}\n\n${contentPreview}` : contentPreview
        );

        const validSuggestions: TagSuggestion[] = tags.map((tag, index) => ({
          tag,
          confidence: index < 2 ? "high" : "medium",
          category: "custom",
        }));

        setSuggestions(validSuggestions);
        return validSuggestions;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to suggest tags";
        setError(errorMessage);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setError(null);
  }, []);

  return {
    suggestions,
    isLoading,
    error,
    suggestTags: suggestTagsForContent,
    clearSuggestions,
  };
}

/**
 * Generate basic tags from content without AI
 * Fallback when AI is not available
 */
export function generateBasicTags(content: string, title?: string): TagSuggestion[] {
  const suggestions: TagSuggestion[] = [];
  const lowerContent = content.toLowerCase();
  const lowerTitle = title?.toLowerCase() || "";

  const topicKeywords: Record<string, string[]> = {
    "programming": ["code", "function", "variable", "algorithm", "programming", "developer", "software"],
    "science": ["experiment", "hypothesis", "research", "study", "scientific", "data"],
    "mathematics": ["equation", "formula", "calculation", "theorem", "proof", "mathematical"],
    "technology": ["technology", "digital", "software", "hardware", "computer", "tech"],
    "business": ["business", "market", "strategy", "company", "enterprise", "startup"],
    "health": ["health", "medical", "wellness", "fitness", "diet", "exercise"],
    "psychology": ["psychology", "behavior", "cognitive", "mental", "emotion", "mind"],
    "history": ["history", "historical", "century", "ancient", "medieval", "era"],
    "philosophy": ["philosophy", "ethics", "logic", "existence", "reasoning", "thought"],
    "language": ["language", "linguistic", "grammar", "vocabulary", "translation", "speaking"],
  };

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    const matchCount = keywords.filter(
      (kw) => lowerContent.includes(kw) || lowerTitle.includes(kw)
    ).length;

    if (matchCount >= 2) {
      suggestions.push({
        tag: topic,
        confidence: matchCount >= 4 ? "high" : "medium",
        category: "topic",
      });
    }
  }

  if (lowerContent.includes("step 1") || lowerContent.includes("how to") || lowerContent.includes("tutorial")) {
    suggestions.push({ tag: "tutorial", confidence: "high", category: "type" });
  }
  if (lowerContent.includes("abstract") || lowerContent.includes("methodology") || lowerContent.includes("conclusion")) {
    suggestions.push({ tag: "research", confidence: "medium", category: "type" });
  }
  if (lowerContent.includes("definition") || lowerContent.includes("refers to") || lowerContent.includes("glossary")) {
    suggestions.push({ tag: "reference", confidence: "medium", category: "type" });
  }

  if (lowerContent.includes("introduction") || lowerContent.includes("basics") || lowerContent.includes("beginner")) {
    suggestions.push({ tag: "beginner", confidence: "medium", category: "difficulty" });
  }
  if (lowerContent.includes("advanced") || lowerContent.includes("expert") || lowerContent.includes("deep dive")) {
    suggestions.push({ tag: "advanced", confidence: "medium", category: "difficulty" });
  }

  return suggestions.slice(0, 5);
}

export default useAITagSuggestions;
