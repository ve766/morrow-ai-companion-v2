# Shared Real-Model Test Contract

Status: integration contract (credentials intentionally excluded)
Provider: iFlytek Spark MaaS
Model: `spark-x2.6`

This file defines the shared, non-secret connection contract for trusted Morrow V2 development branches. It does not contain an API key.

## Endpoints

| API surface | Full endpoint |
|---|---|
| OpenAI Chat Completions | `https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions` |
| OpenAI Responses | `https://maas-api.cn-huabei-1.xf-yun.com/v1/responses` |
| Anthropic Messages | `https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages` |

These are complete endpoint URLs, not just base URLs. Do not append another `/v1`, `/v2`, or route suffix.

## Authentication and configuration

Authentication uses:

```http
Authorization: Bearer <MORROW_TEST_API_KEY>
Content-Type: application/json
```

Required environment variables:

- `MORROW_TEST_API_KEY`: secret token. Inject from GitHub Actions Secrets or a local untracked environment file.
- `MORROW_TEST_MODEL=spark-x2.6`
- `MORROW_TEST_CHAT_COMPLETIONS_URL=https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`
- `MORROW_TEST_RESPONSES_URL=https://maas-api.cn-huabei-1.xf-yun.com/v1/responses`
- `MORROW_TEST_ANTHROPIC_MESSAGES_URL=https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages`

Never commit a real key, put it in an Issue/PR comment, print it in logs, include it in test artifacts, or expose it to untrusted fork pull requests.

## Chat Completions smoke request

```bash
curl --fail-with-body --silent --show-error \
  "$MORROW_TEST_CHAT_COMPLETIONS_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MORROW_TEST_API_KEY" \
  --data-binary @- <<'JSON'
{
  "model": "spark-x2.6",
  "messages": [
    {"role": "user", "content": "你好。请用一句话介绍你自己。"}
  ],
  "stream": false
}
JSON
```

## Responses API smoke request

```bash
curl --fail-with-body --silent --show-error \
  "$MORROW_TEST_RESPONSES_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MORROW_TEST_API_KEY" \
  --data-binary @- <<'JSON'
{
  "model": "spark-x2.6",
  "input": "你好。请用一句话介绍你自己。",
  "stream": false
}
JSON
```

## Anthropic Messages API

The endpoint is recorded above, but its exact request schema, version headers, and response mapping must be verified against the provider's current documentation before enabling it in CI. Do not assume that an Anthropic-compatible URL alone proves full Anthropic protocol compatibility.

## GitHub Actions secret setup

In repository Settings → Secrets and variables → Actions, create:

- Secret: `MORROW_TEST_API_KEY` = newly rotated API key.
- Optional variables: `MORROW_TEST_MODEL`, `MORROW_TEST_CHAT_COMPLETIONS_URL`, `MORROW_TEST_RESPONSES_URL`, `MORROW_TEST_ANTHROPIC_MESSAGES_URL`.

The repository connector cannot write Actions Secrets. A repository maintainer must add the secret in GitHub Settings.

Only trusted workflows on trusted branches may receive the secret. Do not expose it to fork-originated pull requests or workflows that execute untrusted pull-request code. Avoid `pull_request_target` patterns that check out and execute untrusted head code with secrets.

## Requirements for the shared test harness

A real-model test is valid only when all of the following are true:

1. It sends an HTTP request to the configured provider endpoint.
2. It uses the configured model and receives a provider response.
3. It records endpoint family, model, timestamp, latency, HTTP status, request/correlation ID when available, and a redacted response summary.
4. It never records the bearer token or full authorization headers.
5. It has explicit timeout, bounded retries, concurrency limits, and a small deterministic test budget.
6. It distinguishes `REAL_PROVIDER_PASS`, `REAL_PROVIDER_FAIL`, and `BLOCKED_NO_SECRET`; a scripted/mock response must never be labelled a real-model pass.
7. It validates response parsing and the actual Morrow provider adapter path, not merely a standalone curl call.
8. It stores sanitized machine-readable results under `evals/real-provider/results/` and documents the exact commit tested.

## Which suite a result file came from

Requirement 6 says a scripted response must never be labelled a real-model pass.
A label alone is not enough: the two kinds of run make different *claims*, and a
label can be misread, re-aggregated, or lost when a file is copied. So every
machine-readable result also carries a structural discriminator.

| `suite` | Provider | What the artefact may be quoted as evidence for |
|---|---|---|
| `mechanism` | a scripted string | that the decision reaches the payload, the prompt and the database |
| `semantic` | a real model | nothing automatic — it is the input to a human review |
| `live` | a real model | the connection contract itself: endpoint, model, latency, parse |

Rules that follow from the table:

- Only `semantic` and `live` artefacts may be cited in any statement about model
  behaviour. A `mechanism` file quoted as intent accuracy is a reporting defect
  even when every assertion in it passed, because the provider was a string.
- A `semantic` run has no pass count. Its normal terminal state is
  `AWAITING_MANUAL_REVIEW`; it reports no accuracy figure, no denominator, and
  lists what it did not measure. Aggregating that state as a success contradicts
  requirement 6 in the same way a scripted pass would.
- Results of different kinds must be distinguishable without opening the JSON:
  the blocked-record and semantic file names carry a `-semantic` / `-live`
  suffix so that a directory listing shows which is which.
- A `BLOCKED_NO_SECRET` record is a result, not a failure and not a crash. It is
  written, it names the suite, and it states in the artefact itself that it is
  not an evaluation result. Absence of a credential is never simulated with a
  scripted provider.
- There is exactly one credential path per harness, and no file fallback. Two
  copies of "read the key" do not fail loudly; they fail as two contradictory
  verdicts on the same commit.

## When there is no commit to name

Requirement 8 asks for the exact commit tested. Where the tree under test carries
no `.git`, the honest value is `unknown`, and it must be written as `unknown`
rather than omitted or guessed. A failed `git` call is not evidence of a clean
tree, so the working-tree field is also `unknown` there, not `clean`.

A result whose commit field is `unknown` may still be used as evidence about
*behaviour observed at that moment*, but it cannot support any claim of the form
"this commit does X", and it must not be counted as a verified build in an
acceptance report. The gap is closed by re-running in a tree that has an identity,
not by filling the field in by hand.

## Branch integration

This contract is initially published on `infra/shared-real-model-test-contract`. It becomes available to every development line only after this branch is merged into the shared integration base (normally `main`) and each feature branch syncs that base. A file committed to one feature branch does not automatically appear on sibling branches.

## Credential incident

A previously pasted credential must be revoked and rotated. Only the replacement belongs in `MORROW_TEST_API_KEY`; never copy the exposed value into repository history.
