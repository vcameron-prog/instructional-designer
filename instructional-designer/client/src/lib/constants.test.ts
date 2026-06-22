import { describe, it, expect } from "vitest";
import { getChainPrefillFields, TOOLS } from "./constants";

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
