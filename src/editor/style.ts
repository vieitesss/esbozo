/**
 * The Style menu's controls: which Scene fields it can change, which of them a
 * selection can use, what each shows now, and how a pick changes an Element.
 *
 * Values are the Scene schema's own (`../scene.ts`), spelled exactly as it
 * stores them, and only the labels are words a person reads: `center` is shown
 * as "centre", roughness 0/1/2 as architect/artist/cartoonist.
 *
 * A control is offered only when every selected Element can use it, because a
 * pick writes the same value into all of them: a Text has no outline to
 * roughen, an arrow has no fill, and an ellipse has no corners to round. Font
 * size and text alignment are offered to every Element, because every Element
 * draws words (#4 gives them Labels); Roughness, Stroke, Fill and Corners are
 * the drawn look, so a Text does not take them.
 */
import { isOutlined } from '../scene.js';
import type {
  ArrowOrLineElement,
  Corners,
  Element,
  FillKind,
  FontSize,
  Head,
  StrokeStyle,
  StrokeWidth,
  TextAlign,
  Tone,
} from '../scene.js';

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
export interface StyleChoice {
  readonly value: string;
  readonly label: string;
}

export interface StyleControl {
  readonly key: StyleKey;
  /** The row's name, and the buttons' group name. */
  readonly label: string;
  readonly choices: readonly StyleChoice[];
  /** Draws colour swatches instead of words. */
  readonly swatches?: boolean;
  /** Whether an Element can take this control at all. */
  readonly usable: (element: Element) => boolean;
}

/** The three looks roughness names: 0 architect, 1 artist, 2 cartoonist. */
export const ROUGHNESS_CHOICES: readonly StyleChoice[] = [
  { value: '0', label: 'architect' },
  { value: '1', label: 'artist' },
  { value: '2', label: 'cartoonist' },
];

/** The seven-grey ladder: 0 is bare paper, 6 is solid ink. */
const GREY_CHOICES: readonly StyleChoice[] = Array.from({ length: 7 }, (_, grey) => ({
  value: String(grey),
  label: `grey ${grey}`,
}));

const drawn = (element: Element): boolean => element.type !== 'text';
const rounded = (element: Element): boolean =>
  element.type === 'rectangle' || element.type === 'diamond';
const ended = (element: Element): element is ArrowOrLineElement =>
  element.type === 'arrow' || element.type === 'line';

/** Every control, in the order the menu shows them. */
export const CONTROLS: readonly StyleControl[] = [
  { key: 'roughness', label: 'Rough', choices: ROUGHNESS_CHOICES, usable: drawn },
  {
    key: 'stroke.width',
    label: 'Stroke',
    choices: [
      { value: 'thin', label: 'thin' },
      { value: 'bold', label: 'bold' },
      { value: 'extra', label: 'extra' },
    ],
    usable: drawn,
  },
  {
    key: 'stroke.style',
    label: 'Line',
    choices: [
      { value: 'solid', label: 'solid' },
      { value: 'dashed', label: 'dashed' },
      { value: 'dotted', label: 'dotted' },
    ],
    usable: drawn,
  },
  {
    key: 'fill.kind',
    label: 'Fill',
    choices: [
      { value: 'none', label: 'none' },
      { value: 'solid', label: 'solid' },
      { value: 'hachure', label: 'hachure' },
      { value: 'cross-hatch', label: 'cross' },
    ],
    usable: isOutlined,
  },
  {
    key: 'fill.grey',
    label: 'Grey',
    choices: GREY_CHOICES,
    swatches: true,
    usable: isOutlined,
  },
  {
    key: 'tone',
    label: 'Tone',
    choices: [
      { value: 'ink', label: 'ink' },
      { value: 'muted', label: 'muted' },
    ],
    usable: () => true,
  },
  {
    key: 'corners',
    label: 'Corners',
    choices: [
      { value: 'sharp', label: 'sharp' },
      { value: 'round', label: 'round' },
    ],
    usable: rounded,
  },
  {
    key: 'heads.start',
    label: 'Head ←',
    choices: headChoices(),
    usable: ended,
  },
  {
    key: 'heads.end',
    label: 'Head →',
    choices: headChoices(),
    usable: ended,
  },
  {
    key: 'fontSize',
    label: 'Size',
    choices: [
      { value: 'S', label: 'S' },
      { value: 'M', label: 'M' },
      { value: 'L', label: 'L' },
      { value: 'XL', label: 'XL' },
    ],
    usable: () => true,
  },
  {
    key: 'textAlign',
    label: 'Align',
    choices: [
      { value: 'left', label: 'left' },
      { value: 'center', label: 'centre' },
      { value: 'right', label: 'right' },
    ],
    usable: () => true,
  },
];

function headChoices(): readonly StyleChoice[] {
  return [
    { value: 'none', label: 'none' },
    { value: 'arrow', label: 'arrow' },
    { value: 'dot', label: 'dot' },
    { value: 'bar', label: 'bar' },
  ];
}

/** The controls every given Element can use, in menu order. */
export function controlsFor(elements: readonly Element[]): StyleControl[] {
  return CONTROLS.filter((control) => elements.every((element) => control.usable(element)));
}

/** What a control shows for one Element. */
export function valueOf(element: Element, key: StyleKey): string {
  switch (key) {
    case 'roughness':
      return String(element.roughness);
    case 'stroke.width':
      return element.stroke.width;
    case 'stroke.style':
      return element.stroke.style;
    case 'fill.kind':
      return element.fill.kind;
    case 'fill.grey':
      return String(element.fill.grey);
    case 'tone':
      return element.tone;
    case 'corners':
      return element.corners;
    case 'heads.start':
      return ended(element) ? element.heads.start : '';
    case 'heads.end':
      return ended(element) ? element.heads.end : '';
    case 'fontSize':
      return element.fontSize;
    case 'textAlign':
      return element.textAlign;
  }
}

/** The value every given Element shares, or null when they differ. */
export function sharedValue(elements: readonly Element[], key: StyleKey): string | null {
  const values = new Set(elements.map((element) => valueOf(element, key)));
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/**
 * The Element with one style field set. The value is the one the menu offers,
 * so it always names a valid Scene value; an Element that cannot take the
 * control comes back unchanged rather than gaining a field it never draws.
 */
export function styled(element: Element, key: StyleKey, value: string): Element {
  const control = CONTROLS.find((candidate) => candidate.key === key);
  if (control === undefined || !control.usable(element)) {
    return element;
  }
  switch (key) {
    case 'roughness':
      return { ...element, roughness: Number(value) };
    case 'stroke.width':
      return { ...element, stroke: { ...element.stroke, width: value as StrokeWidth } };
    case 'stroke.style':
      return { ...element, stroke: { ...element.stroke, style: value as StrokeStyle } };
    case 'fill.kind':
      return { ...element, fill: { ...element.fill, kind: value as FillKind } };
    case 'fill.grey':
      return { ...element, fill: { ...element.fill, grey: Number(value) } };
    case 'tone':
      return { ...element, tone: value as Tone };
    case 'corners':
      return { ...element, corners: value as Corners };
    case 'heads.start':
      return ended(element) ? { ...element, heads: { ...element.heads, start: value as Head } } : element;
    case 'heads.end':
      return ended(element) ? { ...element, heads: { ...element.heads, end: value as Head } } : element;
    case 'fontSize':
      return { ...element, fontSize: value as FontSize };
    case 'textAlign':
      return { ...element, textAlign: value as TextAlign };
  }
}

/** The roughness word, for the status bar's Scene-wide default. */
export function roughnessLabel(roughness: number): string {
  return ROUGHNESS_CHOICES.find((choice) => choice.value === String(roughness))?.label ?? 'artist';
}

/** The next look in the status bar's cycle: architect, artist, cartoonist. */
export function nextRoughness(roughness: number): number {
  return (ROUGHNESS_CHOICES.findIndex((choice) => choice.value === String(roughness)) + 1) %
    ROUGHNESS_CHOICES.length;
}
