import {
  createTestServer,
  type TestServerInstance,
} from './testServer.js';
import { createSocketClient, type TestWebSocketClient } from './socketClient.js';
import { createTestCleanupRegistry } from './testResourceCleanup.js';

export function setupIntegrationTest() {
  let server: TestServerInstance;
  let client: TestWebSocketClient;
  const cleanup = createTestCleanupRegistry();

  beforeAll(async () => {
    server = await createTestServer();
    cleanup.addDatabaseConnection();
    cleanup.addDatabaseRows();
    cleanup.addServer(server);

    client = await createSocketClient(server.baseUrl, server.canvasId);
    cleanup.addSocket(client);
  });

  afterAll(async () => {
    await cleanup.cleanup();
  });

  return {
    getServer: () => server,
    getClient: () => client,
    cleanup,
  };
}
