# Embedding the editor

`ez bundle <dir>` writes the editor as one ES module, `<dir>/esbozo-<version>.js`, so a page that is not esbozo's own can hold it with a tag. The version is the one in `package.json`; an existing file of the same name is replaced, so a page pins the bundle with a one-file diff and a reviewer sees which editor version it pinned.

```sh
ez bundle public/                                          # public/esbozo-0.0.0.js
cp node_modules/esbozo/fonts/Kalam-Regular.ttf public/     # beside the bundle
```

```html
<esbozo-editor
  scene="/sketches/flow.esbozo"
  save="/api/scenes/flow.esbozo"></esbozo-editor>
<script type="module" src="/esbozo-0.0.0.js"></script>
```

A host serving the font elsewhere sets `font` to its URL.

The module registers `<esbozo-editor>` and injects the editor's stylesheet, so the page needs no second file and no build step. It registers the element whatever the page holds at the time, so the tag may be anywhere — before the script, after it, or made by a script of its own later — and it reads each element's attributes whenever they change.

## The attributes

| Attribute | Meaning |
| --- | --- |
| `scene` | A URL a `GET` answers the Scene's source on. A `404` opens an empty canvas that says `new Scene`: a Scene nobody has drawn yet is not an error, and nothing is written until the first edit. Anything else that goes wrong with the read is the server's words in the status line, and a page that could not read its Scene never writes one. Required unless you supply storage through `mount()` (see [Storage functions](#storage-functions-mount)); without either, the status line says what is missing. |
| `save` | A URL a `PUT` takes `{ "scene": "...", "svg": "..." }` on — the body and the answers in [save-api.md](save-api.md), which is also what `ez serve` answers. Leave it out (unless `mount()` supplies a `save` function) and the editor is read-only: it draws, pans, zooms, selects and copies, refuses every edit, puts the tool back to Select, and its status line says `read-only`. A `403` on a save is the server saying the same thing, so from then on the page stops editing, stops asking, and takes no undo step it cannot show. |
| `font` | The URL of the Kalam file the page draws words in. Optional: leave it out and the bundle fetches `./Kalam-Regular.ttf` beside itself (resolved against the module's URL). The bundle carries no font, so the page decides where it lives and which version it is. Each element fetches these bytes once, measures every Label and Text with them (`src/font-metrics.ts`), read with the font's own tables rather than a font library: a full OpenType parser is bigger than the whole budget below. The face the words are drawn in is built from those same bytes, so nothing fetches the file a second time and the drawing always matches the measurement. Give two elements two different files and each measures and draws with its own. |

Every attribute is live. Changing `font` fetches and measures the new file and redraws the Scene in hand in it; a font that will not load leaves the face and the metrics already there, and says so. Changing `scene` or `save` is a new instance of the element: it lets go of the gesture, the half-typed words, the tool in hand, the selection, the history and the writes of the old one, and starts again from its attributes — reading the Scene the `scene` URL names now, whole URL and not file name, and writing nothing until the next edit. Removing `save` rebuilds it read-only, with the Scene still on the canvas.

One connection per element, numbered, and an answer that arrives for one the page has moved on from — a read, a font, a write — is dropped instead of drawn. A write is bound to the Scene it was made for when it is queued: it goes to that `save` URL and to no other, so an edit queued for the old destination lands there or not at all, and a `403` or a failure from an old connection changes nothing on the page.

The focus is the page's until a person clicks into the editor. The element is focusable, and while the focus is inside it the keys and the clipboard are the editor's: every `keydown` and `keyup` stops at the element, handled or not, so host bubble-phase listeners on `document` or `window` never see them. A host capture-phase listener registered before the bundle still sees the event first. With the focus anywhere else — before the first click, or after clicking the host's own words — <kbd>Space</kbd>, the arrows and the host's own shortcuts work as usual.

A load, a save or a font that fails is the server's or the browser's own words in the status line; the editor stays on screen.

## Storage functions: `mount()`

When a Scene does not live behind `GET` and `PUT` URLs, import `mount` from the bundle and pass storage functions to an `<esbozo-editor>` element.

```js
import { mount } from '/esbozo-0.0.0.js';
```

`mount(element, options)` accepts an object with three fields:

```ts
interface MountOptions {
  readonly font?: { readonly url: string };
  readonly load: () => Promise<string | null> | string | null;
  readonly save?: (scene: string, svg: string) => Promise<void> | void;
}
```

Attributes take precedence over `mount()` options:

- If the `scene` attribute is present, the element reads and writes through its URL attributes and ignores `load` and `save`.
- Font resolution checks the `font` attribute first, then `options.font.url`, and falls back to `./Kalam-Regular.ttf` beside the bundle.
- Calling `mount()` on an already connected element rebuilds it with the new options.

Omit `save` to open the editor in read-only mode. The editor displays `read-only` in the status line and refuses edits.

Writes queue one at a time per element. If `save` throws or returns a rejected Promise, the status line shows the error message and the element dispatches `esbozo:save` with `state: 'failed'` and `detail` set to that message.

The following example stores a Scene and its rendered SVG in `localStorage`:

```html
<esbozo-editor id="sketch"></esbozo-editor>
<script type="module">
  import { mount } from '/esbozo-0.0.0.js';

  const key = 'my-sketch';
  mount(document.getElementById('sketch'), {
    load: () => localStorage.getItem(key),
    save: (scene, svg) => {
      localStorage.setItem(key, scene);
      localStorage.setItem(`${key}:svg`, svg);
    },
  });
</script>
```

## Events

`<esbozo-editor>` dispatches a `CustomEvent` named `esbozo:save` on the element whenever its saved state changes (both the bundle and the served page dispatch it; the status line is unchanged). It does not bubble (`bubbles: false`, `composed: false`) and is not cancelable, so attach listeners directly on the element:

```js
editor.addEventListener('esbozo:save', ({ detail: { state, detail } }) => {
  // state: 'idle' | 'saving' | 'saved' | 'new' | 'failed'
  // detail: failure message when state === 'failed', '' otherwise
});
```

It fires only when `state` or `detail` differs from the last dispatched pair. Because the editor starts in `idle`, opening an existing Scene in read-only mode fires no event. An attribute-driven rebuild (such as changing `scene` or `save`) resets from `saved`, `failed`, or `new` back to `idle` and therefore fires `idle` before the new Scene loads.

## The tool rail

The rail floats over the paper at the top of the element. Drag it — from a tile or from the padding around them — and it docks on the nearest of four sides: top, bottom, left or right, lying along the top and bottom and standing up the left and right. A press that moves less than a few pixels is still a click, and picks that tool. A longer press docks the rail and picks none. <kbd>Escape</kbd>, losing the window's focus or a cancelled pointer puts the rail back where it hung. None of this touches the Scene: the rail moves in a read-only embed too, and a move writes no file and adds no undo step.

The page keeps the side the last move took in `localStorage`, under `esbozo.rail`, as one of `top`, `bottom`, `left` and `right`. That key belongs to the page, not to the element or the Scene, so every editor on the page starts on the side the last move kept. An editor that is already open does not follow it: each reads the key once, when it starts, and a reload is what picks a new side up. A browser that blocks storage, or holds a word that is not one of the four, starts the rail at the top and still moves it for that visit.

The command palette's four `Tool rail:` rows move it too, and no key does. In a window too small for the rail, the rail is clipped rather than shrunk, wrapped or turned: the keys <kbd>V</kbd> <kbd>R</kbd> <kbd>E</kbd> <kbd>D</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>T</kbd> and <kbd>1</kbd>–<kbd>7</kbd>, and the palette, still reach every tool and every dock from there.

The rail used to hang at the element's left edge. A host page that takes a new bundle sees it at the top, with the behaviour above, and needs no change of its own: no attribute sets, locks or reports the dock, and there is no new attribute to add.

## Two elements on one page

Each element is an editor of its own: its own Scene, its own font, its own save URL and its own dot Grid — the Grid is a pattern of its own, so two editors never fill their dots from each other. The keyboard and the clipboard go to the element the focus is inside, so a nudge in one is never a save in the other, and a page nobody has clicked into keeps its own keys. Each rail measures its own element's box and moves inside it, so two editors of two sizes hang and dock their rails apart.

## What it is, and what it is not

The element is the editor the served page shows — one implementation, `src/editor/`, with the same Renderer and the same Layout — and the single Scene is a third implementation of the storage seam in `src/editor/files.ts` (`src/editor/scene-url.ts`), after a picked folder and a served one. There is no fork of the editor in the bundle.

So it has the whole editor: the tool rail, the Grid, selection, Snap, the keyboard shortcuts, autosave on every change, and no unsaved-changes prompt. What it does not have is esbozo's page around it: there is no folder to browse and no second Scene to create, so those two handles are hidden, and no PNG export — a PNG draws its words from the font's outlines and its paper and ink from the served page's palette, and the bundle has the metrics alone. The command palette lists both Export rows greyed out, saying to use `ez png` on the Scene file instead.

## Where it sits

The element is a block in the host's content: `display: block`, full width, `480px` tall, and the page flows after it. Give it a height of your own to make it another size:

```css
esbozo-editor { height: 70vh }
```

Every rule the bundle writes is rooted at `esbozo-editor`, so the host page keeps its own margins, its own font, its own scrolling and its own custom properties: the editor's palette (`--ink`, `--paper`, `--font-hand` and the rest) is declared on the element, not on `:root`. The injected stylesheet goes in first, so a host rule of the same specificity wins.

When `<html data-theme>` is absent, the bundle follows `prefers-color-scheme` live. When `data-theme` is set on `<html>` (including late, after load), it wins over `prefers-color-scheme`: `"dark"` draws dark paper and any other value draws light.

A host that scales the element with CSS `transform: scale(...)` or `zoom` works as-is: pointer positions and layout measurements convert through the element's scale.

## Size

The bundle is one minified file, Rough.js and the editor's stylesheet included, of about 60 kB gzipped. `test/embed-bundle.test.ts` measures it and prints the number on every run, and fails if it grows past 64 kB gzipped, so a dependency that quietly doubles it cannot land unnoticed.
