# Each argument reaches the command as one word, so one that holds a space stays one.
set positional-arguments

# List the recipes.
default:
    @just --list

# Install the dependencies (run once per clone).
setup:
    pnpm install

# Build the editor page and bundle, and the Go binary `dist/ez`.
build:
    pnpm build

# Typecheck, lint, knip, check-rules and the tests: what CI runs first.
check:
    pnpm check

# Build, then run the node tests; args pass through.
test *args:
    pnpm test "$@"

# Build, then run browser tests, e.g. `just e2e tests/snap.e2e.ts`.
e2e *args:
    pnpm e2e "$@"

# Serve the editor on a folder of Scenes at http://127.0.0.1:4320/, e.g. `just serve diagrams --port 0`.
serve dir="." *args:
    pnpm build && ./dist/ez serve "$@"

# Build and copy the `ez` binary into `dir`.
install dir=(env("HOME") / ".local/bin"):
    pnpm build && install -m 755 dist/ez "{{dir}}/ez"
