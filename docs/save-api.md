# The save API

`ez serve <dir>` serves the editor page and a small HTTP API over one folder of Scenes. The editor speaks it; so can any client that cannot open the folder itself. A client that can (an agent on the same machine) writes the Scene file and runs `ez render`, and never needs this page. The code is `src/serve.ts`; the routes, the listing shape and the write body are shared with the editors in `src/scenes-api.ts`.

The bundled editor ([embed.md](embed.md)) speaks the write half of this API wherever its `save` attribute points, so a page can take a save with its own handler as long as it reads and answers it the way the routes below say. A page with no server at all leaves `save` out and the editor stays read-only.

```sh
ez serve ./diagrams --port 4320     # prints: serving /abs/path/diagrams on http://127.0.0.1:4320/ (build 1a2b3c4)
```

Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host <address>` | `127.0.0.1` | The address to listen on. Anything other than a loopback address makes the folder writable by whoever can reach it: there is no authentication. |
| `--port <N>` | `4320` | `0` lets the operating system pick a free port; read it from the line `ez serve` prints. |
| `--read-only` | off | Refuses every write with `403`, and tells the editor, which then hides its New button and saves nothing. |

Flags take a separate value: `--port 4320`, never `--port=4320`. `ez serve` runs until `SIGINT` or `SIGTERM`, then exits `0`. It exits `2` for wrong arguments and `4` when it cannot start: the folder cannot be read, the editor is not built (`pnpm build`), or the port is taken (`port 4320 on 127.0.0.1 is already in use: pass --port N`).

## Names

A Scene name is one path segment, taken after percent-decoding, and it has to be all of these:

- A plain file name at the top level of the folder: no `/` or `\`, and no subfolder.
- Not hidden and not relative: it does not start with `.`, so `.a.esbozo`, `.` and `..` are out.
- Ending in `.esbozo` or `.json`, in any letter case: `a.esbozo`, `a.json` and `A.JSON` all pass.

A request path with a `.` or `..` segment, or with broken percent-encoding, is refused before anything else. A name that is a symlink to somewhere outside the folder is refused too.

`GET /api/scenes` lists only the names a request can open: regular files at the top level that pass these rules, sorted. Folders, symlinks, hidden files and other extensions never appear. A `.json` name is any other JSON file's too, so the list keeps one only when its bytes parse as a Scene: a `package.json` or a `tsconfig.json` beside the Scenes is left out, and so is a Scene file that will not parse. A `.esbozo` name is this project's own extension, so it is listed however it reads, and a file that will not parse says what is wrong when it is opened. A `.json` the list cannot read — gone, unreadable, or over 5 MB — is left out instead of failing the listing.

The SVG of a Scene is `<name without its extension>.svg` beside it: `a.esbozo` gives `a.svg`, `a.json` gives `a.svg`, and `a.esbozo.JSON` gives `a.esbozo.svg`. Names that reach one SVG — `a.esbozo` and `a.json`, or `a.esbozo` and `A.ESBOZO` on a case-insensitive disk — take the same write queue, so they cannot race. Whether `GET` finds `b.esbozo` when the file is `B.ESBOZO` is the filesystem's answer, not the server's.

## Routes

Every response carries `cache-control: no-store`. Every API response, and every failure on any route, is JSON (`content-type: application/json; charset=utf-8`), and every failure is `{ "error": "<message>" }`. Only the successful body of a page file (see The page) is HTML, CSS, JavaScript or a font.

### `GET /api/health`

```sh
curl http://127.0.0.1:4320/api/health
# {"build":"1a2b3c4"}
```

The build this server is: the commit the CLI was built from, with `-dirty` when the folder it was built in had changes, `dev` when the CLI runs from source, and `unknown` when the build found no git checkout. It is the same id the startup line ends with, so a server someone finds running can say whether it is the one they started. Any other method answers `405`.

### `GET /api/scenes`

```sh
curl http://127.0.0.1:4320/api/scenes
# {"folder":"diagrams","readOnly":false,"scenes":["a.esbozo","b.json"]}
```

`folder` is the folder's own name, not its path. Any other method answers `405`.

### `GET /api/scenes/<name>`

`200` with the Scene file exactly as it is on disk (not re-serialised), or `404` `no Scene named <name>` when the name is not a Scene file: there is no such file, or the name belongs to a folder. A name the rules refuse is `400`; a symlink that leaves the folder is `403`.

### `PUT /api/scenes/<name>`, `POST /api/scenes/<name>`

Two spellings of one write. The body is JSON with two strings:

```json
{ "scene": "<the Scene's source text>", "svg": "<the SVG's source text>" }
```

```sh
curl -X PUT -H 'content-type: application/json' \
  -d '{"scene":"{\"version\":1,\"elements\":[]}","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"}' \
  http://127.0.0.1:4320/api/scenes/hello.esbozo
# {}
```

`200` with `{}` means both files are written. The server stores `scene` byte for byte, so send the canonical text (`serialiseScene`, as the editor does) if you want canonical files. It parses `scene` with the same parser as `ez check` and refuses an invalid one; it does not look inside `svg`, and it does not check that the SVG belongs to the Scene or that Labels fit (that is `ez check`, exit `6`).

The Content-Type has to be the media type `application/json`, matched without regard to letter case (`Application/JSON` passes), with parameters such as `; charset=utf-8` allowed. A browser page on another origin can send `text/plain` without asking first, and this rule is what stops it writing to the folder.

## Status codes

### Checks for every route

These run before any route-specific work, in this order. The first that fails answers.

| Status | When |
| --- | --- |
| `400` | Broken percent-encoding, or a `.` or `..` segment in the path (`%2e%2e` too). |
| `405` | The listing, the health route or a page file with a method other than `GET`: `use GET`. |
| `404` | A path outside `/api/scenes` that is not a page file: `no page file <path>`. |

A Scene route (`/api/scenes/<name>`) then checks the name and its place before the method: a name the rules refuse is `400`, and a symlink that leaves the folder is `403` (`<name> leaves the folder`). After that, `GET` answers `200` or `404` (`no Scene named <name>`), and a method other than `GET`, `PUT` or `POST` is `405` (`use GET, PUT or POST`).

### Checks for a write

A `PUT` or `POST` then passes these, in order. The first that fails answers.

| Status | When |
| --- | --- |
| `403` | The folder is served `--read-only`: `this folder is served read-only`. This comes before every check below it, so a read-only folder answers `403` even for a wrong Content-Type. |
| `415` | The Content-Type is not `application/json`. |
| `413` | The body is over 8 MiB (`8388608` bytes). Nothing is written. |
| `400` | The body is not JSON of the shape above (both `scene` and `svg` must be strings), or the Scene is invalid: `the Scene is invalid: <problems>`. |
| `409` | The Scene's file or its SVG exists and is not a regular file: `<name> is a folder: save the Scene under another name`, or `<name> is not a file: save the Scene under another name` for any other kind of entry. Nothing is written. |
| `500` | A write failed on disk. If even the undo failed, the message names the copy of the old Scene that is left behind. |

## Writes are serialised and undone on failure

A write replaces the Scene and its SVG, but the pair is not atomic:

1. Both targets are checked first. A target that is not a regular file is `409` and nothing changes.
2. Writes go through one queue per output pair, so two writes never interleave. `flow.esbozo` and `flow.json` both replace `flow.svg`, so they share one queue and the last successful save owns `flow.svg`; writes whose Scenes have different SVGs run at the same time, and a `GET` does not wait for a write.
3. The old Scene is copied aside, both new texts are written to temporary files, then the Scene is renamed into place, then the SVG.
4. A failure before or between the renames puts the old Scene back and leaves the old SVG untouched. That is a rollback within the request, not a transaction a reader can see.
5. A reader that looks between the two renames sees the new Scene beside the previous SVG. The SVG never leads the Scene. Once the request answers `200`, both files come from that write.

An invalid Scene, a wrong Content-Type and a body that is too large leave both files untouched.

## The page

Every other path is a page file: `GET /` and `/editor.html`, `/editor.css`, `/editor.js`, `/fonts/Kalam-Regular.ttf` and `/fonts/OFL.txt`, and nothing else beside the CLI is published (`src/page-assets.ts`). A page served as plain files has no `/api/scenes`; the editor takes that `404` as "no server here" and asks for a folder with the browser's picker instead.

## Security

There is no authentication. The server listens on `127.0.0.1`, so only this machine reaches it; the Content-Type rule stops a web page you visit from writing to the folder through your browser, and the name rules keep every read and write inside the folder. Pass `--host` only for a network you trust, and add `--read-only` when the folder should not change. The image changes what "this machine" means: [docker.md](docker.md#where-the-folder-is-reachable) covers who reaches it there.
