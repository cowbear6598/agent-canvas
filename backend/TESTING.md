# Backend Testing Policy

Backend tests must prove product behavior through flows that match how the
server is used. Tests live in one of four product-facing categories:

- `tests/userflows`: end-to-end user actions that cross API, WebSocket,
  service, filesystem, or database boundaries.
- `tests/integration`: one backend boundary exercised through the real
  implementation, such as an HTTP route, WebSocket route, filesystem side
  effect, or shared store behavior.
- `tests/database`: schema, migration, cascade, uniqueness, and persistence
  rules that need direct database assertions.
- `tests/business-logic`: focused parser, validator, normalizer,
  error-classifier, prompt-builder, path-safety, and workflow decision rules.

`tests/helpers` and `tests/setup` are shared test infrastructure, not behavior
categories. Do not add new behavior tests under module-oriented names such as
`unit`, `services`, `provider`, `handlers`, `utils`, or `api`.

New tests are allowed only when they fit one of these coverage types:

1. API integration tests: exercise HTTP routes through the real application
   server and verify the API-to-service behavior, response contract,
   persistence, and file side effects that a user action depends on.
2. WebSocket integration tests: exercise the real WebSocket server with a real
   WebSocket client and verify the request, emitted events, and resulting
   frontend-observable state changes for canvas, pod, chat, run, and workflow
   flows.
3. Filesystem integration tests: write to a test-owned temporary directory when
   the product rule depends on path safety, attachment output, repository
   layout, archive creation, cleanup, or other real file side effects.
4. Database integration tests: use the test database when the product rule
   depends on persisted rows, relations, migrations, uniqueness, cascade
   behavior, or API/service behavior that must survive a database round trip.
5. Business logic tests: keep focused pure tests for high-value parser,
   validator, normalizer, error-classifier, prompt-builder, path-safety, and
   workflow/state decision rules that are valuable without starting the server.

Test names must describe the product rule or workflow being protected. A
passing backend suite should confirm flows such as creating pods, starting chat,
triggering workflows, persisting data, and writing files without depending on a
developer's local credentials, local user config, or external network access.

Filesystem tests must use the shared temp harness. Test data is created under
repo-local `tmp/AgentCanvas`, with each test receiving an isolated subdirectory.
The global setup removes `tmp/AgentCanvas` after the suite, so filesystem tests
must not write to `~/Documents/AgentCanvas`, the real plugin directory, or any
developer-specific path. When adding filesystem coverage, verify the product
side effect and let the harness clean up the directory.

Integration tests should reuse the shared harnesses in `tests/helpers`:

- API flows use `createApiIntegrationHarness` so requests pass through the real
  server wiring and schema validation.
- WebSocket flows use `createWebSocketIntegrationHarness` and assert received
  events instead of internal emit calls.
- Database flows use `createTestDatabaseHarness` or the suite database setup,
  then assert persisted rows and round trips.
- Filesystem flows use `createTempDir` or `createTestWorkspaceHarness`, both of
  which allocate paths below `tmp/AgentCanvas`.

Keep integration setup cheap and deterministic. Prefer shared harness setup over
per-test server bootstrapping, avoid long sleeps by awaiting events or explicit
promises, and fake only third-party boundaries that would require network,
credentials, slow external processes, or unsafe remote state.

Allowed fake boundaries are limited to systems outside the backend product
state:

- Fake Claude, Codex, and opencode providers when the test verifies provider
  request construction, streaming behavior, cancellation, normalized output, or
  user-facing error messages without requiring real provider credentials.
- Fake Sentry, Slack, Jira, Telegram, and other third-party integration services
  when the test verifies local auth handling, payload normalization, resource
  mapping, retry/error behavior, and websocket or API responses around those
  integrations.
- Fake git remotes when the product rule depends on remote availability,
  authentication failure, clone/pull/fetch responses, or remote branch state.
- Fake the git executable when the test verifies command construction, exit
  status handling, stderr mapping, timeout behavior, or a failure mode that
  would be slow or unsafe to produce with a real executable.

Fakes should be explicit test harnesses or adapter-level stubs that return
product-shaped data. They should not reduce the assertion to checking that a
mock function was called.

Do not claim an integration test when one of the integration boundaries was
mocked away:

- Do not mock filesystem APIs and call the result a filesystem integration
  test. Use a temporary directory and verify the actual files, directories, and
  path-safety outcomes.
- Do not mock the database, stores, statements, or persistence layer and call
  the result a database integration test. Use the test database and verify the
  persisted data or migration behavior.
- Do not mock WebSocket handlers, the socket service, or emit functions and call
  the result a WebSocket integration test. Use the real WebSocket server, a real
  WebSocket client, and verify the events received by the client.

Tests that mock these boundaries can still be useful business logic or adapter
tests, but their names and placement must not describe them as integration
coverage.
