/**
 * The one seam the CLI tests share: `ez` on Scene files in temporary folders.
 *
 * The CLI suites drive the built CLI the same way: write a Scene to a fresh
 * folder, run `ez`, read what it wrote. Keeping the helpers here means a change
 * to how the CLI is invoked, or to how its exit code is read, cannot make the
 * suites disagree — and `png` goes through here too, so `EZ_BIN` reaches it.
 */
import { execFile, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tempFolder } from './temp.ts';

const run = promisify(execFile);

/** The `ez` every suite exercises unless `EZ_BIN` names another: the binary `pnpm build` writes. */
export const CLI = fileURLToPath(new URL('../dist/ez', import.meta.url));

/**
 * The `ez` one run starts: `EZ_BIN` when it names one, so a suite can be pointed
 * at another build of the same command line, and the built binary otherwise. A
 * relative `EZ_BIN` is read from the folder this process runs in, not from the
 * folder the run was asked for.
 *
 * `cli` is the `ez` a caller names when it wants a copy of `dist/` that has
 * nothing else from the repository beside it; `EZ_BIN` still wins, because a run
 * pointed at another `ez` is a run of that one.
 */
function ezCommand(args: readonly string[], cli: string = CLI): { file: string; argv: string[] } {
  const bin = process.env.EZ_BIN;
  const file = bin === undefined || bin === '' ? cli : resolve(bin);
  return { file, argv: [...args] };
}

/** One word quoted so a shell reads it back as it is. */
function quoted(word: string): string {
  return `'${word.split("'").join(`'\\''`)}'`;
}

/**
 * A shell script that runs `ez` the way a suite does, for a case that needs the
 * command on a `PATH` instead of started from here: a person's copied-out
 * command, or an example server that shells out to it. `EZ_BIN` reaches it all
 * the same.
 */
export function ezShimScript(): string {
  const { file, argv } = ezCommand([]);
  return `#!/bin/sh\nexec ${[file, ...argv].map(quoted).join(' ')} "$@"\n`;
}

/** What one `ez` run left behind: its exit code and its two streams. */
export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** A fresh, resolved temporary folder, which the runner's teardown removes. */
export { tempFolder };

/** A folder holding `scene.json` (or `name`), ready for `ez render`. */
export async function sceneFolder(scene: unknown, name = 'scene.json'): Promise<string> {
  const folder = await tempFolder();
  await writeFile(join(folder, name), JSON.stringify(scene, null, 2), 'utf8');
  return folder;
}

/**
 * `ez` with its exit code read, whether it succeeded or not. `env` is added to
 * this process's environment for the one run, so a case can set `NO_COLOR` and
 * still reach the agent's `PATH`.
 */
export async function ez(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Run> {
  const { file, argv } = ezCommand(args);
  try {
    const { stdout, stderr } = await run(file, argv, { cwd, env: { ...process.env, ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : -1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

/** A server `ez serve` is running on, and the folder it serves. */
export interface Serve {
  readonly url: string;
  readonly folder: string;
  /** The line `ez serve` printed when it started, as it printed it. */
  readonly startup: string;
  /** The build that line names. */
  readonly build: string;
  /** When that build was made, or `null` when the CLI ran from source. */
  readonly builtAt: string | null;
  stop(): Promise<void>;
}

/**
 * The startup line, read once and anchored at its end: `serving <folder> on
 * <url>/[ (read-only)] (build <id>[, <time>])`. A folder whose own name holds a
 * `(build ...)` is part of the folder, not the end of the line, so it answers
 * nothing.
 */
function readStartup(
  line: string,
): { url: string; build: string; builtAt: string | null } | null {
  const found =
    /^serving .+ on (http:\/\/\S+?)\/(?: \(read-only\))? \(build (\S+?)(?:, (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z))?\)$/.exec(
      line,
    );
  if (found === null) {
    return null;
  }
  return { url: found[1]!.replace(/\/$/, ''), build: found[2]!, builtAt: found[3] ?? null };
}

/**
 * `ez serve` on `folder`, with the port the operating system picks so tests
 * never fight over one. Resolves once the server prints the line it listens on;
 * the folder is the working directory, as it would be for a person.
 *
 * `cli` is the `ez` to run, so a test can drive a copy of `dist/` that has
 * nothing else from the repository beside it; `EZ_BIN` replaces it the way it
 * replaces `ez`'s.
 */
export async function startServe(
  folder: string,
  args: readonly string[] = [],
  cli: string = CLI,
): Promise<Serve> {
  const command = ezCommand(['serve', folder, '--port', '0', ...args], cli);
  const child = spawn(command.file, command.argv, {
    cwd: folder,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => (stdout += chunk));
  child.stderr!.on('data', (chunk: string) => (stderr += chunk));

  const started = await new Promise<Omit<Serve, 'folder' | 'stop'>>((resolve_, reject) => {
    const onData = (): void => {
      // Pipe chunks are not lines. Read the whole line once it has arrived.
      const end = stdout.indexOf('\n');
      if (end === -1) {
        return;
      }
      child.stdout!.off('data', onData);
      const startup = stdout.slice(0, end);
      const read = readStartup(startup);
      if (read === null) {
        child.kill('SIGTERM');
        reject(new Error(`ez serve printed no startup line: ${startup}`));
        return;
      }
      resolve_({ startup, ...read });
    };
    child.stdout!.on('data', onData);
    child.once('exit', (code) => reject(new Error(`ez serve exited ${code}: ${stderr || stdout}`)));
  });

  return {
    ...started,
    folder,
    async stop(): Promise<void> {
      if (child.exitCode !== null) {
        return;
      }
      const ended = new Promise<void>((resolve_) => child.once('exit', () => resolve_()));
      child.kill('SIGTERM');
      await ended;
    },
  };
}
