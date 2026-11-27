// The install script the binary carries, beside the skill `ez skill` prints.
package esbozo

import _ "embed"

// InstallScript is `scripts/install.sh` — the script `ez update` re-runs with the
// flags it was given and `--dir` set to the folder the binary runs from — so what
// `ez update` installs is what this binary carries, as `Skill` is to
// `ez skill install`.
//
//go:embed scripts/install.sh
var InstallScript []byte
