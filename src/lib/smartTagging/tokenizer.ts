/**
 * Tokenizer and stopword filter for Smart Tagging (TypeScript baseline)
 */

export const STOPWORDS = new Set([
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
]);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase());
}

export function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  const rawWords = text.toLowerCase().match(/\b[a-z0-9][a-z0-9\-_']*[a-z0-9]\b|\b[a-z0-9]\b/g) || [];
  for (const raw of rawWords) {
    const cleaned = raw.replace(/^[-']+|[-']+$/g, "");
    if (cleaned.length > 1 && !isStopword(cleaned)) {
      tokens.push(cleaned);
    }
  }
  return tokens;
}

export function tokenizeAllWords(text: string): string[] {
  const rawWords = text.toLowerCase().match(/\b[a-z0-9][a-z0-9\-_']*[a-z0-9]\b|\b[a-z0-9]\b/g) || [];
  return rawWords.map((w) => w.replace(/^[-']+|[-']+$/g, "")).filter((w) => w.length > 0);
}

export function extractCandidatePhrases(text: string): string[] {
  const words = tokenizeAllWords(text);
  const phrases: string[] = [];

  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const first = words[i];
    const second = words[i + 1];
    if (!isStopword(first) && !isStopword(second) && first.length > 1 && second.length > 1) {
      phrases.push(`${first} ${second}`);
    }
  }

  // Trigrams
  for (let i = 0; i < words.length - 2; i++) {
    const first = words[i];
    const middle = words[i + 1];
    const last = words[i + 2];
    if (!isStopword(first) && !isStopword(last) && first.length > 1 && last.length > 1) {
      phrases.push(`${first} ${middle} ${last}`);
    }
  }

  return phrases;
}
