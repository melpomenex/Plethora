//! Tokenizer and stopword filter for Smart Tagging
//!
//! Provides word-boundary tokenization, multilingual stopword removal,
//! and candidate phrase/n-gram extraction.

use std::collections::HashSet;
use std::sync::LazyLock;

/// Standard stopwords across English, Spanish, German, French, and generic academic filler
static STOPWORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    let list = [
        // English
        "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
        "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
        "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
        "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
        "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
        "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
        "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
        "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
        "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
        "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
        "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
        "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
        "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
        "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll",
        "they're", "they've", "this", "those", "through", "to", "too", "under",
        "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're",
        "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
        "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with",
        "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've",
        "your", "yours", "yourself", "yourselves",
        // Common generic / prose / academic filler
        "also", "using", "used", "use", "various", "chapter", "section", "page",
        "table", "figure", "et", "al", "introduction", "conclusion", "abstract",
        "summary", "overall", "therefore", "however", "furthermore", "moreover",
        "specifically", "generally", "example", "examples", "based", "first",
        "second", "third", "one", "two", "three", "four", "five", "well", "new",
        "good", "great", "may", "many", "much", "even", "like", "since", "still",
        // Spanish
        "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en",
        "para", "por", "con", "sin", "sobre", "como", "pero", "que", "este", "esta",
        "estos", "estas", "su", "sus", "mas", "más", "ya", "o", "u", "si", "sí",
        // French
        "le", "la", "les", "un", "une", "des", "du", "de", "dans", "pour", "par",
        "avec", "sans", "sur", "comme", "mais", "que", "qui", "ce", "cette", "ces",
        "son", "sa", "ses", "plus", "ou", "si", "est", "sont",
        // German
        "der", "die", "das", "ein", "eine", "einer", "eines", "einem", "einen",
        "und", "oder", "aber", "für", "mit", "von", "nach", "bei", "zu", "in",
        "auf", "über", "unter", "ist", "sind", "war", "waren", "nicht", "wie",
    ];
    list.into_iter().collect()
});

/// Checks if a word is in the stopword list (case-insensitive)
pub fn is_stopword(word: &str) -> bool {
    let lower = word.to_lowercase();
    STOPWORDS.contains(lower.as_str())
}

/// Tokenize text into normalized lowercase alphanumeric words, splitting on unicode boundaries.
pub fn tokenize_words(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current_token = String::new();

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            current_token.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '\'' {
            // Keep internal hyphen or apostrophe if surrounded by alphanumerics
            if !current_token.is_empty() {
                current_token.push(ch);
            }
        } else {
            if !current_token.is_empty() {
                let trimmed = current_token.trim_matches(|c| c == '-' || c == '\'').to_string();
                if !trimmed.is_empty() && trimmed.len() > 1 && !is_stopword(&trimmed) {
                    tokens.push(trimmed);
                }
                current_token.clear();
            }
        }
    }

    if !current_token.is_empty() {
        let trimmed = current_token.trim_matches(|c| c == '-' || c == '\'').to_string();
        if !trimmed.is_empty() && trimmed.len() > 1 && !is_stopword(&trimmed) {
            tokens.push(trimmed);
        }
    }

    tokens
}

/// Tokenize raw text preserving all words (including stopwords) for n-gram / phrase generation
pub fn tokenize_all_words(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current_token = String::new();

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            current_token.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '\'' {
            if !current_token.is_empty() {
                current_token.push(ch);
            }
        } else {
            if !current_token.is_empty() {
                let trimmed = current_token.trim_matches(|c| c == '-' || c == '\'').to_string();
                if !trimmed.is_empty() {
                    tokens.push(trimmed);
                }
                current_token.clear();
            }
        }
    }

    if !current_token.is_empty() {
        let trimmed = current_token.trim_matches(|c| c == '-' || c == '\'').to_string();
        if !trimmed.is_empty() {
            tokens.push(trimmed);
        }
    }

    tokens
}

/// Extract candidate n-gram keyphrases (bigrams and trigrams) from text.
/// Bigrams and trigrams cannot start or end with a stopword.
pub fn extract_candidate_phrases(text: &str) -> Vec<String> {
    let words = tokenize_all_words(text);
    let mut phrases = Vec::new();

    if words.len() >= 2 {
        for window in words.windows(2) {
            let first = &window[0];
            let second = &window[1];
            if !is_stopword(first) && !is_stopword(second) && first.len() > 1 && second.len() > 1 {
                phrases.push(format!("{} {}", first, second));
            }
        }
    }

    if words.len() >= 3 {
        for window in words.windows(3) {
            let first = &window[0];
            let middle = &window[1];
            let last = &window[2];
            // Trigrams can have a stopword in the middle (e.g., "point of view", "theory of mind"), but not at edges
            if !is_stopword(first) && !is_stopword(last) && first.len() > 1 && last.len() > 1 {
                phrases.push(format!("{} {} {}", first, middle, last));
            }
        }
    }

    phrases
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_word_tokenization_and_stopwords() {
        let text = "The software and hardware were undergoing testing in 2026.";
        let tokens = tokenize_words(text);
        assert_eq!(tokens, vec!["software", "hardware", "undergoing", "testing", "2026"]);
    }

    #[test]
    fn test_substring_boundary_preservation() {
        let text = "Software development forward warning warfare";
        let tokens = tokenize_words(text);
        assert_eq!(tokens, vec!["software", "development", "forward", "warning", "warfare"]);
        // None of the words are "war"
        assert!(!tokens.contains(&"war".to_string()));
    }

    #[test]
    fn test_extract_candidate_phrases() {
        let text = "Operating systems design and machine learning algorithms.";
        let phrases = extract_candidate_phrases(text);
        assert!(phrases.contains(&"operating systems".to_string()));
        assert!(phrases.contains(&"machine learning".to_string()));
        assert!(phrases.contains(&"learning algorithms".to_string()));
    }
}
