/**
 * The one seam the CLI tests share: `ez` on Scene files in temporary folders.
 *
 * Both `render.test.ts` and `elements.test.ts` drive the built CLI the same way:
 * write a Scene to a fresh folder, run `ez`, read what it wrote. Keeping the
 * three helpers here means a change to how the CLI is invoked, or to how its
 * exit code is read, cannot make the suites disagree.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The built CLI both suites exercise. */
export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What one `ez` run left behind: its exit code and its two streams. */
export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** A fresh, resolved temporary folder, so a test never sees another test's files. */
export async function tempFolder(prefix = 'esbozo-'): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** A folder holding `scene.json` (or `name`), ready for `ez render`. */
export async function sceneFolder(scene: unknown, name = 'scene.json'): Promise<string> {
  const folder = await tempFolder();
  await writeFile(join(folder, name), JSON.stringify(scene, null, 2), 'utf8');
  return folder;
}

/** `ez` with its exit code read, whether it succeeded or not. */
export async function ez(args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd });
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
 * `cli` is the built CLI to run, so a test can drive a copy of `dist/` that has
 * nothing else from the repository beside it.
 */
export async function startServe(
  folder: string,
  args: readonly string[] = [],
  cli: string = CLI,
): Promise<Serve> {
  const child = spawn(process.execPath, [cli, 'serve', folder, '--port', '0', ...args], {
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
