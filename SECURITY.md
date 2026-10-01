# Security Policy

## Supported versions

Security fixes go into the **latest release** only. Fridgora is a single-image app with
forward-only upgrades, so the fix for an older version is to upgrade.

| Version          | Supported |
| ---------------- | :-------: |
| latest 3.x       |    ✅     |
| older 3.x        |    ❌     |
| 2.x (MongoDB)    |    ❌     |

## Reporting a vulnerability

Please report it **privately** through
[GitHub private vulnerability reporting](https://github.com/houby-studio/fridgora/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it and what an attacker could do
with it. You will get an answer as soon as possible, and credit in the advisory if you want it.

## Verifying what you run

Every published image carries a signed SLSA build provenance attestation. Before deploying, you
can check that an image was built by this repository's CI from the commit and tag it claims — see
[Verifying an image](docs/deployment.md#verifying-an-image).
