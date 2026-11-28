# esbozo.vieitesss.eu is two Cloudflare redirects, not a site

The install one-liner needs a short, stable address, and nothing on it needs
hosting, so `esbozo.vieitesss.eu` is two Cloudflare Redirect Rules: `/` goes to
the GitHub repository and `/install` goes to `install.sh` on `main` through
`raw.githubusercontent.com`. `curl -fsSL` follows both.

## Considered Options

- GitHub Pages from this repository: one more site and deploy job, and the
  root could only redirect by meta refresh.
- Serving it from the RPi: the RPi takes tailnet traffic only.

## Consequences

- `/install` always serves the `install.sh` on `main`, and every installed
  `ez update` calls it, so `install.sh` stays backward compatible with the
  flags older binaries pass.
- The rules live in the Cloudflare dashboard, not in this repository.
