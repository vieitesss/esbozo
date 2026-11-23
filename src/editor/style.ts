/**
 * The Style menu's controls: which Scene fields it can change, which of them a
 * selection can use, what each shows now, and how a pick changes an Element.
 *
 * The values are the Scene schema's (`../scene.ts`), and they are not repeated
 * here: the choices are built from the arrays and ranges the schema exports, so
 * a value the file would reject cannot be offered. Only the words a person
 * reads live here: `center` is shown as "centre", roughness 0/1/2 as
 * architect/artist/cartoonist, `cross-hatch` as "cross".
 *
 * Each control reads and writes its own field in one place, and both go through
 * the schema's type (`oneOf`, `inRange`), so a pick can never cast a string into
 * a value the Scene does not hold.
 *
 * A control is offered only when every selected Element can use it, because a
 * pick writes the same value into all of them: a Text has no outline to
 * roughen, an arrow has no fill, and an ellipse has no corners to round. Font
 * size is offered to every Element, because every Element draws words (#4 gives
 * them Labels); alignment is offered to every Element too, and a shaft's Label
 * lines up its own lines with it.
 */
import {
  CORNERS,
  FILL_KINDS,
  FONT_SIZES,
  GREY_MAX,
  GREY_MIN,
  HEADS,
  ROUGHNESS_MAX,
  ROUGHNESS_MIN,
  STROKE_STYLES,
  STROKE_WIDTHS,
  TEXT_ALIGNS,
  TONES,
  isOutlined,
} from '../scene.js';
import type { ArrowOrLineElement, Element } from '../scene.js';

/** One style field the menu can change, named after its path in the Scene. */
export type StyleKey =
  | 'roughness'
  | 'stroke.width'
  | 'stroke.style'
  | 'fill.kind'
  | 'fill.grey'
  | 'tone'
  | 'corners'
  | 'heads.start'
  | 'heads.end'
  | 'fontSize'
  | 'textAlign';

/** One button: the value the Scene stores, and the word on the button. */
interface StyleChoice {
  readonly value: string;
  readonly label: string;
}

export interface StyleControl {
  readonly key: StyleKey;
  /** The row's name, and the first half of each button's own name. */
  readonly label: string;
  readonly choices: readonly StyleChoice[];
  /** Draws colour swatches instead of words. */
  readonly swatches?: boolean;
  /** Whether an Element can take this control at all. */
  readonly usable: (element: Element) => boolean;
  /** What an Element's field holds now, as one of `choices`. */
  readonly read: (element: Element) => string;
  /** The Element with this field set, or the Element itself when it cannot take it. */
  readonly write: (element: Element, value: string) => Element;
}

const drawn = (element: Element): boolean => element.type !== 'text';
const rounded = (element: Element): boolean =>
  element.type === 'rectangle' || element.type === 'diamond';
const ended = (element: Element): element is ArrowOrLineElement =>
  element.type === 'arrow' || element.type === 'line';
/** Anything whose drawn path turns: an outline's vertices, or a Shaft's points. */
const cornered = (element: Element): boolean => rounded(element) || ended(element);

/** The three looks roughness names: 0 architect, 1 artist, 2 cartoonist. */
const ROUGHNESS_NAMES: Readonly<Record<string, string>> = {
  '0': 'architect',
  '1': 'artist',
  '2': 'cartoonist',
};

const FILL_NAMES: Readonly<Record<string, string>> = { 'cross-hatch': 'cross' };
const ALIGN_NAMES: Readonly<Record<string, string>> = { center: 'centre' };

/** Schema values, each with the word the button shows for it. */
function choicesOf(
  values: readonly string[],
  labels: Readonly<Record<string, string>> = {},
): StyleChoice[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

/** The whole numbers from `min` to `max`, each with its own name. */
function numbered(min: number, max: number, labels: Readonly<Record<string, string>> = {}): StyleChoice[] {
  const values = Array.from({ length: max - min + 1 }, (_, step) => String(min + step));
  return choicesOf(values, labels);
}

/** The seven-grey ladder, named by its step: `grey 0` is paper, `grey 6` solid ink. */
function greys(): StyleChoice[] {
  return numbered(GREY_MIN, GREY_MAX).map((choice) => ({
    value: choice.value,
    label: `grey ${choice.value}`,
  }));
}

/** `value` when the schema allows it, else the one the Element already has. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  for (const candidate of allowed) {
    if (candidate === value) {
      return candidate;
    }
  }
  return fallback;
}

/** `value` when it is a whole number inside the schema's range, else the one the Element has. */
function inRange(value: string, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

/** Every control, in the order the menu shows them. */
const CONTROLS: readonly StyleControl[] = [
  {
    key: 'roughness',
    label: 'Rough',
    choices: numbered(ROUGHNESS_MIN, ROUGHNESS_MAX, ROUGHNESS_NAMES),
    usable: drawn,
    read: (element) => String(element.roughness),
    write: (element, value) => ({
      ...element,
      roughness: inRange(value, ROUGHNESS_MIN, ROUGHNESS_MAX, element.roughness),
    }),
  },
  {
    key: 'stroke.width',
    label: 'Stroke',
    choices: choicesOf(STROKE_WIDTHS),
    usable: drawn,
    read: (element) => element.stroke.width,
    write: (element, value) => ({
      ...element,
      stroke: { ...element.stroke, width: oneOf(STROKE_WIDTHS, value, element.stroke.width) },
    }),
  },
  {
    key: 'stroke.style',
    label: 'Line',
    choices: choicesOf(STROKE_STYLES),
    usable: drawn,
    read: (element) => element.stroke.style,
    write: (element, value) => ({
      ...element,
      stroke: { ...element.stroke, style: oneOf(STROKE_STYLES, value, element.stroke.style) },
    }),
  },
  {
    key: 'fill.kind',
    label: 'Fill',
    choices: choicesOf(FILL_KINDS, FILL_NAMES),
    usable: isOutlined,
    read: (element) => element.fill.kind,
    write: (element, value) => ({
      ...element,
      fill: { ...element.fill, kind: oneOf(FILL_KINDS, value, element.fill.kind) },
    }),
  },
  {
    key: 'fill.grey',
    label: 'Grey',
    choices: greys(),
    swatches: true,
    usable: isOutlined,
    read: (element) => String(element.fill.grey),
    write: (element, value) => ({
      ...element,
      fill: { ...element.fill, grey: inRange(value, GREY_MIN, GREY_MAX, element.fill.grey) },
    }),
  },
  {
    key: 'tone',
    label: 'Tone',
    choices: choicesOf(TONES),
    usable: () => true,
    read: (element) => element.tone,
    write: (element, value) => ({ ...element, tone: oneOf(TONES, value, element.tone) }),
  },
  {
    key: 'corners',
    label: 'Corners',
    choices: choicesOf(CORNERS),
    usable: cornered,
    read: (element) => element.corners,
    write: (element, value) => ({ ...element, corners: oneOf(CORNERS, value, element.corners) }),
  },
  {
    key: 'heads.start',
    label: 'Head ←',
    choices: choicesOf(HEADS),
    usable: ended,
    read: (element) => (ended(element) ? element.heads.start : ''),
    write: (element, value) =>
      ended(element)
        ? { ...element, heads: { ...element.heads, start: oneOf(HEADS, value, element.heads.start) } }
        : element,
  },
  {
    key: 'heads.end',
    label: 'Head →',
    choices: choicesOf(HEADS),
    usable: ended,
    read: (element) => (ended(element) ? element.heads.end : ''),
    write: (element, value) =>
      ended(element)
        ? { ...element, heads: { ...element.heads, end: oneOf(HEADS, value, element.heads.end) } }
        : element,
  },
  {
    key: 'fontSize',
    label: 'Size',
    choices: choicesOf(FONT_SIZES),
    usable: () => true,
    read: (element) => element.fontSize,
    write: (element, value) => ({
      ...element,
      fontSize: oneOf(FONT_SIZES, value, element.fontSize),
    }),
  },
  {
    key: 'textAlign',
    label: 'Align',
    choices: choicesOf(TEXT_ALIGNS, ALIGN_NAMES),
    // Every Element's words take an alignment: a Label lines up inside the box
    // or the block that holds it, and a Text at the `x` it was placed by.
    usable: () => true,
    read: (element) => element.textAlign,
    write: (element, value) => ({
      ...element,
      textAlign: oneOf(TEXT_ALIGNS, value, element.textAlign),
    }),
  },
];

function controlFor(key: StyleKey): StyleControl | undefined {
  return CONTROLS.find((control) => control.key === key);
}

/** The controls every given Element can use, in menu order. */
export function controlsFor(elements: readonly Element[]): StyleControl[] {
  return CONTROLS.filter((control) => elements.every((element) => control.usable(element)));
}

/** What a control shows for one Element. */
function valueOf(element: Element, key: StyleKey): string {
  return controlFor(key)?.read(element) ?? '';
}

/** The value every given Element shares, or null when they differ. */
export function sharedValue(elements: readonly Element[], key: StyleKey): string | null {
  const values = new Set(elements.map((element) => valueOf(element, key)));
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/**
 * The Element with one style field set. The value is the one the menu offers, so
 * it is always one the Scene holds; an Element that cannot take the control
 * comes back unchanged rather than gaining a field it never draws.
 */
export function styled(element: Element, key: StyleKey, value: string): Element {
  const control = controlFor(key);
  return control === undefined || !control.usable(element) ? element : control.write(element, value);
}

/** The roughness word, for the status bar's Scene-wide default. */
export function roughnessLabel(roughness: number): string {
  return ROUGHNESS_NAMES[String(roughness)] ?? 'artist';
}

/** The next look in the status bar's cycle: architect, artist, cartoonist. */
export function nextRoughness(roughness: number): number {
  const step = inRange(String(roughness), ROUGHNESS_MIN, ROUGHNESS_MAX, ROUGHNESS_MIN - 1);
  return step >= ROUGHNESS_MAX ? ROUGHNESS_MIN : step + 1;
}
