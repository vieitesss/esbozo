/**
 * The test containers a killed run left behind, removed before the next one
 * starts.
 *
 * `pnpm test:docker` runs `ez serve` in containers, and a run that is killed —
 * SIGKILL, a closed lid — never reaches its teardown, so the containers keep
 * running until someone notices. Two of them outlived a run once. So every
 * container `test/docker.ts` starts carries the labels below: the test mark, and
 * the owner — the pid, the host, and the identity of the machine, boot and pid
 * namespace that pid was read in. The next run sweeps only the ones whose owner
 * is gone.
 *
 * A pid means one process only inside one boot and one pid namespace, and other
 * worktrees run the docker suite at the same time, on machines that may share a
 * daemon. So a pid answers for a process only when every owner label is there,
 * parses, and is this client's own; anything less is kept — no pid, a label that
 * will not parse, another host, another boot, another pid namespace. A pid the
 * system has recycled keeps a leak alive rather than end someone's run.
 *
 * Docker unavailable is a no-op, because the docker suite skips without it too.
 *
 * Usage: `test/docker.ts` runs it before the suite; a person may run it by hand.
 *        `--identity` prints the identity the suite labels a container with, so
 *        the two compare the same value rather than two guesses at it.
 *        Silence means nothing was left over.
 */
import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The label that marks a container as this suite's, and the three that name its owner. */
const TEST = 'esbozo-test=1';
const PID = 'esbozo-test-pid';
const HOST = 'esbozo-test-host';
const MACHINE = 'esbozo-test-identity';

const FORMAT = `{{.ID}}\t{{.Label "${PID}"}}\t{{.Label "${HOST}"}}\t{{.Label "${MACHINE}"}}`;

/** The short name a person reads, as docker prints one. */
const SHORT = 12;

const here = hostname();

if (process.argv.includes('--identity')) {
  process.stdout.write(`${await machineIdentity()}\n`);
} else {
  const listed = await testContainers();
  if (listed !== undefined) {
    const mine = await machineIdentity();
    const removed = [];
    let failed = 0;
    for (const container of listed.filter((each) => unowned(each, mine))) {
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
}

/**
 * What a pid means on this client: the boot and pid namespace on Linux, the
 * machine and boot time where pids are machine-wide. A container's owner is
 * compared only when its label carries this exact value, so a pid from another
 * boot, or from another pid namespace on this one, is never mistaken for a dead
 * process here. A platform with nothing to pin says so with the empty string,
 * which nothing matches: when unsure, keep.
 */
async function machineIdentity() {
  try {
    if (process.platform === 'linux') {
      const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      return `${boot}/${await readlink('/proc/self/ns/pid')}`;
    }
    if (process.platform === 'darwin' || process.platform.endsWith('bsd')) {
      const { stdout } = await run('sysctl', ['-n', 'kern.boottime']);
      return `${here}/${stdout.trim().replace(/\s+/g, ' ')}`;
    }
  } catch (error) {
    process.stderr.write(
      `the test container sweep could not read this machine's identity: ${reason(error)}\n`,
    );
    process.exit(1);
  }
  return '';
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
    const [id, pid, host, machine] = line.split('\t');
    if (id === undefined) continue;
    containers.push({
      id,
      pid: owner(pid),
      host: (host ?? '').trim(),
      identity: (machine ?? '').trim(),
    });
  }
  return containers;
}

/** A label's pid, or `undefined` when it does not name one. */
function owner(pid) {
  const written = (pid ?? '').trim();
  return /^[1-9]\d*$/.test(written) ? Number(written) : undefined;
}

/**
 * Whether this container's owner is gone. The labels have to prove the owner was
 * a process in this boot, in this pid namespace, on this host, and that nothing
 * answers for its pid now. A container that cannot prove all of that is kept:
 * removing one another worktree is using costs a run, keeping a leftover costs
 * one sweep.
 */
function unowned(container, mine) {
  if (container.pid === undefined) return false;
  if (container.host !== here) return false;
  if (mine === '' || container.identity !== mine) return false;
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
