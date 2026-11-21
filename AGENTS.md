# esbozo

- **Vocabulary:** read `GLOSSARY.md` before naming symbols, UI copy, or docs.
- **Standards & seams:** read `CODING_STANDARDS.md` before writing code, tests, or reviewing.
- **Browser tests:** read `tests/README.md` before editing `tests/` or `.e2e/`.
- **Editor chrome:** inspect `git show proto/editor-ui-d:prototypes/editor-ui/variant-d.html` before changing editor UI.
- **Browser portability:** `src/{scene,renderer,layout,geometry,paths,sha256}.ts` and `src/editor/**` target browsers (`tsconfig.browser.json`); keep them free of `node:*` imports.
- **pnpm v11:** allow build scripts in `pnpm-workspace.yaml` (`allowBuilds`), rather than `package.json`.
