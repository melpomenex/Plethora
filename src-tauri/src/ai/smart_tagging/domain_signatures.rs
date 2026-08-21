//! Multi-term composite domain signatures and evidence scoring
//!
//! Provides co-occurrence evidence verification for broad domains to eliminate
//! single-word false positive triggers (e.g., "software" -> "history",
//! "cellphone" -> "biology", single "function" / "average" -> "math").

use std::collections::{HashMap, HashSet};
use super::salience::ScoredTerm;

#[derive(Debug, Clone)]
pub struct DomainMatch {
    pub domain_name: &'static str,
    pub confidence: f64,
    pub matched_terms: Vec<String>,
    pub reason: String,
}

pub struct DomainSignature {
    pub domain_name: &'static str,
    /// High-weight unambiguous signature terms (each contributes strongly)
    pub primary_terms: &'static [&'static str],
    /// Secondary context terms (provide co-occurrence support)
    pub secondary_terms: &'static [&'static str],
    /// Polysemous / ambiguous terms that MUST NOT trigger the domain on their own
    pub ambiguous_terms: &'static [&'static str],
    /// Minimum distinct term matches required (unless title directly matches)
    pub min_distinct_matches: usize,
    /// Minimum evidence score threshold (0.0 - 1.0)
    pub threshold: f64,
}

static DOMAIN_SIGNATURES: &[DomainSignature] = &[
    // 1. Mathematics
    DomainSignature {
        domain_name: "Mathematics",
        primary_terms: &[
            "calculus", "differential equation", "linear algebra", "eigenvalue",
            "eigenvector", "theorem proof", "integral calculus", "vector space",
            "matrix multiplication", "topology", "algebraic geometry", "combinatorics",
            "prime number", "fourier transform", "laplace transform", "riemannian",
            "probability distribution", "differential geometry", "homotopy",
        ],
        secondary_terms: &[
            "axiom", "lemma", "corollary", "polynomial", "derivative", "integral",
            "eigenvalues", "determinant", "matrices", "isomorphism", "tensor",
            "quaternion", "stochastic", "euclidean", "non-euclidean", "manifold",
        ],
        ambiguous_terms: &["function", "table", "average", "mean", "model", "vector", "set", "graph", "variable"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 2. Biology
    DomainSignature {
        domain_name: "Biology",
        primary_terms: &[
            "genome", "protein synthesis", "mitochondria", "cellular biology",
            "dna sequencing", "rna transcription", "ecosystem", "species evolution",
            "photosynthesis", "crispr", "chromosome", "molecular biology",
            "organism", "phylogenetic", "enzyme catalysis", "neurobiology",
        ],
        secondary_terms: &[
            "cells", "cellular", "proteins", "genes", "genetics", "evolutionary",
            "mutation", "bacteria", "membrane", "pathogen", "antibodies",
            "chloroplast", "ribosome", "metabolism", "homeostasis",
        ],
        ambiguous_terms: &["cell", "growth", "culture", "division", "host", "tissue"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 3. History
    DomainSignature {
        domain_name: "History",
        primary_terms: &[
            "dynasty", "century bc", "historical treaty", "archaeological",
            "roman republic", "roman empire", "ancient civilization", "colonial era",
            "middle ages", "renaissance", "cold war", "world war", "french revolution",
            "industrial revolution", "ottoman empire", "byzantine", "antiquity",
        ],
        secondary_terms: &[
            "historian", "monarchy", "emperor", "archaeology", "reign", "centuries",
            "civilization", "treaty of", "conquest", "medieval", "imperialism",
            "feudalism", "sovereignty", "historiography", "expedition",
        ],
        ambiguous_terms: &["war", "century", "empire", "revolution", "conflict", "period", "era"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 4. Computer Science
    DomainSignature {
        domain_name: "Computer Science",
        primary_terms: &[
            "operating systems", "cpu scheduling", "distributed systems",
            "compiler design", "data structures", "machine learning",
            "neural networks", "garbage collection", "relational database",
            "concurrency control", "asymptotic complexity", "type system",
            "memory management", "virtual memory", "file system", "tcp/ip",
        ],
        secondary_terms: &[
            "algorithm", "compiler", "database", "programming", "software engineering",
            "kernel", "thread", "process", "mutex", "cache", "latency", "throughput",
            "bytecode", "runtime", "polymorphism", "recursion", "microservice",
        ],
        ambiguous_terms: &["program", "code", "system", "data", "compute", "interface"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 5. Economics
    DomainSignature {
        domain_name: "Economics",
        primary_terms: &[
            "macroeconomics", "microeconomics", "monetary policy", "fiscal policy",
            "inflation rate", "gdp growth", "market equilibrium", "supply and demand",
            "central bank", "interest rate", "econometrics", "game theory",
            "marginal utility", "price elasticity", "opportunity cost",
        ],
        secondary_terms: &[
            "inflation", "monetary", "fiscal", "liquidity", "recession", "capitalism",
            "interest rates", "exchange rate", "deficit", "surplus", "tariff",
            "unemployment rate", "monopoly", "oligopoly", "aggregate demand",
        ],
        ambiguous_terms: &["price", "cost", "market", "value", "trade", "rate", "demand", "supply", "capital"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 6. Physics
    DomainSignature {
        domain_name: "Physics",
        primary_terms: &[
            "quantum mechanics", "general relativity", "special relativity",
            "thermodynamics", "electromagnetism", "particle physics",
            "quantum field theory", "gravitational waves", "schrodinger equation",
            "maxwell equations", "superconductivity", "standard model", "quantum state",
        ],
        secondary_terms: &[
            "quantum", "relativity", "photon", "electron", "proton", "neutron",
            "electromagnetic", "gravitational", "thermodynamic", "entropy",
            "wavefunction", "spacetime", "angular momentum", "hamiltonian",
        ],
        ambiguous_terms: &["force", "energy", "matter", "wave", "field", "mass", "light", "speed", "power"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
    // 7. Philosophy
    DomainSignature {
        domain_name: "Philosophy",
        primary_terms: &[
            "epistemology", "ontology", "metaphysics", "utilitarianism",
            "phenomenology", "existentialism", "moral philosophy", "stoicism",
            "deontology", "categorical imperative", "philosophy of mind",
            "logical positivism", "virtue ethics", "empiricism", "rationalism",
        ],
        secondary_terms: &[
            "philosophical", "philosopher", "ethics", "epistemic", "ontological",
            "metaphysical", "dialectic", "teleology", "determinism", "free will",
            "dualism", "consciousness", "skepticism", "normative",
        ],
        ambiguous_terms: &["reason", "mind", "truth", "thought", "logic", "value", "belief", "morality"],
        min_distinct_matches: 2,
        threshold: 0.70,
    },
];

/// Evaluate extracted terms against multi-term domain signatures.
///
/// Returns high-confidence domain matches that satisfy evidence thresholds.
pub fn match_domain_signatures(
    title: &str,
    headings: &[&str],
    salient_terms: &[ScoredTerm],
) -> Vec<DomainMatch> {
    let lower_title = title.to_lowercase();
    let lower_headings: Vec<String> = headings.iter().map(|h| h.to_lowercase()).collect();

    let mut term_map: HashMap<String, f64> = HashMap::new();
    for st in salient_terms {
        term_map.insert(st.term.to_lowercase(), st.score);
    }

    let mut matches = Vec::new();

    for sig in DOMAIN_SIGNATURES {
        let mut matched_primary = Vec::new();
        let mut matched_secondary = Vec::new();
        let mut raw_evidence_score = 0.0;

        // Check title direct hit
        let title_direct_hit = lower_title.contains(&sig.domain_name.to_lowercase());
        if title_direct_hit {
            raw_evidence_score += 0.50;
        }

        // Check primary terms
        for &primary in sig.primary_terms {
            if lower_title.contains(primary) {
                matched_primary.push(primary.to_string());
                raw_evidence_score += 0.45;
            } else if lower_headings.iter().any(|h| h.contains(primary)) {
                matched_primary.push(primary.to_string());
                raw_evidence_score += 0.35;
            } else if let Some(&score) = term_map.get(primary) {
                matched_primary.push(primary.to_string());
                raw_evidence_score += 0.25 * (score / 3.0).min(1.5);
            }
        }

        // Check secondary terms
        for &sec in sig.secondary_terms {
            if lower_title.contains(sec) {
                matched_secondary.push(sec.to_string());
                raw_evidence_score += 0.30;
            } else if lower_headings.iter().any(|h| h.contains(sec)) {
                matched_secondary.push(sec.to_string());
                raw_evidence_score += 0.20;
            } else if let Some(&score) = term_map.get(sec) {
                matched_secondary.push(sec.to_string());
                raw_evidence_score += 0.15 * (score / 2.0).min(1.2);
            }
        }

        // Deduplicate matched terms
        let mut all_matched = matched_primary.clone();
        for sec in &matched_secondary {
            if !all_matched.contains(sec) {
                all_matched.push(sec.clone());
            }
        }

        let distinct_matches = all_matched.len();

        // Check if evidence threshold is met:
        // Either:
        // 1. Title direct match + at least 1 primary/secondary match
        // 2. Or distinct_matches >= min_distinct_matches AND raw_evidence_score >= threshold
        let is_valid = if title_direct_hit && distinct_matches >= 1 {
            true
        } else {
            distinct_matches >= sig.min_distinct_matches && raw_evidence_score >= sig.threshold
        };

        if is_valid {
            let confidence = (raw_evidence_score / 1.5).clamp(0.72, 0.98);
            let reason = format!(
                "High co-occurrence evidence in {} domain: matched {}",
                sig.domain_name,
                all_matched.join(", ")
            );

            matches.push(DomainMatch {
                domain_name: sig.domain_name,
                confidence,
                matched_terms: all_matched,
                reason,
            });
        }
    }

    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_math_requires_multi_term_evidence() {
        // Only "average" or "function" should NOT trigger Math
        let terms = vec![
            ScoredTerm { term: "average".to_string(), score: 5.0, frequency: 4, is_phrase: false },
            ScoredTerm { term: "table".to_string(), score: 3.0, frequency: 2, is_phrase: false },
        ];
        let matches = match_domain_signatures("Performance metrics and user tables", &[], &terms);
        assert!(!matches.iter().any(|m| m.domain_name == "Mathematics"));
    }

    #[test]
    fn test_math_triggers_on_calculus_and_differential_equations() {
        let terms = vec![
            ScoredTerm { term: "calculus".to_string(), score: 4.0, frequency: 3, is_phrase: false },
            ScoredTerm { term: "differential equation".to_string(), score: 5.0, frequency: 2, is_phrase: true },
        ];
        let matches = match_domain_signatures("Introduction to Differential Equations", &[], &terms);
        assert!(matches.iter().any(|m| m.domain_name == "Mathematics"));
    }

    #[test]
    fn test_software_does_not_trigger_history() {
        let terms = vec![
            ScoredTerm { term: "software".to_string(), score: 5.0, frequency: 5, is_phrase: false },
            ScoredTerm { term: "hardware".to_string(), score: 4.0, frequency: 3, is_phrase: false },
        ];
        let matches = match_domain_signatures("Software Architecture and Hardware Interfacing", &[], &terms);
        assert!(!matches.iter().any(|m| m.domain_name == "History"));
    }
}
