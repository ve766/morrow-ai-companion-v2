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

## Branch integration

This contract is initially published on `infra/shared-real-model-test-contract`. It becomes available to every development line only after this branch is merged into the shared integration base (normally `main`) and each feature branch syncs that base. A file committed to one feature branch does not automatically appear on sibling branches.

## Credential incident

A previously pasted credential must be revoked and rotated. Only the replacement belongs in `MORROW_TEST_API_KEY`; never copy the exposed value into repository history.
