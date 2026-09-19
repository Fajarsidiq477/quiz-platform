import { describe, expect, it } from "vitest";
import { answerResponseSchema } from "@/validation/answers";

describe("answerResponseSchema", () => {
  it("accepts option ids and trimmed text", () => {
    const id = "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b";
    expect(answerResponseSchema.parse({ optionIds: [id] })).toEqual({ optionIds: [id] });
    expect(answerResponseSchema.parse({ text: "  router  " })).toEqual({ text: "router" });
  });

  it("rejects empty, malformed and mixed payloads", () => {
    expect(answerResponseSchema.safeParse({ optionIds: [] }).success).toBe(false);
    expect(answerResponseSchema.safeParse({ optionIds: ["not-a-uuid"] }).success).toBe(false);
    expect(answerResponseSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(answerResponseSchema.safeParse({ text: "a", optionIds: [] }).success).toBe(false);
    expect(answerResponseSchema.safeParse({}).success).toBe(false);
  });
});
