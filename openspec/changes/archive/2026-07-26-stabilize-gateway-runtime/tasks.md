## 1. Selection Semantics

- [x] 1.1 Add Rust tests covering default-server fallback, unknown selection-cookie fallback, and successful `__standalone__/select` behavior.
- [x] 1.2 Verify that `__standalone__/status`, `__standalone__/select`, and proxied traffic all resolve the same effective selected server.
- [x] 1.3 Implement any required catalog/runtime fixes so removed or invalid selected servers fall back cleanly to the current default.

## 2. Proxy And Session Stability

- [x] 2.1 Add Rust tests for qB proxy 403 handling, ensuring the runtime forces re-authentication and retries exactly once.
- [x] 2.2 Add tests covering `__standalone__/config` updates clearing qB session caches and reloading runtime state.
- [x] 2.3 Implement any runtime fixes needed so proxied `/api/*` and `/transmission/*` requests always use the effective selected server's upstream and credentials.

## 3. Runtime Verification Guardrails

- [x] 3.1 Add or extend Rust-side verification for shared gateway runtime startup/selection/proxy paths without requiring full Tauri UI E2E.
- [x] 3.2 Update CI or release workflow so Rust runtime checks run before publish for gateway-based deployment forms.
- [x] 3.3 Update runtime-facing docs or maintainer notes to reflect the stabilized selection, retry, and verification semantics.
