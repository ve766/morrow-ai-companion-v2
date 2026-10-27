import {
  lexicalCandidateGenerator,
  rankCandidates,
  selectContextWithinCharacterBudget
} from "./operators.js";

/**
 * Reference algorithm composing candidate generation, ranking and context
 * selection. This intentionally does not persist memories, call a model, or
 * dispatch provider requests.
 */
export function retrieveMemoryContext({
  query,
  memories,
  scope,
  subject,
  allowedSensitivity,
  maxCandidates = 50,
  maxCharacters = 4000
}) {
  const candidates = lexicalCandidateGenerator(query, memories, {
    scope,
    subject,
    allowedSensitivity
  });
  const ranked = rankCandidates(candidates, { limit: maxCandidates });
  const context = selectContextWithinCharacterBudget(ranked, maxCharacters, {
    scope,
    subject
  });

  return {
    algorithmVersion: "0.1.0",
    queryDiagnostics: {
      queryTokenCount: String(query ?? "").normalize("NFKC").trim().split(/\s+/u).filter(Boolean).length,
      candidateCountBeforeBudget: ranked.length,
      zeroLexicalScoreCount: ranked.filter(item => item.lexicalScore === 0).length
    },
    ranked,
    context
  };
}
