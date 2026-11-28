/**
 * The files a Release is: one static `ez` per target, gzipped, and the
 * `SHA256SUMS` `scripts/install.sh` checks them against.
 *
 * `pnpm build` compiles `dist/ez` for the host alone; a Release ships Linux and
 * macOS, x64 and arm64, all from the `dist/` that build wrote. So this runs
 * after it — the core bundle, the embeds and the version stamp are already
 * there — and cross-compiles `./cmd/ez` the way `scripts/build.mjs` compiles it
 * once: `-ldflags=-s -w`, `CGO_ENABLED=0`, and `GOTOOLCHAIN=local`, so every
 * target is static and the toolchain is `go.mod`'s.
 *
 * An asset's name is `scripts/install.sh`'s: it asks `uname` for the system, and
 * maps `x86_64` and `amd64` to `x64`, `arm64` and `aarch64` to `arm64`, then
 * fetches `ez-<os>-<arch>.gz`. Both spellings live here so a rename shows up as
 * a failing test rather than as every install breaking.
 *
 * Usage: node scripts/release.mjs <outdir> [goos/goarch ...]
 *
 * Naming no target writes all four. Naming one — `linux/arm64` — writes that
 * one, which is the host's asset in the test and how a person checks the target
 * they can run.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const TARGETS = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64'];

/** `scripts/install.sh`'s name for a GOARCH: `uname -m` maps onto these two. */
const INSTALL_ARCH = { amd64: 'x64', arm64: 'arm64' };

const [outdir, ...named] = process.argv.slice(2);
if (outdir === undefined) {
  console.error(`usage: release.mjs <outdir> [${TARGETS.join('|')} ...]`);
  process.exit(2);
}
for (const target of named) {
  if (!TARGETS.includes(target)) {
    console.error(`release: ${target} is not one of ${TARGETS.join(', ')}`);
    process.exit(2);
  }
}
const targets = named.length === 0 ? TARGETS : named;

/**
 * The stamp the assets will carry is `dist/version`, written by `pnpm build`, so
 * a version bumped after that build ships binaries that disagree with
 * `package.json` — and with the tag a Release is cut from.
 */
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const stamp = (await readFile('dist/version', 'utf8')).trim();
if (stamp.split('-main+')[0] !== version) {
  console.error(`release: dist/ is stamped ${stamp}; run pnpm build for version ${version}`);
  process.exit(1);
}

await mkdir(outdir, { recursive: true });

const lines = [];
for (const target of targets) {
  const [goos, goarch] = target.split('/');
  const asset = `ez-${goos}-${INSTALL_ARCH[goarch]}.gz`;
  const binary = join(outdir, `.ez-${goos}-${goarch}`);

  execFileSync('go', ['build', '-ldflags=-s -w', '-o', binary, './cmd/ez'], {
    stdio: 'inherit',
    env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0', GOTOOLCHAIN: 'local' },
  });
  const archive = gzipSync(await readFile(binary));
  await rm(binary);
  await writeFile(join(outdir, asset), archive);

  lines.push({
    asset,
    line: `${createHash('sha256').update(archive).digest('hex')}  ${asset}`,
  });
  console.log(`release: ${asset} (${archive.length} bytes)`);
}

// The shape and order `sha256sum` writes: one line per asset, sorted by name,
// the digest and the name split by the two spaces `scripts/install.sh` reads.
const sums = lines.sort((one, other) => one.asset.localeCompare(other.asset)).map(({ line }) => line);
await writeFile(join(outdir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`release: SHA256SUMS (${sums.length} assets)`);
