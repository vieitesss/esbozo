/**
 * The tool rail: the hand-drawn strip on the left with the tools on it.
 *
 * One static list, in rail order, from `tools.ts`, so a button and the key that
 * picks it can never disagree. Each button names its shortcut in its tooltip
 * and in its accessible name, because the left hand is what picks a tool. The
 * outline is drawn by Rough.js, twice, so the strip reads as two pencil passes.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';
import { TOOLS } from './tools.js';

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l6 17 2.6-7L21 10z" fill="currentColor" stroke="currentColor" stroke-width="1.1"/>',
  rect: '<rect x="4" y="6.5" width="16" height="11" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  diamond: '<path d="M12 3.5L20.5 12 12 20.5 3.5 12z"/>',
  arrow: '<path d="M4 19L19.5 4.5M19.5 4.5h-5.5M19.5 4.5V10"/>',
  line: '<path d="M4 19L20 5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
};

/** The rail's buttons, each icon drawn twice so it looks pencilled over. */
export function railMarkup(): string {
  return TOOLS.map((tool) => {
    const icon = ICONS[tool.icon] ?? '';
    const pressed = tool.id === 'select' ? 'true' : 'false';
    return (
      `<button type="button" data-tool="${tool.id}" aria-label="${tool.name}"` +
      ` aria-pressed="${pressed}" title="${tool.name} — ${tool.shortcut}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}<g class="ghost">${icon}</g></svg>` +
      `<span class="key">${tool.shortcut}</span>` +
      `</button>`
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
