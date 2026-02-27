# Auth Production Roadmap

## Goal

Make local accounts production-ready while keeping OIDC as primary auth.

## Tasks (in order)

1. Foundation: shared registration policy and OIDC enforcement.
2. Bootstrap: first-run setup flow for creating the first admin safely.
3. Safety: last-admin guardrails (cannot disable/demote final active admin).
4. Onboarding: invite-only registration (email invite links, accept flow, expiry/revoke).
5. Account lifecycle: local password setup/reset/change flows.
6. Admin UX: invite management and account lifecycle actions in admin user management.
7. Identity hardening: enforce normalized email uniqueness and migration strategy.
8. Optional: domain auto-approve onboarding mode and policy UI/docs.

## Status

- [x] 1. Foundation
- [x] 2. Bootstrap
- [x] 3. Safety
- [ ] 4. Onboarding
- [ ] 5. Account lifecycle
- [ ] 6. Admin UX
- [ ] 7. Identity hardening
- [ ] 8. Optional mode enhancements
