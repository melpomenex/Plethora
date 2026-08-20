import { deleteExpiredPracticeAttempts, exportPracticeAttempts } from "./retention";
import type { PracticeAttempt } from "./types";

export interface PracticeAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class LanguagePracticeAttemptStore {
  constructor(private readonly storage: PracticeAttemptStorage, private readonly key = "plethora.language-practice.attempts") {}

  load(): PracticeAttempt[] {
    try {
      const value = JSON.parse(this.storage.getItem(this.key) ?? "[]");
      return Array.isArray(value) ? value as PracticeAttempt[] : [];
    } catch {
      return [];
    }
  }

  save(attempt: PracticeAttempt): void {
    const attempts = this.load().filter((candidate) => candidate.id !== attempt.id);
    this.storage.setItem(this.key, JSON.stringify([...attempts, attempt]));
  }

  delete(attemptId: string): void {
    this.storage.setItem(this.key, JSON.stringify(this.load().filter((attempt) => attempt.id !== attemptId)));
  }

  purgeExpired(now = Date.now()): number {
    const attempts = this.load();
    const retained = deleteExpiredPracticeAttempts(attempts, now);
    this.storage.setItem(this.key, JSON.stringify(retained));
    return attempts.length - retained.length;
  }

  export(includeRecordings = false): PracticeAttempt[] {
    return exportPracticeAttempts(this.load(), includeRecordings);
  }
}
