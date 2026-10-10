## ADDED Requirements

### Requirement: Gateway runtime SHALL derive one effective upstream selection for status and proxy traffic
The shared `gateway` runtime SHALL use the same effective server-selection algorithm for `__standalone__/status`, `__standalone__/select`, and proxied upstream traffic.

#### Scenario: Missing selection cookie falls back to the configured default server
- **WHEN** a request arrives without a valid `tm_server_id` cookie and the catalog contains a default server
- **THEN** the runtime MUST use the default server as the effective upstream selection
- **AND** `__standalone__/status` MUST report that default server as the effective `selectedId`

#### Scenario: Unknown selection cookie falls back instead of failing selection
- **WHEN** a request carries a `tm_server_id` cookie that does not match any current catalog entry
- **THEN** the runtime MUST ignore that cookie value
- **AND** it MUST fall back to the current default server when one exists

### Requirement: Standalone selection API SHALL only persist known server IDs
The `__standalone__/select` API SHALL accept only server IDs that exist in the current catalog and SHALL persist successful selections for subsequent runtime traffic.

#### Scenario: Selecting a known server updates subsequent effective selection
- **WHEN** the frontend posts a valid server ID to `__standalone__/select`
- **THEN** the runtime MUST return success
- **AND** it MUST set the selection cookie so later status and proxy requests resolve to that server

#### Scenario: Selecting an unknown server is rejected
- **WHEN** the frontend posts a server ID that does not exist in the current catalog
- **THEN** the runtime MUST reject the request
- **AND** it MUST NOT update the effective selection

### Requirement: Configuration changes SHALL leave runtime selection in a valid state
After configuration updates, the runtime SHALL continue operating with a valid effective server selection even when the previously selected server is removed or replaced.

#### Scenario: Removed selected server falls back to the new default
- **WHEN** the current selection cookie references a server that is removed by a later config update
- **THEN** the runtime MUST stop routing requests to the removed server
- **AND** it MUST fall back to the updated default server when one exists
