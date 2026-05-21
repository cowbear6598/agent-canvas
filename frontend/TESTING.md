# Frontend Testing Policy

Frontend tests must prove product behavior through user-visible flows and the
state transitions that support those flows. New tests are allowed only when they
fit one of these categories:

1. Userflow tests: exercise real user actions such as operating pods on the
   canvas, sending messages, copying content, and pasting content. These tests
   should verify the workflow outcome and the store behavior that supports it.
2. Integration tests: verify boundaries between frontend modules or between the
   frontend and an in-process harness, including websocket request and response
   flows.
3. Business logic tests: cover parser, validator, or state-decision rules whose
   product behavior is valuable without rendering UI.

The test tree mirrors those categories:

- `tests/userflows/**`: user-visible workflows driven through real stores,
  mounted UI, fake websocket servers, or fake API servers.
- `tests/integration/**`: frontend contract boundaries such as websocket API
  request/response mapping and cache invalidation.
- `tests/business-logic/**`: deterministic product rules, validators, state
  transitions, and component behavior that does not need a full userflow.
- `tests/helpers/**` and `tests/setup.ts`: shared test infrastructure only.

Test names must describe the product rule or workflow being protected. A
passing test suite should confirm real usage paths, not isolated fragments of
markup.

Do not add tests whose only assertion value is one of the following:

- Pure UI render checks that only prove a component mounts or a text node exists
  without validating a userflow or product rule.
- Snapshot tests.
- Mock third-party SDK spy tests that only verify calls into a mocked SDK.
- Store initial field shape tests that only lock the default property list or
  default field values.

Allowed fake boundaries are limited to systems outside the frontend product
state:

- External API clients may be faked when the test verifies the frontend behavior
  around request inputs, success data, errors, and loading state.
- Websocket tests may use a websocket server harness. The client code should
  remain real, and the test should verify that received events update frontend
  state.

Use `tests/helpers/fakeWebSocketServer.ts` when a frontend test needs to prove a
websocket userflow with the real `websocketClient`. The harness accepts real
client connections, records client messages in the same `{ type, payload,
requestId }` shape sent to the backend, and emits backend-style response events
back to the browser client. Prefer it for request/response flows, broadcast
events, reconnect-adjacent client behavior, and store updates caused by received
events.

Use `tests/helpers/fakeApiServer.ts` for frontend API boundaries that are backed
by product HTTP contracts. Define fake routes by method and path, inspect the
request body or headers, and return the same success, error, status, header, or
binary response shape the backend API would return. Prefer this over mocking a
store action when the behavior under test depends on request payloads, loading
state, error handling, or response data mapping.

When adding a new userflow, keep expensive setup in shared helpers or factories
and prefer event-driven fake server responses over sleeps. If a delay is needed
to prove timeout behavior, use the shortest deterministic timer and document the
user-facing condition it represents.

Move coverage to a backend integration test when the behavior depends on backend
persistence, websocket handler routing, authentication/session cookies,
repository filesystem work, provider/SDK execution, or the exact interaction
between backend services. Frontend fake servers should stay deterministic,
in-process, and free of external network, credentials, and local user settings so
CI can run them reliably.

Do not mock product stores to claim a userflow has been verified. Userflow and
integration tests should use real product stores so failures identify the broken
workflow or state transition instead of a changed mock call count.
