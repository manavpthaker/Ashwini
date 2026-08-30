import { describe, expect, it } from "vitest";
import { DOMAINS, DOMAIN_LABEL, isDomain } from "@/domain/domains";
import {
  attributedHealthClauses,
  containsWord,
  isOwnerHealthClause,
  mentionedMedications,
  normalize,
  respondSync,
} from "@/domain/advisor";
import { advisorInput, sertraline } from "./advisor/support";

describe("domains", () => {
  it("covers the PRD 7 learning domains plus system", () => {
    expect([...DOMAINS]).toEqual([
      "training",
      "nutrition",
      "medication",
      "body",
      "focus",
      "system",
    ]);
  });

  it("labels every domain", () => {
    for (const domain of DOMAINS) {
      expect(DOMAIN_LABEL[domain]).toBeTruthy();
    }
  });

  it("recognises its members and nothing else", () => {
    expect(isDomain("training")).toBe(true);
    expect(isDomain("sleep")).toBe(false);
    expect(isDomain(undefined)).toBe(false);
  });
});

describe("containsWord", () => {
  it("matches on whole-word boundaries", () => {
    expect(containsWord("i take iron daily", "iron")).toBe(true);
    expect(containsWord("my training environment", "iron")).toBe(false);
  });

  it("matches at the start and end of the string", () => {
    expect(containsWord("iron", "iron")).toBe(true);
    expect(containsWord("iron tablets", "iron")).toBe(true);
    expect(containsWord("took iron", "iron")).toBe(true);
  });

  it("treats punctuation as a boundary", () => {
    expect(containsWord("creatine, magnesium", "creatine")).toBe(true);
    expect(containsWord("is it creatine?", "creatine")).toBe(true);
  });

  it("handles multi-word needles", () => {
    expect(containsWord("i take vitamin d weekly", "vitamin d")).toBe(true);
    // "vitamin d" must not match inside "vitamin d3", which is a different item.
    expect(containsWord("i take vitamin d3", "vitamin d")).toBe(false);
  });

  it("escapes regex metacharacters in the needle", () => {
    expect(containsWord("omega-3 daily", "omega-3")).toBe(true);
    expect(containsWord("dose (morning)", "dose")).toBe(true);
    expect(() => containsWord("anything", "a+b*c")).not.toThrow();
  });

  it("returns false for an empty needle rather than matching everything", () => {
    expect(containsWord("anything at all", "")).toBe(false);
  });
});

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  My   SHOULDER\n hurts  ")).toBe("my shoulder hurts");
  });

  it("handles an empty string", () => {
    expect(normalize("   ")).toBe("");
  });
});

describe("health-clause subject attribution", () => {
  it("carries a named third party across a coordinated clause", () => {
    expect(attributedHealthClauses("My dad has chest pain and cannot breathe")).toEqual([
      { text: "My dad has chest pain", subject: "third_party" },
      { text: "cannot breathe", subject: "third_party" },
    ]);
  });

  it("lets a concrete first-person assertion take ownership back", () => {
    const clauses = attributedHealthClauses("My wife is here and I have chest pain");
    expect(clauses).toEqual([
      { text: "My wife is here", subject: "third_party" },
      { text: "I have chest pain", subject: "self" },
    ]);
    expect(clauses.map(isOwnerHealthClause)).toEqual([false, true]);
  });

  it("does not confuse observation or caregiving with the owner's health", () => {
    for (const text of [
      "I think my dad has chest pain",
      "I was there when my wife fainted",
      "Can I give my dad ibuprofen with lisinopril",
    ]) {
      expect(attributedHealthClauses(text)[0]?.subject, text).toBe("third_party");
    }
  });

  it("keeps terse owner check-ins usable", () => {
    const clause = attributedHealthClauses("chest pain")[0];
    expect(clause).toEqual({ text: "chest pain", subject: "unspecified" });
    expect(clause && isOwnerHealthClause(clause)).toBe(true);
  });
});

describe("mentionedMedications", () => {
  it("finds a medication by name", () => {
    const context = {
      input: advisorInput("took sertraline", { medications: [sertraline] }),
      text: "took sertraline",
    };
    expect(mentionedMedications(context)).toEqual(["sertraline"]);
  });

  it("finds a medication by brand alias and reports the canonical name", () => {
    const context = {
      input: advisorInput("took zoloft", { medications: [sertraline] }),
      text: "took zoloft",
    };
    expect(mentionedMedications(context)).toEqual(["sertraline"]);
  });

  it("returns nothing when none are mentioned", () => {
    const context = {
      input: advisorInput("i ate lunch", { medications: [sertraline] }),
      text: "i ate lunch",
    };
    expect(mentionedMedications(context)).toEqual([]);
  });
});

describe("meal classification", () => {
  const cases = [
    ["i had breakfast", "breakfast"],
    ["i ate lunch", "lunch"],
    ["dinner was late", "dinner"],
    ["had a snack", "snack"],
    ["i ate too much food", null],
  ] as const;

  for (const [utterance, expected] of cases) {
    it(`files "${utterance}" as ${expected ?? "an unclassified meal"}`, () => {
      const output = respondSync(advisorInput(utterance));
      expect(output.records).toContainEqual({ kind: "meal", mealKind: expected });
    });
  }
});

describe("body region capture", () => {
  it("records the region named in a symptom", () => {
    const output = respondSync(advisorInput("my left knee is sore"));
    expect(output.records).toContainEqual({
      kind: "symptom",
      text: "my left knee is sore",
      bodyRegion: "knee",
    });
  });

  it("records null when the symptom names no region", () => {
    const output = respondSync(advisorInput("everything aches today"));
    expect(output.records).toContainEqual({
      kind: "symptom",
      text: "everything aches today",
      bodyRegion: null,
    });
  });
});

describe("list formatting in user-facing copy", () => {
  // These strings appear in safety replies, so the grammar matters.
  it("names two supplements with 'and'", () => {
    const output = respondSync(advisorInput("should i take creatine and magnesium"));
    expect(output.reply.text).toMatch(/covering creatine and magnesium/);
  });

  it("uses a serial comma for three", () => {
    const output = respondSync(advisorInput("should i take creatine, magnesium and zinc?"));
    expect(output.reply.text).toMatch(/creatine, magnesium, and zinc/);
  });

  it("recognises a supplement the user declared but the built-in list does not know", () => {
    const output = respondSync(
      advisorInput("should i keep taking tongkat ali", { supplements: ["Tongkat Ali"] }),
    );
    expect(output.trace.ruleId).toBe("supplement-interaction");
    expect(output.reply.text).toMatch(/covering tongkat ali/i);
  });

  it("names three medications in a drug–drug route", () => {
    const output = respondSync(
      advisorInput("can i take sertraline, lisinopril and metformin together", {
        medications: [
          { name: "sertraline", aliases: [], isPrescription: true },
          { name: "lisinopril", aliases: [], isPrescription: true },
          { name: "metformin", aliases: [], isPrescription: true },
        ],
      }),
    );
    expect(output.reply.text).toMatch(/sertraline, lisinopril, and metformin/);
  });

  it("falls back gracefully when no medication is named", () => {
    // drug-drug requires a named medication, so the empty branch is reached
    // through the supplement rule's own list formatting.
    const output = respondSync(advisorInput("is there a supplement worth taking"));
    expect(output.reply.text).toMatch(/I can't answer that safely yet/);
  });
});
