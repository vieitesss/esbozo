/**
 * Exit codes for `ez` and `internal/core`'s `Result.ExitCode`:
 *
 *   0  ok (clean Scene, rendered, PNG/bundle written, or server stopped)
 *   2  wrong arguments (unknown command, missing/extra arguments, bad flag)
 *   3  Scene could not be read or parsed
 *   4  output could not be written, server could not start, or editor not built
 *   5  missing theme values, or missing/unreadable font
 *   6  Label does not fit its Element (`ez check`)
 */
export const EXIT = {
  ok: 0,
  usage: 2,
  invalidScene: 3,
  writeFailed: 4,
  missingThemeOrFont: 5,
  labelOverflow: 6,
} as const;
