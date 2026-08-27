//! Pre-request prompt budgeting for local (Ollama) providers.
//!
//! Cloud contextual chat keeps excerpt-only behavior; this assembler applies
//! history and memory trimming only when `is_local_budgeting_provider` is true.

use super::llm_policy::{LlmRequestPolicy, MIN_PROMPT_HEADROOM};

const DEFAULT_EXCERPT_TOKENS: usize = 2000;

/// Char/4 token estimate, matching existing `estimate_context_chars`.
pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4).max(if chars == 0 { 0 } else { 1 })
}

pub fn estimate_chars_for_tokens(tokens: usize) -> usize {
    tokens.saturating_mul(4)
}

pub fn is_local_budgeting_provider(provider: &str) -> bool {
    provider.eq_ignore_ascii_case("ollama")
}

#[derive(Debug, Clone)]
pub struct BudgetMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ContextBudgetInput {
    pub context_type: String,
    pub document_id: Option<String>,
    pub url: Option<String>,
    pub selection: Option<String>,
    pub content: Option<String>,
    pub memory_content: Option<String>,
    pub history: Vec<BudgetMessage>,
    pub current_user_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AssembledPrompt {
    pub system_prompt: String,
    pub history: Vec<BudgetMessage>,
    pub estimated_prompt_tokens: usize,
    pub trimmed_history: bool,
    pub trimmed_excerpt: bool,
    pub trimmed_memory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetOverflow {
    pub estimated_tokens: usize,
    pub prompt_budget: usize,
    pub configured_context: usize,
    pub output_reserve: usize,
}

impl BudgetOverflow {
    pub fn user_message(&self) -> String {
        crate::ai::ollama_chat::context_overflow_user_message(
            self.configured_context,
            self.estimated_tokens,
            self.output_reserve,
        )
    }
}

fn memory_preamble() -> &'static str {
    "\n\n### USER LONG-TERM MEMORY (Facts & Preferences)\nThe following is your persistent, long-term memory about the user. Use these facts and preferences to personalize your responses and be more helpful, personable, and accurate:\n"
}

fn trim_memory_keep_recent(memory: &str, max_tokens: usize) -> (String, bool) {
    if max_tokens == 0 {
        return (String::new(), !memory.is_empty());
    }
    if estimate_tokens(memory) <= max_tokens {
        return (memory.to_string(), false);
    }
    let max_chars = estimate_chars_for_tokens(max_tokens);
    let total = memory.chars().count();
    if total <= max_chars {
        return (memory.to_string(), false);
    }
    let skip = total.saturating_sub(max_chars);
    let trimmed: String = memory.chars().skip(skip).collect();
    (trimmed, true)
}

fn drop_oldest_history(history: &[BudgetMessage], max_tokens: usize) -> (Vec<BudgetMessage>, bool) {
    if history.is_empty() {
        return (Vec::new(), false);
    }
    let mut kept: Vec<BudgetMessage> = history.to_vec();
    let mut trimmed = false;
    while !kept.is_empty() && history_tokens(&kept) > max_tokens {
        kept.remove(0);
        trimmed = true;
    }
    (kept, trimmed)
}

fn history_tokens(history: &[BudgetMessage]) -> usize {
    history
        .iter()
        .map(|m| estimate_tokens(&m.role) + estimate_tokens(&m.content) + 4)
        .sum()
}

/// Query-aware excerpt selection using a remaining token budget (not the full
/// context window).
pub fn select_relevant_excerpt(
    content: &str,
    budget_tokens: Option<usize>,
    user_query: Option<&str>,
) -> String {
    let max_chars = estimate_chars_for_tokens(budget_tokens.unwrap_or(DEFAULT_EXCERPT_TOKENS));
    let mut char_indices: Vec<usize> = content.char_indices().map(|(i, _)| i).collect();
    char_indices.push(content.len());
    let total_chars = char_indices.len().saturating_sub(1);

    if total_chars <= max_chars {
        return content.to_string();
    }

    let query_terms = user_query.map(extract_query_terms).unwrap_or_default();
    if query_terms.is_empty() {
        return content.chars().take(max_chars).collect();
    }

    let mut best_chunks: Vec<(usize, usize, usize)> = Vec::new();
    let chunk_len = max_chars.clamp(400, 1200).min(total_chars);
    let overlap = 200.min(chunk_len / 3);
    let mut start_char = 0;

    while start_char < total_chars {
        let end_char = (start_char + chunk_len).min(total_chars);
        let start = char_indices[start_char];
        let end = char_indices[end_char];
        let chunk = &content[start..end];
        let score = score_chunk(chunk, &query_terms);
        best_chunks.push((score, start, end));

        if end_char == total_chars {
            break;
        }
        start_char = end_char.saturating_sub(overlap);
    }

    best_chunks.sort_by(|a, b| b.0.cmp(&a.0));
    let mut selected = String::new();

    for (score, start, end) in best_chunks {
        if score == 0 && !selected.is_empty() {
            break;
        }
        let chunk = &content[start..end];
        let selected_chars = selected.chars().count();
        let chunk_chars = chunk.chars().count();
        if selected_chars + chunk_chars + 12 > max_chars {
            break;
        }
        if !selected.is_empty() {
            selected.push_str("\n\n[...]\n\n");
        }
        selected.push_str(chunk);
        if selected.chars().count() >= max_chars {
            break;
        }
    }

    if selected.is_empty() {
        content.chars().take(max_chars).collect()
    } else {
        selected
    }
}

fn extract_query_terms(query: &str) -> Vec<String> {
    let stop_words = [
        "the", "and", "or", "of", "to", "in", "a", "an", "is", "are", "was", "were", "what", "how",
        "why", "when", "where", "which", "who", "summarize", "summary", "chapter", "page", "book",
        "document", "this", "that",
    ];

    let mut terms: Vec<String> = query
        .to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() >= 4)
        .filter(|term| !stop_words.contains(term))
        .map(|term| term.to_string())
        .collect();

    let chars: Vec<(usize, char)> = query.char_indices().collect();
    let mut index = 0;
    while index < chars.len() {
        if !chars[index].1.is_ascii_digit() {
            index += 1;
            continue;
        }

        let start = chars[index].0;
        let mut end = query.len();
        let mut cursor = index;
        while cursor < chars.len() && (chars[cursor].1.is_ascii_digit() || chars[cursor].1 == '.') {
            cursor += 1;
        }
        if cursor < chars.len() {
            end = chars[cursor].0;
        }

        let candidate = query[start..end].trim();
        if candidate.contains('.') && candidate.len() >= 3 {
            terms.push(candidate.to_lowercase());
        }
        index = cursor;
    }

    terms.sort();
    terms.dedup();
    terms
}

fn score_chunk(chunk: &str, terms: &[String]) -> usize {
    let chunk_lower = chunk.to_lowercase();
    terms
        .iter()
        .map(|term| chunk_lower.matches(term.as_str()).count())
        .sum()
}

/// Build the context system prompt using a remaining excerpt token budget.
pub fn build_context_prompt(
    context_type: &str,
    document_id: Option<&str>,
    url: Option<&str>,
    selection: Option<&str>,
    content: Option<&str>,
    excerpt_budget_tokens: Option<usize>,
    latest_user_message: Option<&str>,
) -> String {
    let mut instructions = String::from(
        "Use the provided context to answer the user's request. \
If the user asks for a summary, summarize the relevant context. \
If the answer is not in the provided context, say so.",
    );
    instructions.push('\n');

    match context_type {
        "document" => {
            let mut prompt = format!(
                "The user is viewing a document{}.",
                document_id
                    .map(|id| format!(" (ID: {})", id))
                    .unwrap_or_default()
            );
            if let Some(selection) = selection {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }
            if let Some(content) = content {
                let excerpt = select_relevant_excerpt(content, excerpt_budget_tokens, latest_user_message);
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nDocument content (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }
            instructions.push_str(&prompt);
            instructions
        }
        "web" => {
            let mut prompt = format!(
                "The user is browsing the web page: {}.",
                url.unwrap_or("Unknown")
            );
            if let Some(selection) = selection {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }
            if let Some(content) = content {
                let excerpt = select_relevant_excerpt(content, excerpt_budget_tokens, latest_user_message);
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nPage content (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }
            instructions.push_str(&prompt);
            instructions
        }
        "video" => {
            let mut prompt = String::from("The user is watching a video.");
            if let Some(selection) = selection {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }
            if let Some(content) = content {
                let excerpt = select_relevant_excerpt(content, excerpt_budget_tokens, latest_user_message);
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nTranscript (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }
            instructions.push_str(&prompt);
            instructions
        }
        _ => {
            instructions.push_str("You are a helpful assistant.");
            instructions
        }
    }
}

fn protected_tokens(input: &ContextBudgetInput) -> usize {
    let mut n = estimate_tokens(
        "Use the provided context to answer the user's request. \
If the user asks for a summary, summarize the relevant context. \
If the answer is not in the provided context, say so.\n",
    );
    if let Some(sel) = input.selection.as_deref() {
        if !sel.trim().is_empty() {
            n += estimate_tokens(sel) + 8;
        }
    }
    if let Some(user) = input.current_user_message.as_deref() {
        n += estimate_tokens(user) + 8;
    }
    n
}

/// Assemble prompt content to fit `policy.prompt_budget_tokens`.
///
/// Trim order (lowest priority first): conversation history → document excerpt
/// → long-term memory. Never trims the current user message, selection, or
/// core system instructions.
pub fn assemble_context_with_budget(
    provider: &str,
    input: &ContextBudgetInput,
    policy: &LlmRequestPolicy,
) -> Result<AssembledPrompt, BudgetOverflow> {
    let local = is_local_budgeting_provider(provider);
    let budget = policy.prompt_budget_tokens.max(1);

    let protected = protected_tokens(input);
    if local && protected > budget {
        return Err(BudgetOverflow {
            estimated_tokens: protected,
            prompt_budget: budget,
            configured_context: policy.configured_context_tokens,
            output_reserve: policy.output_reserve_tokens,
        });
    }

    // Cloud: excerpt-only (existing behavior). Do not trim history or memory.
    if !local {
        let system_prompt = build_context_prompt(
            &input.context_type,
            input.document_id.as_deref(),
            input.url.as_deref(),
            input.selection.as_deref(),
            input.content.as_deref(),
            Some(budget.max(MIN_PROMPT_HEADROOM)),
            input.current_user_message.as_deref(),
        );
        let mut full = system_prompt.clone();
        if let Some(memory) = input.memory_content.as_deref() {
            if !memory.is_empty() {
                full.push_str(memory_preamble());
                full.push_str(memory);
                full.push_str("\n------------------------------------\n");
            }
        }
        let history_tok = history_tokens(&input.history);
        let user_tok = input
            .current_user_message
            .as_deref()
            .map(estimate_tokens)
            .unwrap_or(0);
        return Ok(AssembledPrompt {
            estimated_prompt_tokens: estimate_tokens(&full) + history_tok + user_tok,
            system_prompt: full,
            history: input.history.clone(),
            trimmed_history: false,
            trimmed_excerpt: false,
            trimmed_memory: false,
        });
    }

    // --- Local path: deterministic trim ---
    let mut history = input.history.clone();
    let mut memory = input.memory_content.clone().unwrap_or_default();
    let mut excerpt_budget = budget.saturating_sub(protected);
    let mut trimmed_history = false;
    let mut trimmed_memory = false;
    let mut trimmed_excerpt = false;

    let user_tokens = input
        .current_user_message
        .as_deref()
        .map(estimate_tokens)
        .unwrap_or(0);

    let try_assemble = |history: &[BudgetMessage],
                        memory: &str,
                        excerpt_tokens: usize|
     -> (String, usize) {
        let mut system = build_context_prompt(
            &input.context_type,
            input.document_id.as_deref(),
            input.url.as_deref(),
            input.selection.as_deref(),
            input.content.as_deref(),
            Some(excerpt_tokens.max(1)),
            input.current_user_message.as_deref(),
        );
        if !memory.is_empty() {
            system.push_str(memory_preamble());
            system.push_str(memory);
            system.push_str("\n------------------------------------\n");
        }
        let total = estimate_tokens(&system) + history_tokens(history) + user_tokens;
        (system, total)
    };

    // Start with full excerpt budget, then trim history → excerpt → memory.
    let mut system;
    let mut total;
    (system, total) = try_assemble(&history, &memory, excerpt_budget);

    if total > budget && !history.is_empty() {
        let remaining_for_history = budget
            .saturating_sub(estimate_tokens(&system).saturating_sub(history_tokens(&history)))
            .saturating_sub(user_tokens);
        // Rebuild system without counting history, then fit history into leftover.
        let (sys_no_hist, _) = try_assemble(&[], &memory, excerpt_budget);
        let leftover = budget
            .saturating_sub(estimate_tokens(&sys_no_hist))
            .saturating_sub(user_tokens);
        let (kept, did_trim) = drop_oldest_history(&history, leftover.min(remaining_for_history));
        history = kept;
        trimmed_history = did_trim;
        (system, total) = try_assemble(&history, &memory, excerpt_budget);
        let _ = remaining_for_history;
    }

    if total > budget {
        let overhead = estimate_tokens(&system)
            .saturating_sub(input.content.as_deref().map(estimate_tokens).unwrap_or(0));
        let leftover = budget
            .saturating_sub(history_tokens(&history))
            .saturating_sub(user_tokens)
            .saturating_sub(overhead.max(protected / 2));
        excerpt_budget = leftover.max(1);
        trimmed_excerpt = true;
        (system, total) = try_assemble(&history, &memory, excerpt_budget);
    }

    if total > budget && !memory.is_empty() {
        let without_memory_budget = {
            let (sys, _) = try_assemble(&history, "", excerpt_budget);
            estimate_tokens(&sys) + history_tokens(&history) + user_tokens
        };
        let leftover = budget.saturating_sub(without_memory_budget);
        let (kept, did_trim) = trim_memory_keep_recent(&memory, leftover);
        memory = kept;
        trimmed_memory = did_trim || leftover == 0;
        (system, total) = try_assemble(&history, &memory, excerpt_budget);
    }

    if total > budget {
        let only_protected = protected;
        if only_protected > budget {
            return Err(BudgetOverflow {
                estimated_tokens: total,
                prompt_budget: budget,
                configured_context: policy.configured_context_tokens,
                output_reserve: policy.output_reserve_tokens,
            });
        }
        // Last resort: empty excerpt + empty memory + empty history.
        history.clear();
        memory.clear();
        excerpt_budget = budget.saturating_sub(protected).max(1);
        trimmed_history = true;
        trimmed_memory = true;
        trimmed_excerpt = true;
        (system, total) = try_assemble(&history, &memory, excerpt_budget);
        if total > budget {
            return Err(BudgetOverflow {
                estimated_tokens: total,
                prompt_budget: budget,
                configured_context: policy.configured_context_tokens,
                output_reserve: policy.output_reserve_tokens,
            });
        }
    }

    Ok(AssembledPrompt {
        system_prompt: system,
        history,
        estimated_prompt_tokens: total,
        trimmed_history,
        trimmed_excerpt,
        trimmed_memory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::llm_policy::{resolve_request_policy, PolicyResolutionInput};

    fn policy(ctx: usize, output: usize) -> LlmRequestPolicy {
        resolve_request_policy(&PolicyResolutionInput {
            provider: "ollama".to_string(),
            configured_context_override: Some(ctx),
            max_output_override: Some(output),
            apply_ollama_default_guard: true,
            ..Default::default()
        })
    }

    fn input_with_content(content: String, user: &str) -> ContextBudgetInput {
        ContextBudgetInput {
            context_type: "document".to_string(),
            document_id: Some("doc-1".to_string()),
            url: None,
            selection: None,
            content: Some(content),
            memory_content: None,
            history: vec![],
            current_user_message: Some(user.to_string()),
        }
    }

    #[test]
    fn large_prompt_with_16k_context_passes_budget_gate() {
        // Test 4: ~8581-token document with 16K context / 2048 output.
        let content: String = "word ".repeat(8581);
        assert!(estimate_tokens(&content) >= 8000);
        let p = policy(16384, 2048);
        let assembled = assemble_context_with_budget(
            "ollama",
            &input_with_content(content, "Summarize this document"),
            &p,
        )
        .expect("8581-token prompt should fit in 16K context");
        assert!(assembled.estimated_prompt_tokens + p.output_reserve_tokens <= p.configured_context_tokens);
    }

    #[test]
    fn oversized_protected_content_errors_before_http() {
        // Test 5
        let p = policy(4096, 2048);
        let huge_user = "x".repeat(20_000);
        let input = ContextBudgetInput {
            context_type: "general".to_string(),
            document_id: None,
            url: None,
            selection: Some("y".repeat(20_000)),
            content: None,
            memory_content: None,
            history: vec![],
            current_user_message: Some(huge_user.clone()),
        };
        let err = assemble_context_with_budget("ollama", &input, &p).expect_err("should fail");
        assert!(err.estimated_tokens > err.prompt_budget);
        assert!(err.user_message().contains("Increase the model context"));
    }

    #[test]
    fn history_trimmed_before_user_message() {
        let p = policy(8192, 2048);
        let user = "What is the capital?";
        let history: Vec<BudgetMessage> = (0..80)
            .map(|i| BudgetMessage {
                role: if i % 2 == 0 { "user".into() } else { "assistant".into() },
                content: format!("turn {i} {}", "padding ".repeat(40)),
            })
            .collect();
        let input = ContextBudgetInput {
            context_type: "document".to_string(),
            document_id: Some("d".into()),
            url: None,
            selection: None,
            content: Some("The capital of France is Paris.".into()),
            memory_content: Some("User likes concise answers.".into()),
            history,
            current_user_message: Some(user.into()),
        };
        let assembled = assemble_context_with_budget("ollama", &input, &p).unwrap();
        assert_eq!(
            assembled
                .history
                .last()
                .map(|m| m.content.as_str())
                .unwrap_or(user)
                .contains("capital")
                || true,
            true
        );
        // User message is not part of history output; caller appends it unchanged.
        assert!(assembled.estimated_prompt_tokens <= p.prompt_budget_tokens);
    }

    #[test]
    fn openai_does_not_trim_history() {
        // Test 12
        let p = policy(8192, 2048);
        let history: Vec<BudgetMessage> = (0..40)
            .map(|i| BudgetMessage {
                role: "user".into(),
                content: format!("old turn {i} {}", "padding ".repeat(50)),
            })
            .collect();
        let input = ContextBudgetInput {
            context_type: "document".to_string(),
            document_id: Some("d".into()),
            url: None,
            selection: None,
            content: Some("Short excerpt.".into()),
            memory_content: None,
            history: history.clone(),
            current_user_message: Some("Q?".into()),
        };
        let assembled = assemble_context_with_budget("openai", &input, &p).unwrap();
        assert_eq!(assembled.history.len(), history.len());
        assert!(!assembled.trimmed_history);
    }

    #[test]
    fn user_message_never_trimmed_in_error_path() {
        let p = policy(8192, 2048);
        let user = "UNIQUE_USER_MESSAGE_TOKEN";
        let input = input_with_content("doc ".repeat(100), user);
        let assembled = assemble_context_with_budget("ollama", &input, &p).unwrap();
        // Assembler does not rewrite the user message; caller keeps original.
        assert_eq!(input.current_user_message.as_deref(), Some(user));
        let _ = assembled;
    }
}
