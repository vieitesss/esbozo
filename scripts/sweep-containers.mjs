/**
 * The test containers a killed run left behind, removed before the next one
 * starts.
 *
 * `pnpm test:docker` runs `ez serve` in containers, and a run that is killed —
 * SIGKILL, a closed lid — never reaches its teardown, so the containers keep
 * running until someone notices. Two of them outlived a run once. So every
 * container `test/docker.ts` starts carries the labels below: the test mark, and
 * the pid and host of the process that owns it. The next run sweeps only the ones
 * whose owner is gone.
 *
 * Other worktrees run the docker suite on this machine at the same time, so the
 * owner is the whole decision: a container whose pid still answers is left alone,
 * and so is one from another host, whose pids this machine cannot see. A marked
 * container with no pid at all cannot have an owner, so it goes. A pid the system
 * has recycled keeps a leak alive rather than end someone's run.
 *
 * Docker unavailable is a no-op, because the docker suite skips without it too.
 *
 * Usage: `test/docker.ts` runs it before the suite; a person may run it by hand.
 *        Silence means nothing was left over.
 */
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The label that marks a container as this suite's, and the two that name its owner. */
const TEST = 'esbozo-test=1';
const PID = 'esbozo-test-pid';
const HOST = 'esbozo-test-host';

const FORMAT = `{{.ID}}\t{{.Label "${PID}"}}\t{{.Label "${HOST}"}}`;

/** The short name a person reads, as docker prints one. */
const SHORT = 12;

const here = hostname();

const listed = await testContainers();
if (listed !== undefined) {
  const removed = [];
  let failed = 0;
  for (const container of listed.filter((each) => unowned(each, here))) {
    const name = container.id.slice(0, SHORT);
    try {
      await run('docker', ['rm', '--force', container.id]);
      removed.push(name);
    } catch (error) {
      if (alreadyGone(error)) continue;
      process.stderr.write(`could not remove test container ${name}: ${reason(error)}\n`);
      failed += 1;
    }
  }
  if (removed.length > 0) {
    const count = `${removed.length} stale test container${removed.length === 1 ? '' : 's'}`;
    process.stdout.write(`removed ${count}: ${removed.join(' ')}\n`);
  }
  if (failed > 0) process.exitCode = 1;
}

/**
 * The marked containers docker knows about, or `undefined` when there is no
 * docker to ask. A daemon that will not answer is loud, not quiet: silence would
 * read as a clean machine.
 */
async function testContainers() {
  let stdout;
  try {
    ({ stdout } = await run('docker', [
      'ps',
      '--all',
      '--filter',
      `label=${TEST}`,
      '--format',
      FORMAT,
    ]));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    process.stderr.write(`the test container sweep could not list containers: ${reason(error)}\n`);
    process.exit(1);
  }

  const containers = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const [id, pid, host] = line.split('\t');
    if (id === undefined) continue;
    containers.push({ id, pid: owner(pid), host: host ?? '' });
  }
  return containers;
}

/** A label's pid, or `undefined` when it does not name one. */
function owner(pid) {
  const written = (pid ?? '').trim();
  return /^[1-9]\d*$/.test(written) ? Number(written) : undefined;
}

/**
 * Whether this container's owner is gone. Another host's pids mean nothing here,
 * so such a container is kept: only its own machine can say it is dead.
 */
function unowned(container, host) {
  if (container.host !== host) return false;
  if (container.pid === undefined) return true;
  return !answers(container.pid);
}

/** Whether a process still answers for its pid. */
function answers(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A process this user may not signal is still alive; only a missing one is gone.
    return error.code !== 'ESRCH';
  }
}

/** Whether a removal lost a race with a sweep in another worktree, which is no failure. */
function alreadyGone(error) {
  return /No such (?:container|object)/i.test(reason(error));
}

/** The one line of an error a person can act on. */
function reason(error) {
  const failure = error ?? {};
  const said = `${failure.stderr ?? ''}${failure.message ?? ''}`.trim();
  return said.split('\n')[0] || 'docker said nothing';
}
