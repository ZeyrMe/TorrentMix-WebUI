## ADDED Requirements

### Requirement: Gateway SHALL retry qBittorrent proxy traffic once after forced re-authentication
When proxying qBittorrent traffic, the runtime SHALL treat a 403 response as a potentially expired cookie session and SHALL perform at most one forced re-login retry before returning the upstream result.

#### Scenario: Expired qB session is refreshed once
- **WHEN** a proxied qBittorrent request returns 403 Forbidden and valid credentials are configured for the selected server
- **THEN** the runtime MUST force a fresh qB login
- **AND** it MUST retry the original proxied request exactly once using the refreshed cookie

### Requirement: Gateway SHALL invalidate qB runtime sessions after config updates
Saving a new standalone configuration SHALL invalidate any cached qB runtime sessions so subsequent traffic uses the latest effective server directory and credentials.

#### Scenario: Config save clears cached qB sessions
- **WHEN** `__standalone__/config` successfully writes a new catalog configuration
- **THEN** the runtime MUST clear cached qB session state before serving later proxied qB traffic
- **AND** subsequent qB proxy requests MUST authenticate using the updated catalog state

### Requirement: Gateway proxy SHALL route traffic through the effective selected server
The shared proxy endpoints SHALL route `/api/*` and `/transmission/*` traffic according to the same effective selected server used by runtime selection logic.

#### Scenario: Proxy request uses the effective selected upstream
- **WHEN** a proxied request is received and the runtime resolves an effective selected server
- **THEN** the upstream request MUST be built from that selected server's base URL and credentials
- **AND** the runtime MUST NOT route the request to any other configured server
