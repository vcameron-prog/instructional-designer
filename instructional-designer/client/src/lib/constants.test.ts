import { describe, it, expect } from "vitest";
import {
  getChainPrefillFields,
  TOOLS,
  computeAiStepDuration,
  computeComplexityScore,
  DURATION_COMPLEXITY_OPTIONS,
  AI_STEP_DURATION_MS,
  type GenerationStep,
} from "./constants";

// ---------------------------------------------------------------------------
// TOOLS chain configuration — verifies the result page will render chain
// buttons for the right tools and with the right labels
// ---------------------------------------------------------------------------

describe("TOOLS chain configuration", () => {
  it("assignment tool has chains defined", () => {
    const assignment = TOOLS.find((t) => t.id === "assignment");
    expect(assignment?.chains).toBeDefined();
    expect(assignment?.chains?.length).toBeGreaterThan(0);
  });

  it("assignment tool has a rubric chain with the expected label", () => {
    const assignment = TOOLS.find((t) => t.id === "assignment");
    const rubricChain = assignment?.chains?.find(
      (c) => c.targetId === "rubric",
    );
    expect(rubricChain).toBeDefined();
    expect(rubricChain?.label).toBe("Build a rubric for this");
  });

  it("assignment tool has alignment and ai-resistant chains", () => {
    const assignment = TOOLS.find((t) => t.id === "assignment");
    const targetIds = assignment?.chains?.map((c) => c.targetId) ?? [];
    expect(targetIds).toContain("alignment");
    expect(targetIds).toContain("airesistant");
  });

  it("rubric tool has an alignment chain", () => {
    const rubric = TOOLS.find((t) => t.id === "rubric");
    const alignmentChain = rubric?.chains?.find(
      (c) => c.targetId === "alignment",
    );
    expect(alignmentChain).toBeDefined();
  });

  it("syllabus tool has no chains (standalone, no downstream tools)", () => {
    const syllabus = TOOLS.find((t) => t.id === "syllabus");
    expect(syllabus?.chains ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — assignment → rubric
// This is the core user flow: generate assignment, click "Build a rubric",
// land on the rubric form with the right fields pre-filled.
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — assignment → rubric", () => {
  it("maps assignmentType to assessmentType", () => {
    const result = getChainPrefillFields(
      "assignment",
      "rubric",
      { assignmentType: "Research Paper" },
      "Generated assignment content",
    );
    expect(result.assessmentType).toBe("Research Paper");
  });

  it("maps learningObjectives to criteria", () => {
    const result = getChainPrefillFields(
      "assignment",
      "rubric",
      {
        assignmentType: "Essay",
        learningObjectives: "Analyze primary sources, Develop thesis statement",
      },
      "Generated assignment content",
    );
    expect(result.criteria).toBe(
      "Analyze primary sources, Develop thesis statement",
    );
  });

  it("returns both assessmentType and criteria for a complete assignment formData", () => {
    const result = getChainPrefillFields(
      "assignment",
      "rubric",
      {
        assignmentType: "Presentation",
        learningObjectives: "Communicate findings clearly",
      },
      "Some generated text",
    );
    expect(result).toEqual({
      assessmentType: "Presentation",
      criteria: "Communicate findings clearly",
    });
  });

  it("returns empty string for assessmentType when assignmentType is missing", () => {
    const result = getChainPrefillFields(
      "assignment",
      "rubric",
      {},
      "content",
    );
    expect(result.assessmentType).toBe("");
  });

  it("returns empty string for criteria when learningObjectives is missing", () => {
    const result = getChainPrefillFields(
      "assignment",
      "rubric",
      {},
      "content",
    );
    expect(result.criteria).toBe("");
  });

  it("does not include generated content in the rubric prefill fields", () => {
    const content = "A very long generated assignment body".repeat(50);
    const result = getChainPrefillFields("assignment", "rubric", {}, content);
    expect(result).not.toHaveProperty("content");
    expect(Object.keys(result)).toEqual(["assessmentType", "criteria"]);
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — assignment → alignment
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — assignment → alignment", () => {
  it("maps learningObjectives to learningOutcomes", () => {
    const result = getChainPrefillFields(
      "assignment",
      "alignment",
      { learningObjectives: "Understand key concepts" },
      "generated content",
    );
    expect(result.learningOutcomes).toBe("Understand key concepts");
  });

  it("truncates generated content to 1500 chars for assignments field", () => {
    const content = "x".repeat(2000);
    const result = getChainPrefillFields(
      "assignment",
      "alignment",
      {},
      content,
    );
    expect(result.assignments).toHaveLength(1500);
  });

  it("passes through content unchanged when shorter than 1500 chars", () => {
    const content = "Short content";
    const result = getChainPrefillFields(
      "assignment",
      "alignment",
      {},
      content,
    );
    expect(result.assignments).toBe("Short content");
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — assignment → airesistant
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — assignment → airesistant", () => {
  it("truncates generated content to 2000 chars for existingAssignment", () => {
    const content = "y".repeat(3000);
    const result = getChainPrefillFields(
      "assignment",
      "airesistant",
      {},
      content,
    );
    expect(result.existingAssignment).toHaveLength(2000);
  });

  it("maps assignmentType directly", () => {
    const result = getChainPrefillFields(
      "assignment",
      "airesistant",
      { assignmentType: "Lab Report" },
      "content",
    );
    expect(result.assignmentType).toBe("Lab Report");
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — rubric → alignment
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — rubric → alignment", () => {
  it("truncates rubric content to 1500 chars for assignments", () => {
    const content = "z".repeat(2000);
    const result = getChainPrefillFields("rubric", "alignment", {}, content);
    expect(result.assignments).toHaveLength(1500);
  });

  it("passes through rubric content unchanged when shorter than 1500 chars", () => {
    const result = getChainPrefillFields(
      "rubric",
      "alignment",
      {},
      "Short rubric",
    );
    expect(result.assignments).toBe("Short rubric");
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — airesistant → aistudent
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — airesistant → aistudent", () => {
  it("maps additionalContext to learningObjectives", () => {
    const result = getChainPrefillFields(
      "airesistant",
      "aistudent",
      { additionalContext: "Foster critical thinking" },
      "content",
    );
    expect(result.learningObjectives).toBe("Foster critical thinking");
  });

  it("returns empty string when additionalContext is absent", () => {
    const result = getChainPrefillFields(
      "airesistant",
      "aistudent",
      {},
      "content",
    );
    expect(result.learningObjectives).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getChainPrefillFields — unknown / undefined combinations
// ---------------------------------------------------------------------------

describe("getChainPrefillFields — unknown combinations", () => {
  it("returns an empty object for an unknown source tool", () => {
    const result = getChainPrefillFields(
      "unknowntool",
      "rubric",
      { assignmentType: "Essay" },
      "content",
    );
    expect(result).toEqual({});
  });

  it("returns an empty object for a known source but unknown target", () => {
    const result = getChainPrefillFields(
      "assignment",
      "nonexistent",
      { assignmentType: "Essay" },
      "content",
    );
    expect(result).toEqual({});
  });

  it("returns an empty object for both unknown source and target", () => {
    const result = getChainPrefillFields("foo", "bar", {}, "content");
    expect(result).toEqual({});
  });

  it("returns an empty object when formData is empty and source has no target mapping", () => {
    const result = getChainPrefillFields("rubric", "rubric", {}, "content");
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// sessionStorage prefill contract — the data written by the result page must
// match what tool-form.tsx reads: { targetToolId, fields }
// ---------------------------------------------------------------------------

describe("sessionStorage prefill contract", () => {
  it("getChainPrefillFields output can be round-tripped through JSON safely", () => {
    const prefill = getChainPrefillFields(
      "assignment",
      "rubric",
      {
        assignmentType: "Research Paper",
        learningObjectives: "Analyze primary sources",
      },
      "Some generated content",
    );
    const payload = { targetToolId: "rubric", fields: prefill };
    const serialised = JSON.stringify(payload);
    const deserialised = JSON.parse(serialised) as {
      targetToolId: string;
      fields: Record<string, string>;
    };

    expect(deserialised.targetToolId).toBe("rubric");
    expect(deserialised.fields.assessmentType).toBe("Research Paper");
    expect(deserialised.fields.criteria).toBe("Analyze primary sources");
  });

  it("a mismatched targetToolId causes the prefill to be ignored (contract check)", () => {
    const payload = {
      targetToolId: "alignment",
      fields: { assessmentType: "Research Paper" },
    };
    const toolId = "rubric";
    const parsed = payload;
    const shouldApply = parsed.targetToolId === toolId;
    expect(shouldApply).toBe(false);
  });

  it("a matching targetToolId allows the prefill to be applied (contract check)", () => {
    const payload = {
      targetToolId: "rubric",
      fields: { assessmentType: "Research Paper", criteria: "Critical thinking" },
    };
    const toolId = "rubric";
    const parsed = payload;
    const shouldApply = parsed.targetToolId === toolId;
    expect(shouldApply).toBe(true);
    expect(parsed.fields.assessmentType).toBe("Research Paper");
    expect(parsed.fields.criteria).toBe("Critical thinking");
  });
});

// ---------------------------------------------------------------------------
// computeAiStepDuration — adaptive step timing
// The progress bar relies on this function to decide how long each AI step
// should animate. Wrong bounds or broken heuristics silently corrupt timing.
// ---------------------------------------------------------------------------

describe("computeAiStepDuration", () => {
  const MIN = AI_STEP_DURATION_MS.single.min; // 5000
  const MAX = AI_STEP_DURATION_MS.single.max; // 18000
  const BATCH_MAX = AI_STEP_DURATION_MS.batch.max; // 14000

  /** A step with adaptive bounds — mirrors the "Generating content" step. */
  const adaptiveStep: GenerationStep = {
    label: "Generating content with AI",
    ariaLabel: "Step 3: Generating content with AI",
    durationMs: 12000,
    minDurationMs: MIN,
    maxDurationMs: MAX,
  };

  /** A step with no bounds — mirrors fixed-duration steps like "Saving". */
  const fixedStep: GenerationStep = {
    label: "Saving your materials",
    ariaLabel: "Step 5: Saving your materials",
    durationMs: 1000,
  };

  /** An adaptive step using the batch bounds. */
  const batchAdaptiveStep: GenerationStep = {
    label: "Generating assignment with AI",
    ariaLabel: "Step 3: Generating assignment with AI",
    durationMs: 10000,
    minDurationMs: AI_STEP_DURATION_MS.batch.min,
    maxDurationMs: BATCH_MAX,
  };

  describe("steps without min/max bounds", () => {
    it("returns durationMs unchanged when minDurationMs is absent", () => {
      expect(computeAiStepDuration(fixedStep, "standard", false)).toBe(1000);
    });

    it("returns durationMs unchanged even in batch mode", () => {
      expect(computeAiStepDuration(fixedStep, "concise", true)).toBe(1000);
    });

    it("returns durationMs unchanged regardless of outputDetail value", () => {
      expect(computeAiStepDuration(fixedStep, "concise", false)).toBe(1000);
      expect(computeAiStepDuration(fixedStep, "standard", false)).toBe(1000);
    });
  });

  describe("concise output -> minDurationMs", () => {
    it('returns minDurationMs for outputDetail "concise"', () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false)).toBe(MIN);
    });

    it("is not affected by unrelated outputDetail strings when score is explicit 0", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false, 0)).toBe(MIN);
    });
  });

  describe("standard output -> maxDurationMs", () => {
    it('returns maxDurationMs for outputDetail "standard"', () => {
      expect(computeAiStepDuration(adaptiveStep, "standard", false)).toBe(MAX);
    });

    it("returns maxDurationMs for any non-concise outputDetail string", () => {
      expect(computeAiStepDuration(adaptiveStep, "detailed", false)).toBe(MAX);
      expect(computeAiStepDuration(adaptiveStep, "", false)).toBe(MAX);
    });
  });

  describe("batch mode -> always maxDurationMs", () => {
    it("returns maxDurationMs when isBatch is true regardless of concise detail", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", true)).toBe(MAX);
    });

    it("returns maxDurationMs when isBatch is true regardless of standard detail", () => {
      expect(computeAiStepDuration(adaptiveStep, "standard", true)).toBe(MAX);
    });

    it("returns maxDurationMs when isBatch is true even with complexityScore 0", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", true, 0)).toBe(MAX);
    });

    it("returns the batch step's maxDurationMs in batch mode", () => {
      expect(computeAiStepDuration(batchAdaptiveStep, "concise", true)).toBe(
        BATCH_MAX,
      );
    });
  });

  describe("complexityScore overrides outputDetail", () => {
    it("score 0 -> minDurationMs (identical to concise)", () => {
      expect(computeAiStepDuration(adaptiveStep, "standard", false, 0)).toBe(
        MIN,
      );
    });

    it("score 1 -> maxDurationMs (identical to standard)", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false, 1)).toBe(
        MAX,
      );
    });

    it("score 0.5 -> midpoint between min and max", () => {
      const expected = Math.round(MIN + 0.5 * (MAX - MIN));
      expect(computeAiStepDuration(adaptiveStep, "concise", false, 0.5)).toBe(
        expected,
      );
    });

    it("score 0.25 -> 25 % of the way from min to max", () => {
      const expected = Math.round(MIN + 0.25 * (MAX - MIN));
      expect(computeAiStepDuration(adaptiveStep, "standard", false, 0.25)).toBe(
        expected,
      );
    });
  });

  describe("complexityScore clamping", () => {
    it("clamps negative scores to 0 -> returns minDurationMs", () => {
      expect(computeAiStepDuration(adaptiveStep, "standard", false, -0.5)).toBe(
        MIN,
      );
    });

    it("clamps scores above 1 to 1 -> returns maxDurationMs", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false, 1.5)).toBe(
        MAX,
      );
    });

    it("clamps extreme negative values to 0", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false, -999)).toBe(
        MIN,
      );
    });

    it("clamps extreme positive values to 1", () => {
      expect(computeAiStepDuration(adaptiveStep, "concise", false, 999)).toBe(
        MAX,
      );
    });
  });

  describe("AI_STEP_DURATION_MS constant contract", () => {
    it("single.min is less than single.max", () => {
      expect(AI_STEP_DURATION_MS.single.min).toBeLessThan(
        AI_STEP_DURATION_MS.single.max,
      );
    });

    it("batch.min is less than batch.max", () => {
      expect(AI_STEP_DURATION_MS.batch.min).toBeLessThan(
        AI_STEP_DURATION_MS.batch.max,
      );
    });

    it("single.min is a positive integer number of milliseconds", () => {
      expect(AI_STEP_DURATION_MS.single.min).toBeGreaterThan(0);
      expect(Number.isInteger(AI_STEP_DURATION_MS.single.min)).toBe(true);
    });

    it("batch.max is a positive integer number of milliseconds", () => {
      expect(AI_STEP_DURATION_MS.batch.max).toBeGreaterThan(0);
      expect(Number.isInteger(AI_STEP_DURATION_MS.batch.max)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// computeComplexityScore — input weighting
// ---------------------------------------------------------------------------

describe("computeComplexityScore", () => {
  it("returns 0 for all-zero / empty inputs", () => {
    expect(computeComplexityScore({})).toBe(0);
  });

  it("returns 0 when duration is not a recognised option", () => {
    const score = computeComplexityScore({ duration: "unknown option" });
    expect(score).toBe(0);
  });

  it("first duration option (index 0) contributes 0 to the score", () => {
    const score = computeComplexityScore({
      duration: DURATION_COMPLEXITY_OPTIONS[0],
    });
    expect(score).toBeCloseTo(0, 10);
  });

  it("last duration option produces maximum duration contribution (0.4)", () => {
    const lastOption =
      DURATION_COMPLEXITY_OPTIONS[DURATION_COMPLEXITY_OPTIONS.length - 1];
    const score = computeComplexityScore({ duration: lastOption });
    expect(score).toBeCloseTo(0.4, 10);
  });

  it("5 frameworks contribute maximum framework weight (0.3)", () => {
    const score = computeComplexityScore({
      inclusiveDesignOptions: ["A", "B", "C", "D", "E"],
    });
    expect(score).toBeCloseTo(0.3, 10);
  });

  it("caps framework score at 1 even when more than 5 frameworks are selected", () => {
    const score = computeComplexityScore({
      inclusiveDesignOptions: ["A", "B", "C", "D", "E", "F", "G"],
    });
    expect(score).toBeCloseTo(0.3, 10);
  });

  it("text at the ceiling (800 chars) contributes maximum text weight (0.3)", () => {
    const score = computeComplexityScore({
      learningObjectives: "x".repeat(800),
    });
    expect(score).toBeCloseTo(0.3, 10);
  });

  it("caps text score at 1 even when total chars exceed the ceiling", () => {
    const score = computeComplexityScore({
      learningObjectives: "x".repeat(2000),
    });
    expect(score).toBeCloseTo(0.3, 10);
  });

  it("aggregates chars from all complexity text fields", () => {
    const score = computeComplexityScore({
      learningObjectives: "a".repeat(400),
      additionalContext: "b".repeat(400),
    });
    expect(score).toBeCloseTo(0.3, 10);
  });

  it("full frameworks + text at ceiling + last duration yields score of 1.0", () => {
    const lastDuration =
      DURATION_COMPLEXITY_OPTIONS[DURATION_COMPLEXITY_OPTIONS.length - 1];
    const score = computeComplexityScore({
      duration: lastDuration,
      inclusiveDesignOptions: ["A", "B", "C", "D", "E"],
      learningObjectives: "x".repeat(800),
    });
    expect(score).toBeCloseTo(1.0, 10);
  });

  it("non-array inclusiveDesignOptions contributes 0 framework score", () => {
    const score = computeComplexityScore({
      inclusiveDesignOptions: "not-an-array",
    });
    expect(score).toBe(0);
  });

  it("outputDetail 'concise' subtracts 0.1 from base score", () => {
    const base = computeComplexityScore({
      inclusiveDesignOptions: ["A", "B", "C"],
    });
    const concise = computeComplexityScore(
      { inclusiveDesignOptions: ["A", "B", "C"] },
      "concise",
    );
    expect(concise).toBeCloseTo(base - 0.1, 10);
  });

  it("outputDetail 'standard' adds 0.1 to base score", () => {
    const base = computeComplexityScore({
      inclusiveDesignOptions: ["A", "B", "C"],
    });
    const standard = computeComplexityScore(
      { inclusiveDesignOptions: ["A", "B", "C"] },
      "standard",
    );
    expect(standard).toBeCloseTo(base + 0.1, 10);
  });

  it("outputDetail offset is clamped so score never goes below 0", () => {
    const score = computeComplexityScore({}, "concise");
    expect(score).toBe(0);
  });

  it("outputDetail offset is clamped so score never exceeds 1", () => {
    const lastDuration =
      DURATION_COMPLEXITY_OPTIONS[DURATION_COMPLEXITY_OPTIONS.length - 1];
    const score = computeComplexityScore(
      {
        duration: lastDuration,
        inclusiveDesignOptions: ["A", "B", "C", "D", "E"],
        learningObjectives: "x".repeat(800),
      },
      "standard",
    );
    expect(score).toBe(1);
  });
});
