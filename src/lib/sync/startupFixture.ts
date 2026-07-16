export interface StartupFixtureDocument {
  id: string;
  collectionId: string;
  title: string;
  dateAdded: string;
  dateModified: string;
  progressPercent: number;
  content: string;
  metadata: string;
}

export interface StartupFixtureLearningItem {
  id: string;
  collectionId: string;
  documentId: string;
  question: string;
  answer: string;
  dueDate: string;
}

export interface StartupFixture {
  documents: StartupFixtureDocument[];
  learningItems: StartupFixtureLearningItem[];
}

const COLLECTION_ID = "00000000-0000-0000-0000-000000000001";

/** Deterministic local-data fixture for startup regression tests and profiling. */
export function createStartupFixture(
  documentCount = 1000,
  learningItemCount = 5000,
): StartupFixture {
  const documents = Array.from({ length: documentCount }, (_, index) => {
    const timestamp = new Date(Date.UTC(2024, 0, 1) + index * 86_400_000).toISOString();
    return {
      id: `doc-${String(index).padStart(4, "0")}`,
      collectionId: COLLECTION_ID,
      title: `Fixture document ${index}`,
      dateAdded: timestamp,
      dateModified: timestamp,
      progressPercent: index % 4 === 0 ? 25 : 0,
      // Deliberately large fields make accidental startup projection regressions
      // visible in serialized-size assertions without storing real user data.
      content: "content ".repeat(128),
      metadata: JSON.stringify({ author: `Author ${index}`, keywords: ["fixture", "startup"] }),
    };
  });
  const learningItems = Array.from({ length: learningItemCount }, (_, index) => ({
    id: `learning-${String(index).padStart(5, "0")}`,
    collectionId: COLLECTION_ID,
    documentId: documents[index % Math.max(1, documents.length)]?.id ?? "",
    question: `Question ${index}`,
    answer: `Answer ${index}`,
    dueDate: new Date(Date.UTC(2024, 6, 1) + (index % 14) * 86_400_000).toISOString(),
  }));
  return { documents, learningItems };
}

export function createEmptyStartupFixture(): StartupFixture {
  return { documents: [], learningItems: [] };
}
