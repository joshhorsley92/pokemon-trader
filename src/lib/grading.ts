/**
 * Graded-slab metadata for trade-ins. Graded cards are NOT auto-priced — free
 * price data can't value slabs — so a graded line carries the grader + grade
 * and is quoted manually by an admin (custom offer after submission).
 */

export const GRADERS = ["PSA", "CGC", "BGS", "TAG", "SGC", "Other"] as const;
export type Grader = (typeof GRADERS)[number];

/** 10 down to 1 in half-steps — covers PSA whole grades and CGC/BGS halves. */
export const GRADES: string[] = (() => {
  const out: string[] = [];
  for (let g = 10; g >= 1; g -= 0.5) {
    out.push(Number.isInteger(g) ? String(g) : g.toFixed(1));
  }
  return out;
})();

export function isGrader(v: string): v is Grader {
  return (GRADERS as readonly string[]).includes(v);
}

/** Grade is a known step, or any short free text when grader is "Other". */
export function isValidGrade(v: string): boolean {
  return GRADES.includes(v) || (v.length > 0 && v.length <= 20);
}
