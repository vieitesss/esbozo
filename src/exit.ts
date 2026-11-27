/**
 * The codes `ez` exits with: the one place they are defined.
 *
 *   0  the Scene is clean, was rendered, the PNG or the bundle was written, or
 *      the server stopped
 *   2  wrong arguments (unknown command, missing or extra arguments, bad flag)
 *   3  the Scene could not be read or parsed
 *   4  the output could not be written, the server could not start, or the
 *      editor is not built
 *   5  missing theme values, or a missing or unreadable font
 *   6  a Label that does not fit its Element (see `ez check`)
 *
 * The command line, the core bundle the Go binary runs, and the Scene edits it
 * asks for all refuse with these codes, so they read them here rather than each
 * carrying a copy that could drift.
 */
export const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;
