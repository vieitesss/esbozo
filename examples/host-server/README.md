# Reference host server

This folder contains example code for a host endpoint that speaks the esbozo save API. It is not part of `src/` and does not ship in the npm package. Copy `server.mjs` into your own host application and adapt it to your routes and authentication.

## Run the server

Start the server against a root folder of Scenes:

```sh
node examples/host-server/server.mjs ./diagrams --port 4321
```

Flags:

- `--host <address>` sets the listen address. The default is `127.0.0.1`.
- `--port <N>` sets the listen port. The default is `4321`. Pass `0` to let the operating system pick a free port.
- `--render` re-renders the SVG on the server by calling `ez render` instead of writing the `svg` field from the request body.

## Endpoints

The server exposes nested Scene paths under the root folder, such as `/zett/assets/page/flow.esbozo`:

- `GET /<path>` returns the Scene file verbatim, or `404` with `{ "error": "..." }` if it does not exist.
- `PUT /<path>` and `POST /<path>` accept `{ "scene": "<text>", "svg": "<text>" }` with `content-type: application/json`, write the Scene and its sibling `.svg` file, and return `200` with `{}`.

All error responses return JSON in the shape `{ "error": "<message>" }`, and all responses carry `cache-control: no-store`.

## Static assets

This server handles only Scene reads and saves. Serve the embed bundle (`esbozo-embed.js`) and the font file (`Kalam-Regular.ttf`) from your host application's static file handler.

## Safety rules

Each check in `server.mjs` prevents a specific failure mode:

- **Percent-encoding and dot segments:** Rejects malformed percent-encoding, backslashes, and `.` or `..` segments before resolving paths, preventing directory traversal.
- **Hidden segments and extensions:** Rejects any path segment that starts with `.` and requires the file name to end in `.esbozo` or `.json`, keeping dotfiles and non-Scene files out of reach.
- **Symlink containment:** Resolves the deepest existing ancestor with `realpath` and refuses any Scene or SVG path that leaves the root folder with `403`.
- **Content-Type check:** Requires `content-type: application/json` on writes, stopping cross-origin browser forms from posting plain text.
- **Body size limit:** Rejects write bodies larger than 8 MiB with `413` before writing to disk.
- **Per-SVG write queue and atomic renames:** Serialises concurrent writes targeting the same `.svg` path and writes each file through a temporary file plus `rename`, restoring the previous Scene if a write fails.
