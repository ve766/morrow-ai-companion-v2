import test from "node:test";
import assert from "node:assert/strict";
import {
  lifecycleGate,
  lexicalCandidateGenerator,
  rankCandidates,
  selectContextWithinCharacterBudget
} from "../src/operators.js";
import { retrieveMemoryContext } from "../src/algorithm.js";

const activeMemory = (overrides = {}) => ({
  id: "m1",
  status: "active",
  subject: "user",
  scope: "conversation",
  content: "The user prefers concise explanations.",
  provenance: { messageId: "msg-1" },
  ...overrides
});

test("lifecycle gate rejects revoked/deleted or inactive memories", () => {
  assert.equal(lifecycleGate(activeMemory({ status: "revoked" })).allowed, false);
  assert.equal(lifecycleGate(activeMemory({ deleted: true })).allowed, false);
  assert.equal(lifecycleGate(activeMemory({ status: "pending" })).allowed, false);
});

test("lifecycle gate rejects subject and scope mismatches", () => {
  assert.equal(lifecycleGate(activeMemory(), { subject: "other" }).allowed, false);
  assert.equal(lifecycleGate(activeMemory(), { scope: "different" }).allowed, false);
});

test("lexical retrieval records zero-overlap candidates rather than treating zero as proof", () => {
  const results = lexicalCandidateGenerator("how should she answer me", [
    activeMemory({ id: "paraphrase", content: "The user prefers concise explanations." }),
    activeMemory({ id: "exact", content: "answer me directly" })
  ]);
  assert.equal(results.length, 2);
  assert.equal(results.some(item => item.lexicalScore === 0), true);
  assert.equal(results.some(item => item.memory.id === "exact" && item.lexicalScore > 0), true);
});

test("ranking is deterministic and honors requested limit", () => {
  const results = rankCandidates([
    { index: 0, lexicalScore: 0.2, memory: { id: "old", createdAt: "2024-01-01" } },
    { index: 1, lexicalScore: 0.2, memory: { id: "new", createdAt: "2025-01-01" } },
    { index: 2, lexicalScore: 0.1, memory: { id: "low" } }
  ], { limit: 2 });
  assert.deepEqual(results.map(item => item.memory.id), ["new", "old"]);
});

test("context selector enforces character budget and retains provenance metadata", () => {
  const candidate = { index: 0, lexicalScore: 1, memory: activeMemory() };
  const result = selectContextWithinCharacterBudget([candidate], 2000, { scope: "conversation", subject: "user" });
  assert.equal(result.withinBudget, true);
  assert.equal(result.selected.length, 1);
  assert.match(result.text, /provenance/);
  const tiny = selectContextWithinCharacterBudget([candidate], 10);
  assert.equal(tiny.selected.length, 0);
  assert.equal(tiny.omitted.length, 1);
  assert.equal(tiny.withinBudget, true);
});

test("end-to-end reference algorithm applies hard gates before context assembly", () => {
  const result = retrieveMemoryContext({
    query: "concise explanations",
    memories: [
      activeMemory({ id: "valid" }),
      activeMemory({ id: "revoked", status: "revoked" }),
      activeMemory({ id: "wrong-scope", scope: "other" })
    ],
    scope: "conversation",
    subject: "user",
    maxCharacters: 2000
  });
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].memory.id, "valid");
  assert.equal(result.context.withinBudget, true);
});
