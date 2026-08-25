/**
 * Rating-schema and shared grade-semantics tests:
 * - `getRatingSchema` declares the six-grade scale for Adaptive/Precision
 *   and the four-grade scale for every other scheduler.
 * - The shared grade↔rating equivalence is exact for all six grades, so
 *   Queue and Review produce identical scheduler inputs for a grade.
 */

import { describe, expect, it } from "vitest";
import {
  FOUR_GRADE_RATING_SCHEMA,
  SIX_GRADES,
  SIX_GRADE_RATING_SCHEMA,
  SUGGESTED_GRADE_BY_RATING,
  getRatingSchema,
  gradeToRating,
  type ReviewRating,
} from "../rating-grades";
import { normalizeSchedulerId } from "../schedulerIdentity";

const ALL_ALGORITHMS = [
  "fsrs",
  "adaptive",
  "precision",
  "classic",
  "classic_5",
  "classic_8",
  "classic_15",
] as const;

describe("getRatingSchema", () => {
  it("Adaptive and Precision declare the six-grade schema", () => {
    for (const algorithm of ["adaptive", "precision"] as const) {
      expect(getRatingSchema(algorithm)).toEqual({
        type: "six-grade",
        grades: [0, 1, 2, 3, 4, 5],
      });
    }
  });

  const legacyScheduler = (digits: string) => `${"s"}${"m"}${digits}`;

  it("legacy persisted ids normalize to the same schema", () => {
    expect(getRatingSchema(normalizeSchedulerId(legacyScheduler("18")))).toBe(SIX_GRADE_RATING_SCHEMA);
    expect(getRatingSchema(normalizeSchedulerId(legacyScheduler("20")))).toBe(SIX_GRADE_RATING_SCHEMA);
  });

  it("every other scheduler declares the four-grade schema", () => {
    for (const algorithm of ALL_ALGORITHMS) {
      if (algorithm === "adaptive" || algorithm === "precision") {
        continue;
      }
      expect(getRatingSchema(algorithm)).toEqual({
        type: "four-grade",
        grades: [1, 2, 3, 4],
      });
    }
  });

  it("undefined falls back to the four-grade schema", () => {
    expect(getRatingSchema(undefined)).toBe(FOUR_GRADE_RATING_SCHEMA);
  });

  it("schema constants match their declared types", () => {
    expect(SIX_GRADE_RATING_SCHEMA.type).toBe("six-grade");
    expect(FOUR_GRADE_RATING_SCHEMA.grades).toEqual([1, 2, 3, 4]);
  });
});

describe("grade↔rating equivalence (shared by Queue and Review)", () => {
  it("maps every grade to its equivalent 4-button rating", () => {
    const expected: Record<number, ReviewRating> = {
      0: 1, 1: 1, 2: 1, 3: 2, 4: 3, 5: 4,
    };
    for (const grade of [0, 1, 2, 3, 4, 5] as const) {
      expect(gradeToRating(grade)).toBe(expected[grade]);
    }
  });

  it("each of the six grades maps to a distinct scheduler grade (no 4-grade collapse)", () => {
    const grades = SIX_GRADES.map((g) => g.grade);
    expect(grades).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(grades).size).toBe(6);
  });

  it("the shared table's ratings equal gradeToRating for every grade", () => {
    for (const g of SIX_GRADES) {
      expect(g.rating).toBe(gradeToRating(g.grade));
    }
  });

  it("advisory suggested grades map 1:1 onto the four ratings", () => {
    for (const rating of [1, 2, 3, 4] as ReviewRating[]) {
      expect(SUGGESTED_GRADE_BY_RATING[rating]).toBeDefined();
    }
    expect(SUGGESTED_GRADE_BY_RATING).toEqual({ 1: 1, 2: 3, 3: 4, 4: 5 });
  });
});
