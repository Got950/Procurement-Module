import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { describeDb } from "../helpers/db";
import { CANARY_CASES, DB_CASES, GOLDEN_CASES, PURE_CASES } from "./golden";
import { runEvalCase } from "./runner";
import { COPILOT_PROMPT_VERSION } from "@/server/copilot/prompt";

const baseline = JSON.parse(
  readFileSync(join(process.cwd(), "tests/eval/baseline.json"), "utf8")
) as {
  promptVersion: string;
  expectedCaseIds: string[];
  expectedCanaryIds: string[];
};

describe("copilot eval — pure / canary (no DB)", () => {
  it("baseline prompt version matches code constant", () => {
    expect(baseline.promptVersion).toBe(COPILOT_PROMPT_VERSION);
  });

  it("baseline case ids match the golden dataset", () => {
    expect(GOLDEN_CASES.map((c) => c.id).sort()).toEqual([...baseline.expectedCaseIds].sort());
    expect(CANARY_CASES.map((c) => c.id).sort()).toEqual([...baseline.expectedCanaryIds].sort());
  });

  for (const caseDef of PURE_CASES) {
    it(`[${caseDef.canary ? "canary" : "full"}] ${caseDef.id}: ${caseDef.title}`, async () => {
      const result = await runEvalCase(caseDef);
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});

describeDb("copilot eval — golden (DB)", () => {
  for (const caseDef of DB_CASES) {
    it(`[${caseDef.canary ? "canary" : "full"}] ${caseDef.id}: ${caseDef.title}`, async () => {
      const result = await runEvalCase(caseDef);
      expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
