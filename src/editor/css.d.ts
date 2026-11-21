/**
 * A stylesheet as esbuild's `text` loader hands it to the bundle: the file's
 * text, so the bundle carries the editor's look and needs no CSS request.
 */
declare module '*.css' {
  const text: string;
  export default text;
}
