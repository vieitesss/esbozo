# Development

This guide covers building esbozo from source, running the test suites, and configuring git hooks.

## Prerequisites

Install these tools before building:

- Node `22.22.3` or newer, matching `.node-version` and `engines.node` in `package.json`.
- pnpm `11.24.0`, matching `packageManager` in `package.json`.
- Go `1.25.5`, matching the toolchain version in `go.mod`.
- `just` from `https://github.com/casey/just` if you want to use the `justfile` shortcuts.

## Build from source

Install dependencies and build the editor assets, embedded core, and Go binary:

```sh
pnpm install
pnpm build
```

`pnpm build` writes the static binary to `./dist/ez`. Run `just` to list the `justfile` recipes, including `just setup` and `just build`.

## Checks and tests

Run the main verification commands from the repository root:

- `pnpm check` runs typecheck, lint, knip, custom rules, Go checks, and the Node test suite.
- `pnpm e2e <file>` runs the model-free browser suites in Chromium, `--all` runs them all, and a bare `pnpm e2e` refuses locally ([why](../tests/README.md)).
- `pnpm check:steps <base>` runs the static checks on every commit in `<base>..HEAD`.

## Cutting a Release

A Release is a `vX.Y.Z` tag, and its `X.Y.Z` has to be `package.json`'s version. Bump the version, commit it, and push the tag:

```sh
git commit -am 'chore: version 0.1.0'
git tag v0.1.0
git push origin main v0.1.0
```

`.github/workflows/release.yml` then builds the four assets — `ez-linux-x64.gz`, `ez-linux-arm64.gz`, `ez-darwin-x64.gz`, `ez-darwin-arm64.gz` — and their `SHA256SUMS` with `scripts/release.mjs`, smoke-tests both Linux binaries, and publishes them with the notes GitHub writes. There is no CHANGELOG to keep and no npm package: `ez` ships as that binary alone. The same script is runnable by hand, for all four targets or the one you can run:

```sh
pnpm build
node scripts/release.mjs dist/release
sh scripts/smoke.sh dist/release/ez-linux-x64.gz
```

Every green `check` on `main` republishes the rolling `main` prerelease from the same script and moves its tag to that commit; that build answers `ez --version` as `<version>-main+<sha>`, and it is what `install.sh --main` and `ez update --main` install.

## Git hooks

Enable the repository git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

## Repository guides

Read these files before changing code, tests, or terminology:

- [AGENTS.md](../AGENTS.md) holds workflow rules, browser portability boundaries, and commit discipline.
- [CODING_STANDARDS.md](../CODING_STANDARDS.md) defines module seams, testing rules, and invariants.
- [tests/README.md](../tests/README.md) explains the browser test scripts and visual suites.
- [GLOSSARY.md](../GLOSSARY.md) defines the project vocabulary enforced by `pnpm check-rules`.
- [Architecture](architecture.md) explains how the TypeScript core, editor, and Go binary fit together.

## Licences

The code is under the MIT License in [LICENSE](../LICENSE). The bundled Kalam font is under the SIL Open Font License in [fonts/OFL.txt](../fonts/OFL.txt).
