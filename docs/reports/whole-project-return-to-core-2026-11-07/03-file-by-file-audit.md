# 03 · 逐文件审计

本文件由 `02-complete-file-inventory.csv` 生成；每个 tracked file 一行。`MANUAL_REVIEWED` 为人工阅读的 P0/关键文件；`AUTOMATED_REVIEWED` 为清点+静态扫描（未逐行人工阅读）；二进制文件只记录 hash 并排除逐行审阅。

| path | type | module | runtime | review | findings |
|---|---|---|---|---|---|
| `.env.real-model.example` | binary/other | (root) | no | AUTOMATED_REVIEWED | network surface |
| `.gitattributes` | binary/other | (root) | no | AUTOMATED_REVIEWED | none |
| `.github/workflows/ci.yml` | YAML | .github/workflows | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `.github/workflows/self-hosted-ci.yml` | YAML | .github/workflows | no | AUTOMATED_REVIEWED | process execution surface |
| `.gitignore` | binary/other | (root) | no | AUTOMATED_REVIEWED | credential identifier |
| `CHANGELOG.md` | Markdown | (root) | no | AUTOMATED_REVIEWED | credential identifier |
| `PROJECT_MEMORY.md` | Markdown | (root) | no | AUTOMATED_REVIEWED | network surface |
| `README.md` | Markdown | (root) | no | AUTOMATED_REVIEWED | credential identifier |
| `SECURITY.md` | Markdown | (root) | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/algorithms/affective-state.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/fact-memory-and-evidence-gate-v3.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/final-product-algorithm-contracts.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/final-product-algorithm-index.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/independent-judgment-eval-v2.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/memory-and-interest.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/algorithms/memory-retrieval-and-use-v2.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/personality-growth-runtime-v2.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/reflection-routing-v2.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-2-algorithm-registry.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-2-final-algorithm-registry.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-3-algorithm-registry.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-3-final-closure-implementation-design-v4.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-3-intent-understanding.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-4a-identity-and-fact-continuity.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-4a-memory-operation-planner.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-5-distress-context-scope.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-5-distress-evidence-calibration.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/algorithms/stage-5-relationship-mutation-and-expression-policy.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | process execution surface |
| `docs/algorithms/stage-5-state-expression-policy.md` | Markdown | docs/algorithms | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/data-model.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/database-schema.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/dependency-map.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/final-product-integration-map.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/final-product-runtime-map.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/module-contracts.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/morrow-v2-cognitive-loop.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/morrow-v2-data-lineage.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/morrow-v2-final-integrated-architecture.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/morrow-v2-final-migration-and-recovery.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/morrow-v2-runtime-architecture.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | console logging; credential identifier; network surface |
| `docs/architecture/pr-40-audit-findings-runtime-and-state-machine.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/provider-multi-source-architecture.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/architecture/provider-security-and-consent.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/architecture/stage-3-cognitive-runtime.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-3-evidence-dependency-graph.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-3-final-runtime-map.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-3-target-architecture-v2.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-4a-continuity-runtime.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-4a-pre-response-memory-operation.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-5-final-closeout-data-lifecycle.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/architecture/stage-5-outbox-multiprocess-invariants.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | process execution surface |
| `docs/architecture/stage-5-relational-continuity.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/stage-5-relationship-lifecycle-and-deletion.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/architecture/system-overview.md` | Markdown | docs/architecture | no | AUTOMATED_REVIEWED | none |
| `docs/audit/final-product-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/final-product-pr-integration-map.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/final-product-root-cause-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/legacy-asset-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/morrow-v2-capability-maturity-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/morrow-v2-conversation-runtime-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/morrow-v2-final-closure-baseline.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-final-file-review-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/morrow-v2-final-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-final-software-independent-review-r2.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-final-software-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-local-deployment-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/morrow-v2-rc-file-review-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/morrow-v2-rc-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-risk-dependency-register.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/morrow-v2-self-hosted-ci-file-review-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review-r2.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review-r2.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review-r3.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-independent-review-postfix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/audit/morrow-v2-self-hosted-ci-independent-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/audit/morrow-v2-system-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | network surface |
| `docs/audit/provider-multi-source-baseline-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/stage-2-cognitive-algorithm-implementation-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-2-final-closeout-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/audit/stage-2-final-delivery-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/stage-2-next-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-2-post-hardening-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | console logging |
| `docs/audit/stage-2-repository-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | console logging; network surface |
| `docs/audit/stage-3-final-closure-delta-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-final-closure-evidence-index.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-final-independent-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-followup-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-independent-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-independent-final-acceptance.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/audit/stage-3-provider-credential-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | console logging; credential identifier |
| `docs/audit/stage-3-remediation-evidence-index.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-runtime-and-data-lineage-review.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-3-whole-phase-independent-audit.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-5-final-audit-repair.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-5-final-closeout-findings.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | network surface |
| `docs/audit/stage-5-final-closeout-root-cause-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/audit/stage-5-independent-review-findings.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | process execution surface; network surface |
| `docs/audit/stage-5-root-cause-matrix.md` | Markdown | docs/audit | no | AUTOMATED_REVIEWED | none |
| `docs/backlog/post-release-backlog.md` | Markdown | docs/backlog | no | AUTOMATED_REVIEWED | none |
| `docs/ci/ci-no-billing-operations.md` | Markdown | docs/ci | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/ci/self-hosted-runner-setup-windows.md` | Markdown | docs/ci | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/governance/issue-20-requirement-disposition.md` | Markdown | docs/governance | no | AUTOMATED_REVIEWED | none |
| `docs/governance/morrow-v2-development-baseline-v1.0-candidate.md` | Markdown | docs/governance | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/handoff/stage-4-entry-brief.md` | Markdown | docs/handoff | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/install/windows-installation-guide.md` | Markdown | docs/install | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/install/windows-troubleshooting.md` | Markdown | docs/install | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/cognitive-loop-v1-phase2-1-1.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/cognitive-loop-v1-phase2-1.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/cognitive-loop-v1-phase2-2.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/cognitive-loop-v1-phase2-3.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/cognitive-loop-v1-phase2-4-closeout.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | console logging; credential identifier; network surface |
| `docs/reports/cognitive-loop-v1-phase2-4-remediation.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/cognitive-loop-v1-phase2-4.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/cognitive-loop-v1-phase2.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/cognitive-loop-v1-slice1.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/cognitive-loop-v1-slice2-1.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/cognitive-loop-v1-slice2-2.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/cognitive-loop-v1-slice2.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/final-product-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/final-product-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/final-product-release-notes.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-audit-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-audit-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/morrow-v2-conversation-runtime-repair-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-final-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/morrow-v2-final-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/morrow-v2-final-software-delivery-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/morrow-v2-final-software-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/reports/morrow-v2-final-work-log.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/morrow-v2-local-deployment-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-local-deployment-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/morrow-v2-rc-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/morrow-v2-rc-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/morrow-v2-rc-work-log.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-runtime-trace-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/morrow-v2-self-hosted-ci-final-correctness-acceptance-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-self-hosted-ci-final-correctness-closeout.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/morrow-v2-self-hosted-ci-final-correctness-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/morrow-v2-self-hosted-ci-hardening-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/morrow-v2-self-hosted-ci-hardening-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/pr-40-audit-findings-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/pr-40-audit-findings-repair-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/pr-40-audit-findings-work-log.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/baseline-and-findings.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/ci-guard-security-and-run.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/final-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/known-limitations-delta.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/product-verification-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/fast.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/full.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/product-closure-2026-11-07/results/product.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/stages.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/product-closure-2026-11-07/results/ui-effects.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/verification-summary.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/window-human-gate.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/results/window-visibility.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/product-closure-2026-11-07/ui-control-binding-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/product-closure-2026-11-07/windows-desktop-visibility.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/provider-multi-source-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/provider-multi-source-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/provider-multi-source-work-log.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-2-cognitive-algorithm-implementation.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-2-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-2-final-closeout.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-2-final-delivery-current.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-2-final-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-2-final-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-2-hardening-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-2-next-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-3-acceptance-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-baseline-and-traceability.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-c1-behavior-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-capability-maturity-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-ci-workflow.patch` | binary/other | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-code-review-findings.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-commit-record.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-3-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-final-acceptance-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/stage-3-final-closure-repair-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-final-closure-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-3-final-correction-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/stage-3-final-decision.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-final-gap-closure-audit.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-final-gate-matrix.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-final-remediation-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-final-verification.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-followup-gap-closure.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-3-followup-implementation-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-3-live-provider-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-open-defects-and-blockers.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/stage-3-real-provider-evidence.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/stage-3-reproducibility-log.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/reports/stage-4-companion-confirmation-closure-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-companion-confirmation-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-evidence-consistency-closeout.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-final-audit-closure.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-final-repair-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-final-repair-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4-migration-verification.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-4a-baseline-and-gap-analysis.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4a-delivery-report.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-4a-final-repair-baseline.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-4a-final-repair-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-baseline.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-5-final-audit-repair-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-final-audit-repair-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | process execution surface; network surface |
| `docs/reports/stage-5-final-closeout-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-final-closeout-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/stage-5-remediation-delivery.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/stage-5-remediation-evidence-index.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | network surface |
| `docs/reports/whole-project-return-to-core-2026-11-07/00-executive-findings.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/01-branch-and-baseline-map.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/02-complete-file-inventory.csv` | CSV | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/whole-project-return-to-core-2026-11-07/03-file-by-file-audit.md` | Markdown | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/whole-project-return-to-core-2026-11-07/04-runtime-call-graph.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/05-cognitive-dataflow-and-state-machines.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/06-algorithm-gap-and-upgrade-plan.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/07-findings-and-repair-log.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/08-product-behavior-acceptance.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/09-security-data-lifecycle-review.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/10-final-delivery-report.md` | Markdown | docs/reports | no | MANUAL_REVIEWED | network surface |
| `docs/reports/whole-project-return-to-core-2026-11-07/results/audit-coverage.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/results/cognition-behavior-evaluation.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/results/identity-behavior-evaluation.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/reports/whole-project-return-to-core-2026-11-07/results/retrieval-ablation.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/reports/whole-project-return-to-core-2026-11-07/results/static-and-test-verification.json` | JSON | docs/reports | no | AUTOMATED_REVIEWED | none |
| `docs/testing/acceptance-report.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/testing/final-product-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/known-limitations.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | console logging |
| `docs/testing/morrow-v2-conversation-runtime-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/morrow-v2-final-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/testing/morrow-v2-final-software-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/testing/morrow-v2-local-deployment-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/morrow-v2-rc-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/testing/pr-40-audit-findings-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/provider-multi-source-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/testing/shared-real-model-test-contract.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `docs/testing/stage-3-final-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-3-final-closure-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-3-final-closure-repair-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-4-final-repair-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | network surface |
| `docs/testing/stage-4a-acceptance-report.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-4a-final-repair-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | network surface |
| `docs/testing/stage-5-acceptance-matrix.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | network surface |
| `docs/testing/stage-5-final-audit-repair-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-5-final-closeout-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/testing/stage-5-remediation-acceptance.md` | Markdown | docs/testing | no | AUTOMATED_REVIEWED | none |
| `docs/ui/acceptance-matrix.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/control-contract.json` | JSON | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/current-ui-audit.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/design-system.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | credential identifier |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T031237Z-f9c9988e/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T034317Z-8dc025dc/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T071402Z-608ab4c9/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261105T084141Z-45483dd6/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/claude-layout-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-brutal-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-collage-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-holo-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-none-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-perspective-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/effect-plasma-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107-issue61/visual-lab-native.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102620Z-7a25a016/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T102746Z-4964ec22/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121126Z-4e5d8376/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T121523Z-93bb5748/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122037Z-8abab577/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122549Z-56142fb1/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/20261107T122719Z-4e4254c2/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/README.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/manifest.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T191500Z-rc-ac00627/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/chat-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/chat-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/chat-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/manifest.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/memory-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/memory-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/memory-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/settings-1280x800.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/settings-1440x900.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/evidence/rc-20261105T195500Z-rc-fad6a94/settings-390x844.png` | binary/other | docs/ui | no | EXCLUDED_BINARY | none |
| `docs/ui/implementation-and-regression-report.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | none |
| `docs/ui/reference-inventory.md` | Markdown | docs/ui | no | AUTOMATED_REVIEWED | credential identifier |
| `electron.vite.config.ts` | TypeScript | (root) | no | AUTOMATED_REVIEWED | network surface |
| `evals/final-product/results/20261102T140759Z-526be27589f3b2047f042a77f211281dbeb51ea8.json` | JSON | evals/final-product | no | AUTOMATED_REVIEWED | none |
| `evals/final-product/review/human-review-packet.md` | Markdown | evals/final-product | no | AUTOMATED_REVIEWED | none |
| `evals/final-product/review/real-provider-transcript.md` | Markdown | evals/final-product | no | AUTOMATED_REVIEWED | none |
| `evals/final-product/run.ts` | TypeScript | evals/final-product | no | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier |
| `evals/final-product/scenarios-v1.json` | JSON | evals/final-product | no | AUTOMATED_REVIEWED | none |
| `evals/final-product/transcripts/20261102T140416Z-526be27.md` | Markdown | evals/final-product | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-final/results/20261104T124128Z-125af6f6.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261104T124142Z-933adad0.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261104T154241Z-1430f856.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261104T155831Z-899f5cb0.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261105T031237Z-f9c9988e.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261105T034317Z-8dc025dc.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261105T071402Z-608ab4c9.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261105T084141Z-45483dd6.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T102620Z-7a25a016.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T102746Z-4964ec22.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T121126Z-4e5d8376.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T121523Z-93bb5748.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T122037Z-8abab577.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T122549Z-56142fb1.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/results/20261107T122719Z-4e4254c2.json` | JSON | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261104T124128Z-125af6f6.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-final/transcripts/20261104T124142Z-933adad0.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-final/transcripts/20261104T154241Z-1430f856.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261104T155831Z-899f5cb0.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261105T031237Z-f9c9988e.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261105T034317Z-8dc025dc.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261105T071402Z-608ab4c9.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261105T084141Z-45483dd6.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T102620Z-7a25a016.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T102746Z-4964ec22.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T121126Z-4e5d8376.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T121523Z-93bb5748.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T122037Z-8abab577.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T122549Z-56142fb1.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-final/transcripts/20261107T122719Z-4e4254c2.md` | Markdown | evals/morrow-v2-final | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe` | binary/other | evals/morrow-v2-rc | no | EXCLUDED_BINARY | none |
| `evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe.sha256` | binary/other | evals/morrow-v2-rc | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-rc/results/20261105T191500Z-rc-ac00627.json` | JSON | evals/morrow-v2-rc | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-rc/results/20261105T195500Z-rc-fad6a94.json` | JSON | evals/morrow-v2-rc | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-rc/transcripts/20261105T191500Z-rc-ac00627.md` | Markdown | evals/morrow-v2-rc | no | AUTOMATED_REVIEWED | none |
| `evals/morrow-v2-rc/transcripts/20261105T195500Z-rc-fad6a94.md` | Markdown | evals/morrow-v2-rc | no | AUTOMATED_REVIEWED | none |
| `evals/pr-40-audit-findings/results/20261104T051210Z-dd9f59b10c7c812c3af36684a32d15193bda7d50-repair.json` | JSON | evals/pr-40-audit-findings | no | AUTOMATED_REVIEWED | none |
| `evals/pr-40-audit-findings/results/20261104T060849Z-1f736c6b788527bbffad186267679b1df63ff0a1-repair.json` | JSON | evals/pr-40-audit-findings | no | AUTOMATED_REVIEWED | none |
| `evals/pr-40-audit-findings/results/20261104T065544Z-16620217cd0fd1ace9598fd57c74bc6425a6b16f-repair.json` | JSON | evals/pr-40-audit-findings | no | AUTOMATED_REVIEWED | none |
| `evals/pr-40-audit-findings/results/20261104T072000Z-16620217cd0fd1ace9598fd57c74bc6425a6b16f-ci-closure.json` | JSON | evals/pr-40-audit-findings | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T114033Z-10e4a3e2.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T123748Z-5fc34109.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T123809Z-02e942cb.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T135122Z-61925d68.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T135128Z-4b52e060.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T135205Z-75b01260.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261104T135210Z-abf69f16.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/results/20261107T103635Z-0d0daec4.json` | JSON | evals/provider-multi-source | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/provider-multi-source/run.ts` | TypeScript | evals/provider-multi-source | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/provider-multi-source/transcripts/20261104T114033Z-10e4a3e2.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T123748Z-5fc34109.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T123809Z-02e942cb.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T135122Z-61925d68.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T135128Z-4b52e060.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T135205Z-75b01260.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261104T135210Z-abf69f16.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | network surface |
| `evals/provider-multi-source/transcripts/20261107T103635Z-0d0daec4.md` | Markdown | evals/provider-multi-source | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/real-provider/final-closure-live/run.ts` | TypeScript | evals/real-provider | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/real-provider/results/20261031T083700Z-ee728fd.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261031T085512Z-6a885fa.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261031T155846Z-unknown-semantic.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/real-provider/results/20261031T161446Z-unknown-semantic.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/real-provider/results/20261101T072132Z-0c5bcb9-live.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T073849Z-0c5bcb9-semantic.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T074235Z-c561aba-semantic.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T074920Z-f7dffec-semantic.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T091701Z-d43cfb6-final-closure.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T102820Z-8f662e2-final-closure.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/results/20261101T113026Z-1b49489-final-closure.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/real-provider/results/20261101T113211Z-1b49489-final-closure.json` | JSON | evals/real-provider | no | AUTOMATED_REVIEWED | network surface |
| `evals/real-provider/review/final-closure-human-review.md` | Markdown | evals/real-provider | no | AUTOMATED_REVIEWED | none |
| `evals/real-provider/review/final-closure-review.md` | Markdown | evals/real-provider | no | AUTOMATED_REVIEWED | none |
| `evals/real-provider/review/live-review-0c5bcb9.md` | Markdown | evals/real-provider | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/README.md` | Markdown | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T11-42-57-bdeabdd.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T11-44-43-d77643c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T16-24-09-8bd12a6.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T16-29-34-558c70e.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T16-45-20-1c4a69b.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T16-47-26-b497879.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T17-06-00-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-29T17-09-27-7220df3.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T02-48-43-5635a9c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T03-05-37-cd87ddb.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T03-06-04-cd87ddb.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T03-08-25-e25308c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T03-15-45-02c2e4a.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T04-15-43-fff5a13.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T04-31-24-6e8fece.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T05-35-09-8650c48.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T06-09-30-67f2a37.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T06-12-49-42a51e0.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-17-05-792Z-55432fc-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-17-21-359Z-55432fc-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-17-57-420Z-55432fc-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-18-14-358Z-55432fc-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-18-31-444Z-55432fc-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-24-31-267Z-d856e25-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-27-02-d856e25.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-34-19-b5d09f8.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T07-34-50-725Z-b5d09f8-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T08-36-25-abaef42.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T08-40-14-a8e382d.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/results/2026-10-30T08-43-28-440Z-5d4f8b2-reflection-positive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/ablation/run.ts` | TypeScript | evals/stage-2 | no | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier |
| `evals/stage-2/b1-devset.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b1.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b4-faults.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b5-ablation.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | network surface |
| `evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-verification.txt` | binary/other | evals/stage-2 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-2/provider/README.md` | Markdown | evals/stage-2 | no | AUTOMATED_REVIEWED | network surface |
| `evals/stage-2/provider/phase24-real-model-26aeac7.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | network surface |
| `evals/stage-2/results/2026-10-29T08-35Z-local-not-run-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | network surface |
| `evals/stage-2/results/2026-10-29T08-35Z-local-not-run.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T09-34-34-55c9aef-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T09-34-34-55c9aef.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T09-37-54-2174fa2-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T09-37-54-2174fa2.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-30-50-4a74452-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-30-50-4a74452.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-34-58-39993bd-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-34-58-39993bd.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-43-14-4282bf5-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-43-14-4282bf5.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-51-02-0b49f25-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T10-51-02-0b49f25.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T11-44-49-d77643c-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T11-44-49-d77643c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-47-09-ab25dee-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-47-09-ab25dee.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-48-41-ab25dee-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-48-41-ab25dee.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-49-37-ab25dee-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T12-49-37-ab25dee.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T13-51-10-b19f7fc-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T13-51-10-b19f7fc.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-02-23-8bd12a6-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-02-23-8bd12a6.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-12-19-8bd12a6-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-12-19-8bd12a6.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-13-22-8bd12a6-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-13-22-8bd12a6.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-18-21-8bd12a6-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-18-21-8bd12a6.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-29-22-558c70e-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-29-22-558c70e.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-45-15-1c4a69b-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-45-15-1c4a69b.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-47-15-b497879-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-47-15-b497879.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-58-03-0899223-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-58-03-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-59-23-0899223-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T16-59-23-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-00-38-0899223-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-00-38-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-04-07-0899223-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-04-07-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-07-13-0899223-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-07-13-0899223.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-09-16-7220df3-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-29T17-09-16-7220df3.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T02-45-13-505ef71-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T02-45-13-505ef71.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T02-48-36-5635a9c-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T02-48-36-5635a9c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T03-08-17-e25308c-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T03-08-17-e25308c.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T03-15-37-02c2e4a-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T03-15-37-02c2e4a.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T04-15-26-fff5a13-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T04-15-26-fff5a13.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T04-31-08-6e8fece-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T04-31-08-6e8fece.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T05-34-56-8650c48-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T05-34-56-8650c48.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-09-22-67f2a37-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-09-22-67f2a37.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-12-40-42a51e0-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-12-40-42a51e0.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-47-15-006Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-47-52-276Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-48-22-186Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-49-50-958Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-52-42-895Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-52-59-650Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-53-16-298Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-54-22-300Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T06-57-16-976Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-01-48-365Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-02-00-946Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-02-33-400Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-03-30-523Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-03-45-655Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-04-29-527Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-09-33-426Z-55432fc-b1-calibration.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-24-29-516Z-d856e25-cognitive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-24-53-d856e25-verification.txt` | binary/other | evals/stage-2 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-2/results/2026-10-30T07-26-54-d856e25-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-26-54-d856e25.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-32-08-b5d09f8-verification.txt` | binary/other | evals/stage-2 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-2/results/2026-10-30T07-34-10-b5d09f8-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-34-10-b5d09f8.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T07-34-49-284Z-b5d09f8-cognitive.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T08-36-16-abaef42-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T08-36-16-abaef42.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T08-40-01-a8e382d-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-10-30T08-40-01-a8e382d.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-11-07T10-35-17-68468cf-summary.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/2026-11-07T10-35-17-68468cf.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/topic-identity-devset-report.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/results/verify-42a51e0-061042.txt` | binary/other | evals/stage-2 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-2/runner/cli.ts` | TypeScript | evals/stage-2 | no | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier |
| `evals/stage-2/scenarios-v1.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-2/topic-identity-devset.json` | JSON | evals/stage-2 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-2/topic-identity-metrics.ts` | TypeScript | evals/stage-2 | no | AUTOMATED_REVIEWED | console logging; process execution surface |
| `evals/stage-3/ablation/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261030T114024Z-00a300e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261030T122940Z-7dbe70e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261030T131854Z-1ed0465.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261030T134509Z-6e9b47a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261030T141959Z-d8ee10f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261031T035158Z-43c9281.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261031T063933Z-b0e719a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261101T045045Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/results/20261101T072639Z-2ac389e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/ablation/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T084427Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T084638Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T084848Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T085013Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T085205Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T085701Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T085949Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T090234Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T090554Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T090748Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T091117Z-170601e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T101039Z-e249163.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T101742Z-e249163.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T102204Z-e249163.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T102502Z-e249163.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261101T113035Z-1b49489.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/results/20261107T103636Z-68468cf.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | process execution surface |
| `evals/stage-3/final-closure/traces/20261101T091117Z-170601e.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/traces/20261101T102502Z-e249163.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/final-closure/traces/20261101T113035Z-1b49489.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-3/intent-understanding/results/20261031T125539Z-6ae4520.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T144352Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T145134Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T160200Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T160717Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T161012Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261031T161448Z-unknown.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261101T045308Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261101T071022Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/results/20261101T072903Z-2ac389e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | process execution surface |
| `evals/stage-3/intent-understanding/semantic.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-3/intent-understanding/traces/20261031T125539Z-6ae4520.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T144352Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T145134Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T160200Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T160717Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T161012Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261031T161448Z-unknown.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261101T045308Z-5fe62f5.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261101T071022Z-1a9d2fd.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/intent-understanding/traces/20261101T072903Z-2ac389e.jsonl` | binary/other | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/live/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-3/live/results/20261031T073847Z-876d263.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/live/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-3/long-conversation/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261030T123052Z-7dbe70e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261030T132009Z-1ed0465.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261030T134621Z-6e9b47a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261030T142117Z-d8ee10f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261031T035322Z-43c9281.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261031T064154Z-b0e719a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261101T045257Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/results/20261101T072853Z-2ac389e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/long-conversation/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261030T114114Z-00a300e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261030T123041Z-7dbe70e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261030T131959Z-1ed0465.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261030T134611Z-6e9b47a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261030T142107Z-d8ee10f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261031T035311Z-43c9281.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261031T064131Z-b0e719a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261101T045245Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/results/20261101T072837Z-2ac389e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/longitudinal/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T064130Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T064425Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T064529Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T064709Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T065150Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T065521Z-9e1fd5f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T070345Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T071006Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/results/20261101T071416Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/memory-recall/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | process execution surface |
| `evals/stage-3/restart/README.md` | Markdown | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261030T123047Z-7dbe70e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261030T132005Z-1ed0465.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261030T134618Z-6e9b47a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261030T142114Z-d8ee10f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261031T035319Z-43c9281.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261031T064150Z-b0e719a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261101T045253Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261101T072849Z-2ac389e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/results/20261107T103559Z-68468cf.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/restart/run.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T114011Z-00a300e-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T114011Z-00a300e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T122922Z-7dbe70e-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T122922Z-7dbe70e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T131842Z-1ed0465-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T131842Z-1ed0465.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T134452Z-6e9b47a-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T134452Z-6e9b47a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T141940Z-d8ee10f-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261030T141940Z-d8ee10f.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261031T035139Z-43c9281-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261031T035139Z-43c9281.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261031T063724Z-b0e719a-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261031T063724Z-b0e719a.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T045020Z-5fe62f5-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T045020Z-5fe62f5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T065849Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T065849Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070046Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070046Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070210Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070210Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070318Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070318Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070448Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070448Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070537Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070537Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070700Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070700Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070936Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T070936Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T071339Z-1a9d2fd-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261101T071339Z-1a9d2fd.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T025405Z-1692456-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T025405Z-1692456.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T031810Z-9ea5387-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T031810Z-9ea5387.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T032750Z-d986403-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T032750Z-d986403.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T051918Z-80851cf-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T051918Z-80851cf.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T064209Z-0b9071e-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T064209Z-0b9071e.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T134637Z-526be27-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T134637Z-526be27.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T153506Z-7b83fea-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261102T153506Z-7b83fea.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T041302Z-b729917-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T041302Z-b729917.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T042747Z-1ab1f64-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T042747Z-1ab1f64.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T152321Z-294dcd5-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261103T152321Z-294dcd5.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T050848Z-dd9f59b-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T050848Z-dd9f59b.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T060733Z-1f736c6-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T060733Z-1f736c6.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T065500Z-1662021-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261104T065500Z-1662021.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261107T103518Z-68468cf-summary.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/results/20261107T103518Z-68468cf.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/runner/cli.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/runner/harness.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `evals/stage-3/scenarios-v1.json` | JSON | evals/stage-3 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-3/shared/real-provider.ts` | TypeScript | evals/stage-3 | no | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `evals/stage-4-companion-confirmation/results/20261102T155319Z-7b83fea8aa9ec7847bf47541e49dde073137059f.json` | JSON | evals/stage-4-companion-confirmation | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4-companion-confirmation/results/20261103T044602Z-1ab1f64d561ab241e3a9321167f7dbc6c607f1b4.json` | JSON | evals/stage-4-companion-confirmation | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4-companion-confirmation/results/20261103T154342Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8.json` | JSON | evals/stage-4-companion-confirmation | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4-companion-confirmation/results/20261103T162520Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8-ci-closure.json` | JSON | evals/stage-4-companion-confirmation | no | AUTOMATED_REVIEWED | network surface |
| `evals/stage-4a/fixtures/cat-name-continuity.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/fixtures/cat-name-correction-v2.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T131216Z-c5dcd5b.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T131303Z-c5dcd5b-stage-4a.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T131946Z-fc7f550-stage-4a.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T132529Z-23c4d44-stage-4a.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T140322Z-c9e01b5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T140413Z-c9e01b5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T140555Z-c9e01b5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T140610Z-c9e01b5-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T141302Z-c9e01b5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T141306Z-c9e01b5-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T141815Z-c9e01b5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T141834Z-2f95680-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T142223Z-191d7fd-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T143828Z-75bb1a3-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261101T145710Z-22f0110-final-repair.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T025440Z-1692456.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T031845Z-9ea5387.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T032825Z-d986403.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T051952Z-80851cf.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T064247Z-0b9071e.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T134717Z-526be27.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261102T153540Z-7b83fea.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261103T041342Z-b729917.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261103T042827Z-1ab1f64.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261103T152359Z-294dcd5.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261104T050814Z-dd9f59b.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261104T060730Z-1f736c6.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261104T065456Z-1662021.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/results/20261107T103605Z-68468cf.json` | JSON | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/review/transcript-final-repair.md` | Markdown | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/review/transcript.md` | Markdown | evals/stage-4a | no | AUTOMATED_REVIEWED | none |
| `evals/stage-4a/run.ts` | TypeScript | evals/stage-4a | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-5/final-audit-repair/results/20261102T071434Z-0b9071e40dea5822ac770c3f66a4ce14e39d3b99.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/stage-5/final-audit-repair/review/human-review-packet.md` | Markdown | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/final-audit-repair/worker.ts` | TypeScript | evals/stage-5 | no | AUTOMATED_REVIEWED | console logging |
| `evals/stage-5/final-closeout/results/20261102T054214Z-80851cf1e4bf67332496c76955ecb390cc79140d.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/stage-5/final-closeout/review/human-review-packet.md` | Markdown | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/remediation/results/20261102T034635Z-d9864031221b3e7df238cb87ea50a29a7c4aaf59.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evals/stage-5/remediation/review/transcript-remediation.md` | Markdown | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261101T154558Z-d219582.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261101T154652Z-d219582.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261101T154723Z-72745db-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261101T155538Z-1b7ab9c-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T025324Z-1692456.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T025459Z-1692456-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T030437Z-1692456.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T030511Z-9ea5387-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T031755Z-9ea5387.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T032728Z-d986403.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T032842Z-d986403-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T051855Z-80851cf.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T052010Z-80851cf-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T064146Z-0b9071e.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T064306Z-0b9071e-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T134618Z-526be27.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T134735Z-526be27-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T153443Z-7b83fea.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261102T153557Z-7b83fea-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T041235Z-b729917.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T041410Z-b729917-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T042723Z-1ab1f64.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T042909Z-1ab1f64-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T152255Z-294dcd5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261103T152425Z-294dcd5-stage-5.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261104T050753Z-dd9f59b.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261104T060704Z-1f736c6.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261104T065441Z-1662021.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/results/20261107T103611Z-68468cf.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/review/transcript-live.md` | Markdown | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evals/stage-5/run.ts` | TypeScript | evals/stage-5 | no | AUTOMATED_REVIEWED | credential identifier |
| `evals/stage-5/scenarios-v1.json` | JSON | evals/stage-5 | no | AUTOMATED_REVIEWED | none |
| `evaluation/baselines/m1-substring-v1.json` | JSON | evaluation/baselines | no | AUTOMATED_REVIEWED | none |
| `evaluation/candidates/scope-aware-token-v1.json` | JSON | evaluation/candidates | no | AUTOMATED_REVIEWED | credential identifier |
| `evaluation/fixtures/cognitive-alpha-adversarial-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/fixtures/cognitive-turn-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/fixtures/feeling-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/fixtures/intent-decision-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/fixtures/reminder-policy-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/fixtures/retrieval-v1.json` | JSON | evaluation/fixtures | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/cognitive-alpha-adversarial-report.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/cognitive-phase2-benchmark.2026-10-28T07-52-21-021Z-8f3d5f.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-phase2-benchmark.2026-10-28T07-54-10-616Z-00c5c8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-slice1-benchmark-v2.2026-10-28T05-12-37-869Z-4087d8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-slice1-benchmark-v2.2026-10-28T05-14-03-522Z-3c33c9.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-slice1-benchmark.2026-10-28T04-24-55-825Z-7ebcc8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-slice2-2-benchmark.2026-10-28T05-56-55-013Z-fb9505.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-slice2-benchmark.2026-10-28T05-30-09-546Z-e91a3c.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/cognitive-turn-synthetic-example.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/feeling-synthetic-example.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/intent-decision-synthetic-example.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/m3-synthetic-example.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier |
| `evaluation/reports/m4-synthetic-example.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase21-qwen05b-v1-r1.2026-10-28T09-28-31-062Z-7aa06f.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase21-qwen05b-v1-r2.2026-10-28T09-30-06-617Z-e402b8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase21-qwen05b-v1-r3.2026-10-28T09-31-44-817Z-0e6158.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase21-qwen05b-v2-r1.2026-10-28T09-29-21-556Z-7494d2.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase21-qwen05b-v2-r2.2026-10-28T09-30-52-546Z-cf0f5f.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase21-qwen05b-v2-r3.2026-10-28T09-32-33-865Z-6f1dec.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase211-qwen05b-v1-r2.2026-10-28T10-21-42-817Z-5ee161.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase211-qwen05b-v1.2026-10-28T10-19-39-017Z-3485b4.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase211-qwen05b-v2-r2.2026-10-28T10-22-23-393Z-f15309.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase211-qwen05b-v2.2026-10-28T10-20-23-981Z-80cbf9.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase22-A-2026-10-28T11-16-58-330Z-9bc71c.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase22-B-2026-10-28T11-17-23-698Z-1b2912.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase22-C-2026-10-28T11-17-46-628Z-e76f24.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase22-D-2026-10-28T11-18-03-940Z-801583.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase22-human-review.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-A-2026-10-28T11-47-51-887Z-722a65.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase23-human-review.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-provider-probe.2026-10-28T11-43-17-071Z-7e7796.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase23-provider-probe.2026-10-28T11-45-02-811Z-c75ec8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase23-provider-probe.2026-10-28T11-47-48-130Z-148ff8.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase23-provider-probe.2026-10-28T11-55-48-252Z-c95f13.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase23-provider-probe.2026-10-28T11-58-08-204Z-613be2.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | network surface |
| `evaluation/reports/phase23-rescored-A.2026-10-28T12-39-40-736Z-c59f71.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-rescored-B.2026-10-28T12-39-41-671Z-761ebd.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-rescored-C.2026-10-28T12-39-42-674Z-c1f5a2.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-rescored-D.2026-10-28T12-39-43-766Z-b96ff2.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `evaluation/reports/phase23-spark-A-2026-10-28T12-04-46-957Z-622333.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase23-spark-B-2026-10-28T12-08-59-304Z-422b26.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase23-spark-C-2026-10-28T12-13-00-863Z-14bc66.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase23-spark-D-2026-10-28T12-18-00-927Z-fbe647.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `evaluation/reports/phase23-verification.json` | JSON | evaluation/reports | no | AUTOMATED_REVIEWED | none |
| `package-lock.json` | JSON | (root) | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `package.json` | JSON | (root) | no | AUTOMATED_REVIEWED | none |
| `scripts/b1-calibrate.ts` | TypeScript | scripts/b1-calibrate.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface |
| `scripts/ci/guard-policy.ts` | TypeScript | scripts/ci | yes | AUTOMATED_REVIEWED | none |
| `scripts/ci/run-self-hosted-ci.ps1` | PowerShell | scripts/ci | yes | AUTOMATED_REVIEWED | none |
| `scripts/ci/self-hosted-ci-helpers.ps1` | PowerShell | scripts/ci | yes | AUTOMATED_REVIEWED | credential identifier |
| `scripts/ci/setup-self-hosted-runner.ps1` | PowerShell | scripts/ci | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `scripts/ci/test-self-hosted-install-isolation.ps1` | PowerShell | scripts/ci | yes | AUTOMATED_REVIEWED | credential identifier |
| `scripts/cognitive-evidence-experiment.ts` | TypeScript | scripts/cognitive-evidence-experiment.ts | yes | AUTOMATED_REVIEWED | console logging; credential identifier |
| `scripts/cognitive-phase2-benchmark.ts` | TypeScript | scripts/cognitive-phase2-benchmark.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier; network surface |
| `scripts/cognitive-slice1-benchmark.ts` | TypeScript | scripts/cognitive-slice1-benchmark.ts | yes | AUTOMATED_REVIEWED | console logging; credential identifier |
| `scripts/desktop/window-visibility-check.ps1` | PowerShell | scripts/desktop | yes | AUTOMATED_REVIEWED | none |
| `scripts/ensure-electron.mjs` | JavaScript | scripts/ensure-electron.mjs | yes | AUTOMATED_REVIEWED | console logging; process execution surface |
| `scripts/final-closeout.ts` | TypeScript | scripts/final-closeout.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface; network surface |
| `scripts/fix-imports-v2.mjs` | JavaScript | scripts/fix-imports-v2.mjs | yes | AUTOMATED_REVIEWED | console logging; credential identifier |
| `scripts/phase24-real-model.ts` | TypeScript | scripts/phase24-real-model.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier; network surface |
| `scripts/product-path-smoke.mjs` | JavaScript | scripts/product-path-smoke.mjs | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `scripts/provider-probe.ts` | TypeScript | scripts/provider-probe.ts | yes | AUTOMATED_REVIEWED | console logging; credential identifier; network surface |
| `scripts/reflection-positive.ts` | TypeScript | scripts/reflection-positive.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier |
| `scripts/rescore-evidence.ts` | TypeScript | scripts/rescore-evidence.ts | yes | AUTOMATED_REVIEWED | console logging |
| `scripts/restructure-v2.mjs` | JavaScript | scripts/restructure-v2.mjs | yes | AUTOMATED_REVIEWED | console logging; credential identifier |
| `scripts/run-cognitive-core-evaluation.mjs` | JavaScript | scripts/run-cognitive-core-evaluation.mjs | yes | AUTOMATED_REVIEWED | none |
| `scripts/run-evaluation.mjs` | JavaScript | scripts/run-evaluation.mjs | yes | AUTOMATED_REVIEWED | process execution surface |
| `scripts/seed-alpha-smoke.ts` | TypeScript | scripts/seed-alpha-smoke.ts | yes | AUTOMATED_REVIEWED | console logging; process execution surface |
| `scripts/smoke.mjs` | JavaScript | scripts/smoke.mjs | yes | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier; network surface |
| `scripts/ui-preview.mjs` | JavaScript | scripts/ui-preview.mjs | yes | AUTOMATED_REVIEWED | console logging; process execution surface; credential identifier; network surface |
| `scripts/verify-alpha-smoke-profile.mjs` | JavaScript | scripts/verify-alpha-smoke-profile.mjs | yes | AUTOMATED_REVIEWED | console logging |
| `scripts/verify-phase23-report.ts` | TypeScript | scripts/verify-phase23-report.ts | yes | AUTOMATED_REVIEWED | console logging |
| `scripts/verify/manifest.json` | JSON | scripts/verify | yes | AUTOMATED_REVIEWED | none |
| `scripts/verify/run-tier.mjs` | JavaScript | scripts/verify | yes | AUTOMATED_REVIEWED | console logging; process execution surface |
| `scripts/windows-alpha-install-acceptance.ps1` | PowerShell | scripts/windows-alpha-install-acceptance.ps1 | yes | AUTOMATED_REVIEWED | none |
| `src/affective-state/cognitive-feeling-engine.test.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | none |
| `src/affective-state/cognitive-feeling-engine.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | none |
| `src/affective-state/cognitive-feeling-service.test.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/affective-state/cognitive-feeling-service.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | none |
| `src/affective-state/distress-evidence.test.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | none |
| `src/affective-state/expression-policy.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/affective-state/feeling.ts` | TypeScript | src/affective-state | yes | AUTOMATED_REVIEWED | none |
| `src/app/acceptance-data-path.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/b1-strategy-payload.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/b4-recovery.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/b5-reflection-safety.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/backup-ipc.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/cognitive-continuity-phase24.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/cognitive-continuity.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/cognitive-loop.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/cognitive-outbox.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/cognitive-outbox.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/cognitive-phase2.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/companion-service.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/companion-service.ts` | TypeScript | src/app | yes | MANUAL_REVIEWED | console logging; credential identifier; network surface |
| `src/app/conflict-handling.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/effect-ledger.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/identity-contract.test.ts` | TypeScript | src/app | yes | MANUAL_REVIEWED | none |
| `src/app/index.ts` | TypeScript | src/app | yes | MANUAL_REVIEWED | console logging; credential identifier |
| `src/app/interest-payload-invalidation.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/ipc.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/ipc.ts` | TypeScript | src/app | yes | MANUAL_REVIEWED | none |
| `src/app/local-provider.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/provider-continuity.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/provider-manual-chat.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/provider-multi-source-ipc.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/provider-multi-source.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/app/register-ipc.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/retrieval-query.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage3-remediation.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage4-goal-candidate-e2e.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage4-outbox-reflection.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/app/stage4-reflection-producer.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage4-restart-consistency.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage4-startup-composition.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/app/stage4a-continuity.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | network surface |
| `src/app/stage5-final-audit-repair.multiprocess.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/app/stage5-final-closeout.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage5-presence.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/stage5-remediation.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/startup-composition.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/startup-error.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/startup-error.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/turn-context-fidelity.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/turn-reliability.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/turn-state-sequence.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/turn-trace.integration.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/app/window-bounds.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/window-bounds.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/window-lifecycle.test.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/app/window-lifecycle.ts` | TypeScript | src/app | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/answer-evidence-evaluation.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/cognition/answer-evidence-evaluation.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/cognition/answer-fact-guard.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/answer-fact-guard.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/cognition.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/cognitive-settings.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/cognitive-turn-analyzer.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/cognitive-turn-analyzer.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/context-utility.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/context-utility.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/context-window.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/cognition/context-window.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/cognition/intent-confidence.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/intent-confidence.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/intent-decision.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/intent-decision.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/intent-reading.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/intent-reading.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/cognition/pending-items.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/cognition/pending-items.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/reflection-routing.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/cognition/reflection-routing.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/retrieval-attention.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/retrieval-attention.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/speech-act.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-context.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-context.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-evaluation.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-evaluation.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-state-machine.test.ts` | TypeScript | src/cognition | yes | AUTOMATED_REVIEWED | none |
| `src/cognition/turn-state-machine.ts` | TypeScript | src/cognition | yes | MANUAL_REVIEWED | none |
| `src/conversation/conversation-service.ts` | TypeScript | src/conversation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/cli.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | console logging; credential identifier |
| `src/evaluation/code-provenance.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/code-provenance.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/evaluation/cognitive-alpha-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/cognitive-alpha-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/cognitive-core-cli.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | console logging |
| `src/evaluation/cognitive-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/cognitive-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/evidence-scenarios.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/feeling-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/feeling-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/git-metadata.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/git-metadata.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/evaluation/intent-decision-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/intent-decision-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/m2-safety.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/offline-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `src/evaluation/offline-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/evaluation/phase23-report-check.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/phase23-report-check.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/evaluation/reminder-policy-evaluation.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/reminder-policy-evaluation.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/report-integrity.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/report-integrity.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/request-ledger.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/request-ledger.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/evaluation/slice2-retrieval.test.ts` | TypeScript | src/evaluation | yes | AUTOMATED_REVIEWED | none |
| `src/memory/fact-index-faults.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/fact-memory.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/fact-memory.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/fact-slot.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/fact-slot.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/memory/memory-context-assembler.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-context-assembler.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/memory/memory-domain.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-domain.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-evidence-policy.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-evidence.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-extensions.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-importance-ranking.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-importance.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-importance.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-maintenance.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-maintenance.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/memory/memory-operation-planner.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/memory/memory-service.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/memory/memory-service.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/memory/memory-timeline.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/memory-timeline.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/retrieval-policy.test.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/memory/retrieval-policy.ts` | TypeScript | src/memory | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/companion-goal.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/companion-goal.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/motivation/goal-evidence.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/goal-evidence.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/goal-lifecycle.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/goal-service.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/motivation/goal-service.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/goal-store.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/goal-time.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/motivation/goals.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminder-notification.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminder-policy.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminder-service.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminder-service.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminder-store.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminders.test.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/motivation/reminders.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/motivation/tool-registry.ts` | TypeScript | src/motivation | yes | AUTOMATED_REVIEWED | none |
| `src/observability/logger.test.ts` | TypeScript | src/observability | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/observability/logger.ts` | TypeScript | src/observability | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/persistence/backup-service.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/persistence/backup-service.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/persistence/cognitive-context-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/conversation-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/database.ts` | TypeScript | src/persistence | yes | MANUAL_REVIEWED | process execution surface |
| `src/persistence/deletion-journal.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/deletion-journal.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/derived-deletion-boundary.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/event-log.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/event-log.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/goal-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/intent-reading-pending-closure.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/intent-reading-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/memory-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/migrations.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `src/persistence/migrations.ts` | TypeScript | src/persistence | yes | MANUAL_REVIEWED | process execution surface; network surface |
| `src/persistence/pending-schema-gate.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/persistence.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/persistence/reminder-repository.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/reminder-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/turn-state-repository.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/persistence/turn-trace-repository.test.ts` | TypeScript | src/persistence | yes | AUTOMATED_REVIEWED | none |
| `src/personalization/interaction-profile.test.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | none |
| `src/personalization/interaction-profile.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | none |
| `src/personalization/personality-growth.test.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | none |
| `src/personalization/personality-growth.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/personalization/personalization-service.test.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/personalization/personalization-service.ts` | TypeScript | src/personalization | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/preload/index.ts` | TypeScript | src/preload | yes | MANUAL_REVIEWED | none |
| `src/providers/bounded-body.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | none |
| `src/providers/bounded-body.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | none |
| `src/providers/consent-presentation.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/consent-presentation.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | none |
| `src/providers/endpoint-resolver.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/endpoint-resolver.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | network surface |
| `src/providers/endpoint-security.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/endpoint-security.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | none |
| `src/providers/openai-compatible.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/openai-compatible.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/provider-policy.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/providers/provider-policy.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | none |
| `src/providers/provider-registry.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | network surface |
| `src/providers/provider-registry.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/providers/provider-retry.test.ts` | TypeScript | src/providers | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/relationship/relationship-threads.test.ts` | TypeScript | src/relationship | yes | AUTOMATED_REVIEWED | none |
| `src/relationship/relationship-threads.ts` | TypeScript | src/relationship | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/renderer/index.html` | HTML | src/renderer | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/renderer/src/backup-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/renderer/src/companion-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/renderer/src/companion.css` | CSS | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/goal-candidates-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/goals-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/main.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/pending-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/presence-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | HTML injection surface |
| `src/renderer/src/provider-profiles-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/renderer/src/provider-readiness.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/renderer/src/reminders-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/self-model-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | HTML injection surface |
| `src/renderer/src/shell-ui.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/style.css` | CSS | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/renderer/src/visual-effects.ts` | TypeScript | src/renderer | yes | AUTOMATED_REVIEWED | none |
| `src/security/provider-secret-errors.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/request-guard.test.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/request-guard.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/secret-store-error.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/secrets-storage.test.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/secrets.test.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/secrets.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/security/security.test.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | network surface |
| `src/security/security.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | none |
| `src/security/url-gate.ts` | TypeScript | src/security | yes | AUTOMATED_REVIEWED | process execution surface |
| `src/self-model/exploration-policy.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/exploration-policy.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `src/self-model/interest-evidence.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/interest-invalidation.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/interest-service.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/knowledge-gap-service.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/morrow-attribution.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/reflection-concern.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/reflection-concern.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/reflection-mapping.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/reflection-mapping.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/reflection-service.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/self-fact-statement.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/self-fact-statement.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/self-model-domain.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/self-model/self-model-service.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/self-model.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/topic-identity.test.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | none |
| `src/self-model/topic-identity.ts` | TypeScript | src/self-model | yes | AUTOMATED_REVIEWED | credential identifier |
| `src/shared/companion.ts` | TypeScript | src/shared | yes | AUTOMATED_REVIEWED | credential identifier; network surface |
| `src/shared/contracts.ts` | TypeScript | src/shared | yes | MANUAL_REVIEWED | credential identifier |
| `src/shared/errors.ts` | TypeScript | src/shared | yes | AUTOMATED_REVIEWED | none |
| `src/shared/validation.test.ts` | TypeScript | src/shared | yes | AUTOMATED_REVIEWED | none |
| `src/shared/validation.ts` | TypeScript | src/shared | yes | AUTOMATED_REVIEWED | process execution surface; credential identifier; network surface |
| `tests/acceptance-data-path.test.ts` | TypeScript | tests/acceptance-data-path.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/acceptance/scenarios.test.ts` | TypeScript | tests/acceptance | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `tests/b4-child-crash.test.ts` | TypeScript | tests/b4-child-crash.test.ts | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `tests/c1-mainchain.test.ts` | TypeScript | tests/c1-mainchain.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/ci-guard-policy.test.ts` | TypeScript | tests/ci-guard-policy.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/correction-round.test.ts` | TypeScript | tests/correction-round.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/design-tokens.test.ts` | TypeScript | tests/design-tokens.test.ts | no | AUTOMATED_REVIEWED | process execution surface; credential identifier |
| `tests/eval-assertions.test.ts` | TypeScript | tests/eval-assertions.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/goal-candidates-ui.test.ts` | TypeScript | tests/goal-candidates-ui.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/helpers/b4-crash-child.ts` | TypeScript | tests/helpers | no | AUTOMATED_REVIEWED | credential identifier |
| `tests/helpers/companion-stack.ts` | TypeScript | tests/helpers | no | AUTOMATED_REVIEWED | credential identifier |
| `tests/pending-ui.test.ts` | TypeScript | tests/pending-ui.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/provider-profiles-ui.test.ts` | TypeScript | tests/provider-profiles-ui.test.ts | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `tests/provider-readiness.test.ts` | TypeScript | tests/provider-readiness.test.ts | no | AUTOMATED_REVIEWED | credential identifier; network surface |
| `tests/shell-ui.test.ts` | TypeScript | tests/shell-ui.test.ts | no | AUTOMATED_REVIEWED | process execution surface |
| `tests/ui-control-contract.test.ts` | TypeScript | tests/ui-control-contract.test.ts | no | AUTOMATED_REVIEWED | none |
| `tests/verify-manifest.test.ts` | TypeScript | tests/verify-manifest.test.ts | no | AUTOMATED_REVIEWED | none |
| `tsconfig.json` | JSON | (root) | no | AUTOMATED_REVIEWED | none |
| `vitest.config.ts` | TypeScript | (root) | no | AUTOMATED_REVIEWED | none |
