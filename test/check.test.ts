/**
 * Seam 1: `ez check` on Scene files in temporary folders.
 *
 * Everything here is external behaviour: the plain-text problems, the exit
 * codes and the files that are (not) written. The order of the checks is part
 * of the contract too — a Scene that does not parse is not measured, because
 * there is nothing reliable to measure — so a broken Scene exits 3 even when
 * its Label would also overflow.
 */
import assert from 'node:assert/strict';
import { copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ez, sceneFolder } from './cli.ts';
import { writeFont } from './fonts.ts';

const KALAM = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));

function oneBox(element: Record<string, unknown>): unknown {
  return {
    version: 1,
    title: 'One Element',
    defaults: { roughness: 0 },
    elements: [{ id: 'a', type: 'rectangle', x: 40, y: 40, width: 160, height: 120, ...element }],
  };
}

const FITS = oneBox({ label: 'A short Label' });

test('a clean Scene exits 0 and prints nothing', async () => {
  const folder = await sceneFolder(FITS);

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, '');
  assert.equal(existsSync(join(folder, 'scene.svg')), false, 'check draws nothing');
});

test('a Label that does not fit exits 6 and says what it needs', async () => {
  const folder = await sceneFolder(oneBox({ height: 40, label: 'orders and invoices for the autumn release' }));

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 6);
  assert.match(run.stderr, /^a: label does not fit: \d+ lines need [\d.]+px, the text box is 20px tall$/m);
  assert.equal(run.stdout, '');
});

test('a Label too wide for its Element is reported with its width', async () => {
  const folder = await sceneFolder(oneBox({ width: 100, label: 'Donaudampfschifffahrtsgesellschaft' }));

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 6);
  assert.match(
    run.stderr,
    /^a: label does not fit: the longest line needs [\d.]+px, the text box is 80px wide$/m,
  );
});

test('a Label too tall and too wide is one problem, not two', async () => {
  const folder = await sceneFolder(
    oneBox({ width: 100, height: 60, label: 'Donaudampfschifffahrtsgesellschaft and more' }),
  );

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 6);
  const lines = run.stderr.trim().split('\n');
  assert.equal(lines.length, 1, run.stderr);
  assert.match(lines[0]!, /^a: label does not fit: .* lines need .*px tall, and the longest line needs/);
});

test('a shape with less room in the middle overflows where a rectangle would not', async () => {
  const label = 'the very middle of a shape';
  const rectangle = await sceneFolder(oneBox({ label }));
  const diamond = await sceneFolder({
    version: 1,
    defaults: { roughness: 0 },
    elements: [{ id: 'gem', type: 'diamond', x: 40, y: 40, width: 160, height: 120, label }],
  });

  const fits = await ez(['check', 'scene.json'], rectangle);
  const overflows = await ez(['check', 'scene.json'], diamond);

  assert.equal(fits.code, 0, fits.stderr);
  assert.equal(overflows.code, 6);
  assert.match(overflows.stderr, /^gem: label does not fit:/m);
});

test('every Element is reported, not just the first', async () => {
  const folder = await sceneFolder({
    version: 1,
    defaults: { roughness: 0 },
    elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 120, height: 40, label: 'one long line of words' },
      { id: 'b', type: 'ellipse', x: 200, y: 0, width: 120, height: 40, label: 'another long line of words' },
    ],
  });

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 6);
  assert.match(run.stderr, /^a: label does not fit:/m);
  assert.match(run.stderr, /^b: label does not fit:/m);
});

test('an arrow Label never overflows: there is no box to overflow', async () => {
  const folder = await sceneFolder({
    version: 1,
    elements: [
      {
        id: 'arrow',
        type: 'arrow',
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
        label: 'a Label far longer than the whole arrow',
      },
    ],
  });

  const run = await ez(['check', 'scene.json'], folder);

  assert.equal(run.code, 0, run.stderr);
});

test('a Scene that does not parse exits 3 before anything is measured', async () => {
  const cases: { label: string; scene: unknown; message: RegExp }[] = [
    {
      label: 'unsupported value',
      scene: oneBox({ tone: 'red', label: 'words' }),
      message: /^a: tone must be one of ink, muted, got "red"$/m,
    },
    {
      label: 'Snap to a missing Element',
      scene: {
        version: 1,
        elements: [
          {
            id: 'arrow',
            type: 'arrow',
            points: [
              { x: 0, y: 0 },
              { x: 40, y: 0, snap: 'nowhere' },
            ],
          },
        ],
      },
      message: /^arrow: snap target "nowhere" does not exist$/m,
    },
    {
      label: 'a broken Label',
      scene: oneBox({ label: '   ' }),
      message: /^a: label must be a non-empty string, got "   "$/m,
    },
  ];

  for (const { label, scene, message } of cases) {
    const folder = await sceneFolder(scene);
    const run = await ez(['check', 'scene.json'], folder);
    assert.equal(run.code, 3, label);
    assert.match(run.stderr, message, label);
  }
});

test('a missing Scene exits 3', async () => {
  const folder = await sceneFolder(FITS);

  const run = await ez(['check', 'nowhere.json'], folder);

  assert.equal(run.code, 3);
  assert.match(run.stderr, /^cannot read Scene nowhere\.json:/m);
});

test('--font is the font the measurement uses', async () => {
  const folder = await sceneFolder(oneBox({ label: 'orders and invoices' }));
  await writeFont(folder, 'wide.ttf');

  const kalam = await ez(['check', 'scene.json'], folder);
  const wide = await ez(['check', 'scene.json', '--font', 'wide.ttf'], folder);

  assert.equal(kalam.code, 0, kalam.stderr);
  assert.equal(wide.code, 6, 'the same Label is too wide in a one-em font');
  assert.match(wide.stderr, /^a: label does not fit: .*the text box is 140px wide$/m);
});

test('--css measures with the stylesheet font, and --font wins over it', async () => {
  const folder = await sceneFolder(oneBox({ label: 'orders and invoices' }));
  await writeFont(folder, 'wide.ttf');
  await copyFile(KALAM, join(folder, 'kalam.ttf'));
  await writeFile(
    join(folder, 'theme.css'),
    [
      ':root { --font-hand: "Wide", cursive; }',
      '@font-face { font-family: "Wide"; src: url("wide.ttf"); }',
      '',
    ].join('\n'),
    'utf8',
  );

  const plain = await ez(['check', 'scene.json'], folder);
  const styled = await ez(['check', 'scene.json', '--css', 'theme.css'], folder);
  const overridden = await ez(
    ['check', 'scene.json', '--css', 'theme.css', '--font', 'kalam.ttf'],
    folder,
  );

  assert.equal(plain.code, 0, 'Kalam fits these words');
  assert.equal(styled.code, 6, 'the stylesheet font is the font that measures');
  assert.match(styled.stderr, /^a: label does not fit: .*the text box is 140px wide$/m);
  assert.equal(overridden.code, 0, '--font beats the stylesheet');
});

test('a stylesheet that cannot be read exits 5', async () => {
  const folder = await sceneFolder(FITS);

  const run = await ez(['check', 'scene.json', '--css', 'nowhere.css'], folder);

  assert.equal(run.code, 5);
  assert.match(run.stderr, /^cannot read stylesheet nowhere\.css:/m);
});

test('a font that cannot be read exits 5', async () => {
  const folder = await sceneFolder(FITS);
  await writeFile(join(folder, 'not-a-font.ttf'), 'hello, not a font', 'utf8');

  for (const [args, message] of [
    [['check', 'scene.json', '--font', 'nowhere.ttf'], /^cannot read font nowhere\.ttf:/m],
    [['check', 'scene.json', '--font', 'not-a-font.ttf'], /^not-a-font\.ttf is not a TrueType or OpenType font$/m],
  ] as const) {
    const run = await ez([...args], folder);
    assert.equal(run.code, 5, args.join(' '));
    assert.match(run.stderr, message);
  }
});

test('wrong arguments exit 2 and explain the usage', async () => {
  const folder = await sceneFolder(FITS);

  for (const args of [
    ['check'],
    ['check', 'scene.json', 'scene.json'],
    ['check', 'scene.json', '--theme', 'light'],
    ['check', 'scene.json', '--font'],
    ['check', 'scene.json', '--css'],
    ['check', '--font', 'wide.ttf'],
  ]) {
    const run = await ez(args, folder);
    assert.equal(run.code, 2, `\`ez ${args.join(' ')}\``);
    assert.match(run.stderr, /usage: ez check <scene> \[--font <file>\]/);
    assert.equal(run.stdout, '');
  }
});

test('--help lists check and every exit code', async () => {
  const folder = await sceneFolder(FITS);

  const help = await ez(['--help'], folder);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: ez check <scene> \[--font <file>\] \[--css <stylesheet>\]/);
  for (const code of ['0', '2', '3', '4', '5', '6']) {
    assert.match(help.stdout, new RegExp(`^  ${code}  \\S`, 'm'), `exit code ${code} is documented`);
  }
  assert.match(help.stdout, /a Label that does not fit its Element/);
  assert.equal(help.stderr, '');
});
