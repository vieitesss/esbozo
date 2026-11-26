/**
 * Help text for the `ez` command line: top-level overview and per-command usage.
 *
 * Plain text first. Section headings are bolded only when writing to a TTY and
 * `NO_COLOR` is unset; piped output and stderr stay plain text.
 */

const PLACE_LIST =
  'top, bottom, left, right, center, top-left, top-right, bottom-left, bottom-right';

export const USAGE_LINE = {
  render: 'usage: ez render <scene> [--font <file>]',
  check: 'usage: ez check <scene> [--font <file>] [--css <stylesheet>]',
  anchor: [
    'usage: ez anchor <scene> <element> <start|end> <place>',
    '       ez anchor <scene> --all',
    `  place: ${PLACE_LIST}, a pair of fractions "fx,fy", or none`,
  ].join('\n'),
  snap: 'usage: ez snap <scene> <element> <start|end> <target|off>',
  png:
    'usage: ez png <scene> --theme light|dark [--css <stylesheet>]' +
    ' [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]',
  serve: 'usage: ez serve <dir> [--host 127.0.0.1] [--port N] [--read-only]',
  bundle: 'usage: ez bundle <dir>',
  skill: 'usage: ez skill [install [--dir <path>]]',
} as const;

const CSS_SUBSET_LINES = [
  '  `:root` and `html` declarations are the light theme; dark is those values',
  '  overridden by `@media (prefers-color-scheme: dark)` blocks and by `:root.dark`,',
  '  `:root[data-theme="dark"]`, `html.dark` and `html[data-theme="dark"]`. Other',
  '  selectors and every other grouping at-rule are ignored. Values may use `var()`',
  '  and `color-mix(in srgb, A p%, B)` with hex, rgb()/rgba() or CSS colour names.',
  '  Palette colours must be opaque.',
];

const EXIT_CODE_ROWS: readonly (readonly [string, string])[] = [
  ['0', 'the Scene is clean, was rendered, the PNG or the bundle was written, or the server stopped'],
  ['2', 'wrong arguments (unknown command, missing or extra arguments, bad flag)'],
  ['3', 'the Scene could not be read or parsed'],
  ['4', 'the output could not be written, the server could not start, or the editor is not built'],
  ['5', 'missing theme values, or a missing or unreadable font'],
  ['6', 'a Label that does not fit its Element (see `ez check`)'],
];

const COMMAND_GROUPS: readonly {
  readonly heading: string;
  readonly rows: readonly (readonly [string, string])[];
}[] = [
  {
    heading: 'MAKE',
    rows: [
      ['render', 'Write <name>.svg beside the Scene and print its path'],
      ['png', 'Write <name>.<theme>.png beside the Scene and print its path'],
      ['bundle', 'Write the embeddable editor module <dir>/esbozo-<version>.js'],
    ],
  },
  {
    heading: 'CHECK',
    rows: [
      ['check', 'Validate a Scene and check that every Label fits its Element'],
      ['anchor', "Place or freeze a Snapped end's Anchor on its target's outline"],
      ['snap', 'Attach an arrow or line end to an Element, or turn Snap off'],
    ],
  },
  {
    heading: 'EDIT',
    rows: [['serve', 'Serve the browser editor and save API on a folder of Scenes']],
  },
  {
    heading: 'AGENTS',
    rows: [['skill', 'Print the esbozo agent skill, or install it (`ez skill install`)']],
  },
];

const EXAMPLES = [
  '  ez check diagram.esbozo',
  '  ez png diagram.esbozo --theme light',
  '  ez render diagram.esbozo',
  '  ez serve ./diagrams',
];

function heading(text: string, bold: boolean): string {
  return bold ? `\x1b[1m${text}\x1b[0m` : text;
}

function alignedRows(rows: readonly (readonly [string, string])[], minWidth: number): string[] {
  const width = Math.max(minWidth, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}

export function shouldBold(stream: { isTTY?: boolean }): boolean {
  return Boolean(stream.isTTY) && process.env.NO_COLOR === undefined;
}

export function topLevelHelp(bold: boolean): string {
  const commandWidth = Math.max(
    ...COMMAND_GROUPS.flatMap((group) => group.rows.map(([name]) => name.length)),
  );
  const sections: string[] = [
    'ez — hand-drawn diagrams as JSON Scenes',
    [heading('USAGE', bold), '  ez <command> [arguments]', '  ez <command> --help'].join('\n'),
    ...COMMAND_GROUPS.map((group) =>
      [heading(group.heading, bold), ...alignedRows(group.rows, commandWidth)].join('\n'),
    ),
    [heading('CSS SUBSET', bold), ...CSS_SUBSET_LINES].join('\n'),
    [heading('EXIT CODES', bold), ...alignedRows(EXIT_CODE_ROWS, 1)].join('\n'),
    [heading('EXAMPLES', bold), ...EXAMPLES].join('\n'),
  ];
  return `${sections.join('\n\n')}\n`;
}
