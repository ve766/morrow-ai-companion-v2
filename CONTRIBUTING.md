# Contributing to Morrow AI Companion V2

Thank you for your interest in contributing.

## Before you start

- Read the project [README](README.md), [security policy](SECURITY.md), and relevant architecture and testing documentation under `docs/`.
- For substantial changes, open an issue first to discuss the problem and proposed approach.
- Keep changes focused, preserve existing privacy and security boundaries, and include tests for behavior changes.
- Do not submit API keys, credentials, personal data, real user databases, build artifacts, or model weights unless their redistribution rights are clear.

## Development setup

Requirements: Node.js 22.13 or newer and npm 10 or newer.

```bash
npm install
npm run dev
```

## Validation

Run the checks relevant to your change. The repository currently defines:

```bash
npm run typecheck
npm test
npm run evaluate
npm run evaluate:cognition
npm run build
npm run smoke
```

You may also run `npm run verify` to execute the full verification sequence. In your pull request, state exactly which commands you ran and include their actual results. Do not describe checks as passing if they were skipped or blocked.

## Pull requests

- Explain the problem, the implementation, and any user-visible or data-migration impact.
- Link related issues and document security or privacy implications.
- Include or update tests and documentation as appropriate.
- Keep commits free of secrets and unrelated generated files.

By submitting a contribution, you agree that it is provided under the repository's MIT License, subject to applicable law. This does not grant rights to third-party materials included in or referenced by the project; their respective licenses and notices continue to apply.
