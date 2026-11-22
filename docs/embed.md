# Embedding the editor

`ez bundle <dir>` writes the editor as one ES module, `<dir>/esbozo-<version>.js`, so a page that is not esbozo's own can hold it with a tag. The version is the one in `package.json`; an existing file of the same name is replaced, so a page pins the bundle with a one-file diff and a reviewer sees which editor version it pinned.

```sh
ez bundle public/          # public/esbozo-0.0.0.js
```

```html
<esbozo-editor
  scene="/sketches/flow.esbozo"
  save="/api/scenes/flow.esbozo"
  font="/fonts/Kalam-Regular.ttf"></esbozo-editor>
<script type="module" src="/esbozo-0.0.0.js"></script>
```

The module registers `<esbozo-editor>` and injects the editor's stylesheet, so the page needs no second file and no build step. It registers the element whatever the page holds at the time, so the tag may be anywhere — before the script, after it, or made by a script of its own later — and it reads each element's attributes whenever they change.

## The attributes

| Attribute | Meaning |
| --- | --- |
| `scene` | A URL a `GET` answers the Scene's source on. A `404` opens an empty canvas that says `new Scene`: a Scene nobody has drawn yet is not an error, and nothing is written until the first edit. Anything else that goes wrong with the read is the server's words in the status line, and a page that could not read its Scene never writes one. Required: without it the status line says what is missing. |
| `save` | A URL a `PUT` takes `{ "scene": "...", "svg": "..." }` on — the body and the answers in [save-api.md](save-api.md), which is also what `ez serve` answers. Leave it out and the editor is read-only: it draws, pans, zooms, selects and copies, refuses every edit, puts the tool back to Select, and its status line says `read-only`. A `403` on a save is the server saying the same thing, so from then on the page stops editing, stops asking, and takes no undo step it cannot show. |
| `font` | The URL of the Kalam file the page draws words in. The bundle carries no font, so the page decides where it lives and which version it is. Each element fetches these bytes once, measures every Label and Text with them (`src/font-metrics.ts`), read with the font's own tables rather than a font library: a full OpenType parser is bigger than the whole budget below. The face the words are drawn in is built from those same bytes, so nothing fetches the file a second time and the drawing always matches the measurement. Give two elements two different files and each measures and draws with its own. |

Every attribute is live. Changing `font` fetches and measures the new file and redraws the Scene in hand in it; a font that will not load leaves the face and the metrics already there, and says so. Changing `scene` or `save` is a new instance of the element: it lets go of the gesture, the half-typed words, the tool in hand, the selection, the history and the writes of the old one, and starts again from its attributes — reading the Scene the `scene` URL names now, whole URL and not file name, and writing nothing until the next edit. Removing `save` rebuilds it read-only, with the Scene still on the canvas.

One connection per element, numbered, and an answer that arrives for one the page has moved on from — a read, a font, a write — is dropped instead of drawn. A write is bound to the Scene it was made for when it is queued: it goes to that `save` URL and to no other, so an edit queued for the old destination lands there or not at all, and a `403` or a failure from an old connection changes nothing on the page.

The focus is the page's until a person clicks into the editor. The element is focusable, and while the focus is inside it the keys and the clipboard are the editor's; with the focus anywhere else — before the first click, or after clicking the host's own words — <kbd>Space</kbd> and the arrows scroll the page like they do anywhere else.

A load, a save or a font that fails is the server's or the browser's own words in the status line; the editor stays on screen.

## Two elements on one page

Each element is an editor of its own: its own Scene, its own font, its own save URL and its own dot Grid — the Grid is a pattern of its own, so two editors never fill their dots from each other. The keyboard and the clipboard go to the element the focus is inside, so a nudge in one is never a save in the other, and a page nobody has clicked into keeps its own keys.

## What it is, and what it is not

The element is the editor the served page shows — one implementation, `src/editor/`, with the same Renderer and the same Layout — and the single Scene is a third implementation of the storage seam in `src/editor/files.ts` (`src/editor/scene-url.ts`), after a picked folder and a served one. There is no fork of the editor in the bundle.

So it has the whole editor: the tool rail, the Grid, selection, Snap, the keyboard shortcuts, autosave on every change, and no unsaved-changes prompt. What it does not have is esbozo's page around it: there is no folder to browse and no second Scene to create, so those two handles are hidden, and no PNG export — a PNG draws its words from the font's outlines and its paper and ink from the served page's palette, and the bundle has the metrics alone. The command palette lists both Export rows greyed out, saying to use `ez png` on the Scene file instead.

## Where it sits

The element is a block in the host's content: `display: block`, full width, `480px` tall, and the page flows after it. Give it a height of your own to make it another size:

```css
esbozo-editor { height: 70vh }
```

Every rule the bundle writes is rooted at `esbozo-editor`, so the host page keeps its own margins, its own font, its own scrolling and its own custom properties: the editor's palette (`--ink`, `--paper`, `--font-hand` and the rest) is declared on the element, not on `:root`. The injected stylesheet goes in first, so a host rule of the same specificity wins.

The theme follows `<html data-theme>`: set `"dark"` for dark paper. The bundle does not follow `prefers-color-scheme` on its own, because a host page has usually decided that already.

## Size

The bundle is one minified file, Rough.js and the editor's stylesheet included, of about 61 kB gzipped. `test/embed-bundle.test.ts` measures it and prints the number on every run, and fails if it grows past 64 kB gzipped, so a dependency that quietly doubles it cannot land unnoticed.
