# esbozo

- **Vocabulary:** read `GLOSSARY.md` before naming symbols, UI copy, or docs.
- **Standards & seams:** read `CODING_STANDARDS.md` before writing code, tests, or reviewing.
- **Browser tests:** read `tests/README.md` before editing `tests/` or `.e2e/`.
- **Browser portability:** `src/{scene,renderer,layout,geometry,paths,sha256}.ts` and `src/editor/**` target browsers (`tsconfig.browser.json`); keep them free of `node:*` imports.
- **One commit per green step:** never squash, `fixup` or `--squash` on rebase; the branch keeps every commit it earned. `.githooks/post-rewrite` fails loudly when a rebase folds several commits into one — enable the hooks once per clone with `git config core.hooksPath .githooks` (the pre-commit sits beside it). `pnpm check:steps <base>` runs `typecheck`, `lint`, `knip` and `check-rules` on every commit in `<base>..HEAD`, so the green step each commit claims is one a machine just proved; it already covers HEAD, so run it alone. `pnpm check:static` runs the same four on the working tree, with a one-line summary last.
- **pnpm v11:** allow build scripts in `pnpm-workspace.yaml` (`allowBuilds`), rather than `package.json`.
