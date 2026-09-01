export interface ThirdPartyNotice {
  readonly name: string;
  readonly license: string;
  readonly copyright: string;
  readonly homepage: string;
  readonly description: string;
}

/** Notices for open-source components shipped with Plethora. */
export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[] = [
  {
    name: "fsrs-rs (FSRS-7)",
    license: "BSD-3-Clause",
    copyright: "Copyright (c) 2023, Open Spaced Repetition",
    homepage: "https://github.com/open-spaced-repetition/fsrs-rs",
    description:
      "Free Spaced Repetition Scheduler — production flashcard and document scheduling algorithm.",
  },
] as const;
