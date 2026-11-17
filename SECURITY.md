# Security policy

Flint holds credentials, so a security problem in it matters. Thank you for reporting one
responsibly.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through
[GitHub's security advisories](https://github.com/samaniegoluis/flint/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**).

Please include what you found, how to reproduce it, the version (`flint --version`) and
your OS. Do not include a real password, key or vault: a throwaway one is enough.

I will acknowledge the report within a week, keep you informed while it is fixed, and
credit you in the release notes unless you prefer otherwise.

## Supported versions

Flint is a preview with no release builds yet. Fixes go into the latest version on
`main`; older versions are not patched.

## What Flint protects

The [security model](site/src/content/docs/reference/security-model.md) says what Flint
protects against, what it does not, and how the vault is encrypted
([vault format](site/src/content/docs/reference/vault-format.md)).
