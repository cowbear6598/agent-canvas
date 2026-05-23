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

## P3.A Secondary Audit Decisions

The P3.A audit compares `tests/test-inventory.json` with the current
`frontend/tests` tree before changing tests. Deleted inventory entries must stay
marked as deleted in the inventory until the next full rebaseline; new test
files must be classified before the item is considered complete.

Deleted in this audit because the remaining assertions only protected mock call
counts, helper wiring, or component plumbing without a standalone product rule:

- `tests/business-logic/components/settings/ManagedPluginModal.test.ts`
- `tests/business-logic/composables/websocket/useCanvasWebSocketAction.test.ts`
- `tests/business-logic/composables/websocket/useSendCanvasAction.test.ts`
- `tests/business-logic/composables/websocket/useWebSocketErrorHandler.test.ts`
- `tests/integration/websocket-api/createWebSocketRequest.test.ts`

Moved into userflow coverage because the behavior is valuable only when framed
as an observable workflow:

- `tests/userflows/canvas/canvasPodInteractionsFlow.test.ts`: F4/F6, pod
  popover close behavior and guarded file-drop interactions.
- `tests/userflows/canvas/podPluginPopoverFlow.test.ts`: F4/F6, plugin list
  refresh and local plugin selection stability while the user toggles a pod
  plugin.
- `tests/userflows/canvas/podThinkingFlow.test.ts`: F4/F6, visible thinking
  level fill follows the model's configured level order.
- `tests/userflows/canvas/thinkingPopoverFlow.test.ts`: F4/F6, thinking level
  choices present higher-effort options first.
- `tests/userflows/settings/opencodeSettingsFlow.test.ts`: F4/F6, restarting
  OpenCode reloads providers and promotes connected providers in the settings
  list.

Retained as business-rule coverage after removing low-value UI render checks:

- `tests/business-logic/stores/chat/opencodeErrorHandling.test.ts`: F4/F6,
  `opencode_auth_missing` backend messages remain system transcript messages
  containing the provider id and `opencode auth login` guidance.
- `tests/business-logic/composables/events/runEventHandlers.test.ts`: F6, run
  chat events update only the currently opened run chat and failed delete
  responses do not remove local runs.
- `tests/business-logic/stores/connectionGraphHelpers.test.ts`: F6, workflow
  role and running-state graph traversal rules remain independent of UI.
- `tests/business-logic/stores/connectionPayloadMappers.test.ts`: F6,
  connection payload defaults and event mapping preserve frontend connection
  state after websocket responses.

## P3.B Fallback Decisions

Frontend fallback handling is split into three categories:

- External boundary fallback stays at API, WebSocket, and integration edges when
  a backend or third-party response can be malformed, delayed, or unavailable.
- Legacy data fallback stays in normalizers when old saved canvas, provider, or
  MCP state may still exist in user data.
- Regular contract fallback is removed when the WebSocket/API schema already
  guarantees the field. In this audit, opencode alias list/reorder `items` now
  throws a zh-TW contract error if the backend omits the array instead of
  silently returning `[]`.

Retained fallback coverage:

- `tests/integration/websocket-api/opencodeApi.test.ts`: F5/F6, malformed
  opencode alias responses surface a user-visible contract error instead of
  hiding state loss behind an empty list.
- `tests/integration/websocket-api/managedMcpApi.test.ts`: F5/F6, unknown MCP
  runtime status remains visible as `unknown` because it represents an external
  process boundary, not an impossible product state.
