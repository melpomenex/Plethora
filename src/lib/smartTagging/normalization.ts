/**
 * Canonicalization and duplicate prevention (TypeScript baseline)
 */

export function normalizeForComparison(tag: string): string {
  let cleaned = "";
  let prevSpace = false;

  for (const ch of tag) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      cleaned += ch.toLowerCase();
      prevSpace = false;
    } else if (/[_/\s-]/.test(ch) && !prevSpace) {
      if (cleaned.length > 0) {
        cleaned += " ";
        prevSpace = true;
      }
    }
  }

  return cleaned.trim();
}

export function toSingularStem(norm: string): string {
  let stem = norm;
  if (stem.endsWith("ies") && stem.length > 4) {
    stem = stem.slice(0, -3) + "y";
  } else if (stem.endsWith("es") && stem.length > 3) {
    if (stem.endsWith("sses") || stem.endsWith("shes") || stem.endsWith("ches") || stem.endsWith("xes")) {
      stem = stem.slice(0, -2);
    } else {
      stem = stem.slice(0, -1);
    }
  } else if (stem.endsWith("s") && !stem.endsWith("ss") && stem.length > 2) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

export function toDisplayCasing(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  const minorWords = new Set(["and", "or", "of", "in", "the", "a", "an", "for", "to", "on", "with"]);
  const upperAcronyms = new Set([
    "ai", "ml", "cpu", "gpu", "os", "db", "sql", "html", "css", "api", "tcp", "ip", "udp", "http", "llm", "rag", "ui", "ux", "toc"
  ]);

  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const word = parts[i];
    const lower = word.toLowerCase();
    if (upperAcronyms.has(lower)) {
      result.push(lower.toUpperCase());
    } else if (i > 0 && minorWords.has(lower)) {
      result.push(lower);
    } else {
      result.push(word.charAt(0).toUpperCase() + word.slice(1));
    }
  }

  return result.join(" ");
}

export function canonicalizeTag(candidate: string, existingTags: string[]): string {
  const candidateNorm = normalizeForComparison(candidate);
  const candidateStem = toSingularStem(candidateNorm);

  if (!candidateNorm) {
    return candidate.trim();
  }

  // 1. Exact or case-insensitive match
  for (const existing of existingTags) {
    if (existing.toLowerCase() === candidate.trim().toLowerCase()) {
      return existing;
    }
  }

  // 2. Normalized match
  for (const existing of existingTags) {
    const extNorm = normalizeForComparison(existing);
    if (extNorm === candidateNorm) {
      return existing;
    }
  }

  // 3. Singular / plural stem match
  for (const existing of existingTags) {
    const extNorm = normalizeForComparison(existing);
    const extStem = toSingularStem(extNorm);
    if (extStem === candidateStem) {
      return existing;
    }
  }

  // 4. Known synonyms
  const knownSynonyms: Array<[string[], string]> = [
    [["machine learning", "ml", "ai ml", "ai / ml"], "Machine Learning"],
    [["artificial intelligence", "ai"], "Artificial Intelligence"],
    [["operating systems", "operating system", "os"], "Operating Systems"],
    [["deep learning", "dl"], "Deep Learning"],
    [["natural language processing", "nlp"], "Natural Language Processing"],
    [["computer science", "cs"], "Computer Science"],
    [["large language model", "large language models", "llm", "llms"], "Large Language Models"],
  ];

  for (const [synonyms] of knownSynonyms) {
    const isCandidateInGroup = synonyms.some(
      (s) => normalizeForComparison(s) === candidateNorm || toSingularStem(normalizeForComparison(s)) === candidateStem
    );
    if (isCandidateInGroup) {
      for (const existing of existingTags) {
        const extNorm = normalizeForComparison(existing);
        const extStem = toSingularStem(extNorm);
        if (synonyms.some((s) => normalizeForComparison(s) === extNorm || toSingularStem(normalizeForComparison(s)) === extStem)) {
          return existing;
        }
      }
    }
  }

  return toDisplayCasing(candidate);
}
