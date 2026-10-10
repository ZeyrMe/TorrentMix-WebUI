## ADDED Requirements

### Requirement: Gateway runtime SHALL persist server catalog in an encrypted SQLCipher database
`Standalone Service` and `Desktop` SHALL use a SQLCipher-backed SQLite database as the sole primary store for gateway runtime configuration, including default server selection, server metadata, usernames, and passwords.

#### Scenario: Initialize an empty encrypted catalog database
- **WHEN** the gateway runtime starts with a valid master key and no existing catalog database
- **THEN** it SHALL create an encrypted database file, initialize the required schema, and expose an empty server catalog without requiring a JSON config file

#### Scenario: Open an existing encrypted catalog database
- **WHEN** the gateway runtime starts with a valid master key and an existing catalog database
- **THEN** it SHALL open the encrypted database, validate the key by performing a real read, and load the server catalog from the database as the runtime source of truth

### Requirement: Gateway runtime SHALL resolve the SQLCipher master key transparently
The gateway runtime SHALL resolve the SQLCipher master key through a unified key resolution flow that supports both environment-provided keys and OS-managed keys without requiring the frontend to participate in unlock behavior.

#### Scenario: Environment key overrides other providers
- **WHEN** an explicit environment key is provided for the gateway runtime
- **THEN** the runtime MUST use that key as the authoritative database key and MUST fail startup if the database cannot be opened with it

#### Scenario: Desktop auto-bootstraps through OS key storage
- **WHEN** `Desktop` starts without an explicit environment key and no encrypted database exists yet
- **THEN** it SHALL generate a new database key, store it in the OS key provider, and initialize the encrypted catalog database without prompting the user for a password

#### Scenario: Service startup fails without any usable key source
- **WHEN** `Standalone Service` starts without an explicit environment key and no usable OS key is available for the configured database
- **THEN** it MUST fail startup rather than silently generating an unmanaged key

### Requirement: Gateway runtime SHALL execute schema initialization and migrations on startup
The gateway runtime SHALL run schema initialization and all pending database migrations after a master key has been resolved and validated, before serving configuration or proxy traffic.

#### Scenario: Apply initial schema on first startup
- **WHEN** the encrypted database is created for the first time
- **THEN** the runtime SHALL apply the initial migration set and make the configuration APIs available only after migration succeeds

#### Scenario: Upgrade an existing schema before serving traffic
- **WHEN** the encrypted database schema version is behind the current application version
- **THEN** the runtime SHALL apply pending migrations before handling configuration reads, configuration writes, or backend proxy selection

### Requirement: Standalone configuration APIs SHALL preserve their current frontend contract
The standalone configuration APIs SHALL continue to expose the same frontend-facing behavior after the storage layer is moved into SQLCipher, including hidden-password semantics and full server catalog editing.

#### Scenario: Read config without revealing saved passwords
- **WHEN** the frontend requests `__standalone__/config`
- **THEN** the response SHALL include server metadata and `hasPassword` state without returning stored password plaintext

#### Scenario: Save config while keeping an existing password
- **WHEN** the frontend updates a server entry without supplying a replacement password
- **THEN** the runtime SHALL preserve the existing stored password for that server while applying the other requested field updates

#### Scenario: Save config with a cleared password
- **WHEN** the frontend explicitly clears a saved password for a server
- **THEN** the runtime SHALL remove the stored password for that server and reflect that change through `hasPassword = false` in subsequent reads
