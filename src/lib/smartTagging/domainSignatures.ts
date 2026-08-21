/**
 * Composite multi-term domain signatures (TypeScript baseline)
 */

import type { ScoredTerm } from "./salience";

export interface DomainMatch {
  domainName: string;
  confidence: number;
  matchedTerms: string[];
  reason: string;
}

export interface DomainSignature {
  domainName: string;
  primaryTerms: string[];
  secondaryTerms: string[];
  ambiguousTerms: string[];
  minDistinctMatches: number;
  threshold: number;
}

export const DOMAIN_SIGNATURES: DomainSignature[] = [
  // 1. Mathematics
  {
    domainName: "Mathematics",
    primaryTerms: [
      "calculus", "differential equation", "linear algebra", "eigenvalue",
      "eigenvector", "theorem proof", "integral calculus", "vector space",
      "matrix multiplication", "topology", "algebraic geometry", "combinatorics",
      "prime number", "fourier transform", "laplace transform", "riemannian",
      "probability distribution", "differential geometry", "homotopy",
    ],
    secondaryTerms: [
      "axiom", "lemma", "corollary", "polynomial", "derivative", "integral",
      "eigenvalues", "determinant", "matrices", "isomorphism", "tensor",
      "quaternion", "stochastic", "euclidean", "non-euclidean", "manifold",
    ],
    ambiguousTerms: ["function", "table", "average", "mean", "model", "vector", "set", "graph", "variable"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 2. Biology
  {
    domainName: "Biology",
    primaryTerms: [
      "genome", "protein synthesis", "mitochondria", "cellular biology",
      "dna sequencing", "rna transcription", "ecosystem", "species evolution",
      "photosynthesis", "crispr", "chromosome", "molecular biology",
      "organism", "phylogenetic", "enzyme catalysis", "neurobiology",
    ],
    secondaryTerms: [
      "cells", "cellular", "proteins", "genes", "genetics", "evolutionary",
      "mutation", "bacteria", "membrane", "pathogen", "antibodies",
      "chloroplast", "ribosome", "metabolism", "homeostasis",
    ],
    ambiguousTerms: ["cell", "growth", "culture", "division", "host", "tissue"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 3. History
  {
    domainName: "History",
    primaryTerms: [
      "dynasty", "century bc", "historical treaty", "archaeological",
      "roman republic", "roman empire", "ancient civilization", "colonial era",
      "middle ages", "renaissance", "cold war", "world war", "french revolution",
      "industrial revolution", "ottoman empire", "byzantine", "antiquity",
    ],
    secondaryTerms: [
      "historian", "monarchy", "emperor", "archaeology", "reign", "centuries",
      "civilization", "treaty of", "conquest", "medieval", "imperialism",
      "feudalism", "sovereignty", "historiography", "expedition",
    ],
    ambiguousTerms: ["war", "century", "empire", "revolution", "conflict", "period", "era"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 4. Computer Science
  {
    domainName: "Computer Science",
    primaryTerms: [
      "operating systems", "operating system", "cpu scheduling", "distributed systems",
      "compiler design", "data structures", "machine learning",
      "neural networks", "garbage collection", "relational database",
      "concurrency control", "asymptotic complexity", "type system",
      "memory management", "virtual memory", "file system", "tcp/ip",
      "software architecture", "software engineering", "software development",
    ],
    secondaryTerms: [
      "algorithm", "compiler", "database", "programming", "software", "hardware",
      "kernel", "thread", "process", "mutex", "cache", "latency", "throughput",
      "bytecode", "runtime", "polymorphism", "recursion", "microservice",
      "drivers", "linux", "architecture",
    ],
    ambiguousTerms: ["program", "code", "system", "data", "compute", "interface"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 5. Economics
  {
    domainName: "Economics",
    primaryTerms: [
      "macroeconomics", "microeconomics", "monetary policy", "fiscal policy",
      "inflation rate", "gdp growth", "market equilibrium", "supply and demand",
      "central bank", "interest rate", "econometrics", "game theory",
      "marginal utility", "price elasticity", "opportunity cost",
    ],
    secondaryTerms: [
      "inflation", "monetary", "fiscal", "liquidity", "recession", "capitalism",
      "interest rates", "exchange rate", "deficit", "surplus", "tariff",
      "unemployment rate", "monopoly", "oligopoly", "aggregate demand",
    ],
    ambiguousTerms: ["price", "cost", "market", "value", "trade", "rate", "demand", "supply", "capital"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 6. Physics
  {
    domainName: "Physics",
    primaryTerms: [
      "quantum mechanics", "general relativity", "special relativity",
      "thermodynamics", "electromagnetism", "particle physics",
      "quantum field theory", "gravitational waves", "schrodinger equation",
      "maxwell equations", "superconductivity", "standard model", "quantum state",
    ],
    secondaryTerms: [
      "quantum", "relativity", "photon", "electron", "proton", "neutron",
      "electromagnetic", "gravitational", "thermodynamic", "entropy",
      "wavefunction", "spacetime", "angular momentum", "hamiltonian",
    ],
    ambiguousTerms: ["force", "energy", "matter", "wave", "field", "mass", "light", "speed", "power"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
  // 7. Philosophy
  {
    domainName: "Philosophy",
    primaryTerms: [
      "epistemology", "ontology", "metaphysics", "utilitarianism",
      "phenomenology", "existentialism", "moral philosophy", "stoicism",
      "deontology", "categorical imperative", "philosophy of mind",
      "logical positivism", "virtue ethics", "empiricism", "rationalism",
    ],
    secondaryTerms: [
      "philosophical", "philosopher", "ethics", "epistemic", "ontological",
      "metaphysical", "dialectic", "teleology", "determinism", "free will",
      "dualism", "consciousness", "skepticism", "normative",
    ],
    ambiguousTerms: ["reason", "mind", "truth", "thought", "logic", "value", "belief", "morality"],
    minDistinctMatches: 2,
    threshold: 0.70,
  },
];

export function matchDomainSignatures(
  title: string,
  headings: string[] = [],
  salientTerms: ScoredTerm[]
): DomainMatch[] {
  const lowerTitle = title.toLowerCase();
  const lowerHeadings = headings.map((h) => h.toLowerCase());

  const termMap = new Map<string, number>();
  for (const st of salientTerms) {
    termMap.set(st.term.toLowerCase(), st.score);
  }

  const matches: DomainMatch[] = [];

  for (const sig of DOMAIN_SIGNATURES) {
    const matchedPrimary: string[] = [];
    const matchedSecondary: string[] = [];
    let rawEvidenceScore = 0.0;

    const titleDirectHit = lowerTitle.includes(sig.domainName.toLowerCase());
    if (titleDirectHit) {
      rawEvidenceScore += 0.50;
    }

    for (const primary of sig.primaryTerms) {
      if (lowerTitle.includes(primary)) {
        matchedPrimary.push(primary);
        rawEvidenceScore += 0.45;
      } else if (lowerHeadings.some((h) => h.includes(primary))) {
        matchedPrimary.push(primary);
        rawEvidenceScore += 0.35;
      } else if (termMap.has(primary)) {
        matchedPrimary.push(primary);
        const score = termMap.get(primary) || 0;
        rawEvidenceScore += 0.25 * Math.min(1.5, score / 3.0);
      }
    }

    for (const sec of sig.secondaryTerms) {
      if (lowerTitle.includes(sec)) {
        matchedSecondary.push(sec);
        rawEvidenceScore += 0.30;
      } else if (lowerHeadings.some((h) => h.includes(sec))) {
        matchedSecondary.push(sec);
        rawEvidenceScore += 0.20;
      } else if (termMap.has(sec)) {
        matchedSecondary.push(sec);
        const score = termMap.get(sec) || 0;
        rawEvidenceScore += 0.15 * Math.min(1.2, score / 2.0);
      }
    }

    const allMatched = Array.from(new Set([...matchedPrimary, ...matchedSecondary]));
    const distinctMatches = allMatched.length;

    const isValid = titleDirectHit && distinctMatches >= 1
      ? true
      : distinctMatches >= sig.minDistinctMatches && rawEvidenceScore >= sig.threshold;

    if (isValid) {
      const confidence = Math.min(0.98, Math.max(0.72, rawEvidenceScore / 1.5));
      const reason = `High co-occurrence evidence in ${sig.domainName} domain: matched ${allMatched.join(", ")}`;

      matches.push({
        domainName: sig.domainName,
        confidence,
        matchedTerms: allMatched,
        reason,
      });
    }
  }

  return matches;
}
