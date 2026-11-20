# Bloop Constitution

## Core Principles

### I. Security-First Architecture (NON-NEGOTIABLE)

Every feature, protocol, storage mechanism, and UI workflow in Bloop MUST prioritize confidentiality, integrity, and least privilege over convenience or delivery speed. Threat modeling and security impact analysis MUST precede implementation for any new capability. Insecure defaults, plaintext fallbacks, and security-bypass flags are strictly prohibited.

### II. Mandatory End-to-End Message Encryption (NON-NEGOTIABLE)

All chat messages, attachments, and sensitive payloads MUST be encrypted on the sender's device before transmission and MUST remain encrypted in transit and at rest. Plaintext message transmission or server-readable message storage is strictly forbidden. Implementations MUST use vetted, peer-reviewed cryptographic primitives and authenticated encryption; custom or unverified cryptographic algorithms are prohibited.

### III. Windows-Native Data Protection & Isolation

Bloop targets the Windows operating system and MUST store cryptographic keys, credentials, and local session state using Windows-native security boundaries (such as Windows DPAPI, Credential Locker, or hardware-backed key storage where available) under least-privilege user permissions. Decrypted message content and key material MUST NOT be written to unencrypted temporary files or world-readable application directories.

### IV. Zero-Leakage Observability & Fail-Closed Behavior

Logs, telemetry, diagnostics, and crash reports MUST NEVER record plaintext message contents, private keys, passphrases, or authentication tokens. All security checks, certificate validations, signature verifications, and decryption operations MUST fail closed: on error or verification failure, the application MUST abort the operation and notify the user clearly rather than degrading security guarantees.

### V. Test-First Verification & Security Gates

All cryptographic workflows, key lifecycle operations, fail-closed error paths, and Windows security boundary integrations MUST be verified by automated tests prior to release. Test suites MUST include negative and adversarial test cases confirming that unencrypted, tampered, replayed, or unauthorized payloads are rejected.

## Windows Platform & Cryptographic Constraints

- **Target Platform**: Bloop MUST be built and tested specifically for supported Windows desktop environments, respecting Windows filesystem ACLs, process isolation, and user-session boundaries.
- **Key & Secret Management**: Encryption keys MUST be rotated, scoped, and zeroized from memory when no longer needed to the extent permitted by the runtime. Hardcoded secrets, static encryption keys, and shared global keys are prohibited.
- **Dependency Hygiene**: Third-party cryptographic, networking, and UI dependencies MUST be minimal, actively maintained, and audited for known vulnerabilities before adoption or upgrade.

## Development Workflow & Quality Gates

- **Constitution Compliance**: Every feature specification, implementation plan, and code review MUST explicitly verify adherence to all Core Principles before work is accepted.
- **Security Review Gate**: Any change touching cryptography, authentication, key storage, IPC, or network transport MUST undergo dedicated security verification against negative test cases and fail-closed requirements.
- **Simplicity & Minimal Attack Surface**: Features and dependencies MUST remain as small and focused as possible to minimize the application's attack surface; added complexity requires explicit justification.

## Governance

This Constitution supersedes all other engineering practices and convenience conventions for Bloop. Amendments require documented rationale, explicit approval, and an updated migration or verification plan for existing components.

Versioning follows Semantic Versioning (`MAJOR.MINOR.PATCH`):
- **MAJOR**: Backward-incompatible governance changes, principle removals, or security posture relaxations.
- **MINOR**: New principles or sections added, or material expansion of mandatory security guidance.
- **PATCH**: Clarifications, wording improvements, or non-semantic refinements.

Compliance with this Constitution MUST be verified at specification, planning, and pre-merge review stages using `.specify/` project templates and checklists.

**Version**: 1.0.0 | **Ratified**: 2026-11-19 | **Last Amended**: 2026-11-19
