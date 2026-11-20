/**
 * The tool rail: the hand-drawn strip on the left with the tools on it.
 *
 * Only Select does anything yet; the rest are shown, disabled, so the rail is
 * complete and #7 only has to turn the tools on. The outline is drawn by
 * Rough.js, twice, so the strip reads as two pencil passes.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';

export interface Tool {
  key: string;
  name: string;
  /** Enabled tools; the rest are shown but inert until #7 and #9. */
  ready: boolean;
}

export const TOOLS: readonly Tool[] = [
  { key: 'V', name: 'Select', ready: true },
  { key: 'R', name: 'Rectangle', ready: false },
  { key: 'E', name: 'Ellipse', ready: false },
  { key: 'D', name: 'Diamond', ready: false },
  { key: 'A', name: 'Arrow', ready: false },
  { key: 'S', name: 'Line', ready: false },
  { key: 'T', name: 'Text', ready: false },
];

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l6 17 2.6-7L21 10z" fill="currentColor" stroke="currentColor" stroke-width="1.1"/>',
  rect: '<rect x="4" y="6.5" width="16" height="11" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  diamond: '<path d="M12 3.5L20.5 12 12 20.5 3.5 12z"/>',
  arrow: '<path d="M4 19L19.5 4.5M19.5 4.5h-5.5M19.5 4.5V10"/>',
  line: '<path d="M4 19L20 5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
};

const ICON_FOR_TOOL: Record<string, string> = {
  V: 'select',
  R: 'rect',
  E: 'ellipse',
  D: 'diamond',
  A: 'arrow',
  S: 'line',
  T: 'text',
};

/** The rail's buttons, each icon drawn twice so it looks pencilled over. */
export function railMarkup(): string {
  return TOOLS.map((tool) => {
    const icon = ICONS[ICON_FOR_TOOL[tool.key]!] ?? '';
    const title = tool.ready ? `${tool.name} — ${tool.key}` : `${tool.name} — coming soon`;
    return (
      `<button type="button" data-tool="${tool.key}" aria-label="${tool.name}" title="${title}"` +
      ` aria-pressed="${tool.key === 'V'}"${tool.ready ? '' : ' disabled'}>` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}<g class="ghost">${icon}</g></svg>` +
      `<span class="k">${tool.key}</span></button>`
    );
  }).join('');
}

/**
 * The pencil outline of the rail, sized to whatever the rail measured. Returned
 * as SVG source because the rail is plain markup plus this one drawn strip.
 */
export function railArt(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return '';
  }
  const generator = new RoughGenerator();
  const d = roundRectPath(4.5, 4.5, width - 9, height - 9, 17);
  const passes = [
    { seed: 7, roughness: 1.8, bowing: 2, width: 1.45, opacity: 1 },
    { seed: 23, roughness: 2.3, bowing: 2.6, width: 0.8, opacity: 0.55 },
  ];
  return passes
    .map((pass) => {
      const paths = generator.toPaths(
        generator.path(d, {
          roughness: pass.roughness,
          bowing: pass.bowing,
          seed: pass.seed,
          stroke: 'currentColor',
          strokeWidth: pass.width,
        }),
      );
      const markup = paths
        .map((path) => `<path d="${path.d}" fill="none" stroke="currentColor" stroke-width="${pass.width}"/>`)
        .join('');
      return `<g opacity="${pass.opacity}">${markup}</g>`;
    })
    .join('');
}

function roundRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return (
    `M ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r}` +
    ` L ${x + width} ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height}` +
    ` L ${x + r} ${y + height} Q ${x} ${y + height} ${x} ${y + height - r}` +
    ` L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}
