vi.mock("../../src/services/scheduleService.js", () => ({
  scheduleService: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../../src/services/backupScheduleService.js", () => ({
  backupScheduleService: {
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("../../src/services/tmpCleanupService.js", () => ({
  tmpCleanupService: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../../src/services/memoryCleanupService.js", () => ({
  memoryCleanupService: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    list: vi.fn(() => [{ id: "default-canvas" }]),
    create: vi.fn(async () => ({ success: true, data: undefined })),
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    appDataRoot: "/tmp/agent-canvas-test/app",
    canvasRoot: "/tmp/agent-canvas-test/canvas",
    repositoriesRoot: "/tmp/agent-canvas-test/repositories",
    runRepositoriesRoot: "/tmp/agent-canvas-test/runtime/run-repositories",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/integration/index.js", () => ({
  integrationRegistry: {
    list: vi.fn(() => []),
  },
  integrationAppStore: {
    list: vi.fn(() => []),
  },
}));

vi.mock("../../src/database/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../src/services/encryptionService.js", () => ({
  encryptionService: {
    initializeKey: vi.fn(async () => undefined),
  },
}));

vi.mock("../../src/services/runtime/orphanRunRepoScanner.js", () => ({
  scanAndCleanupOrphanRunRepoDirectories: vi.fn(),
}));

vi.mock("../../src/services/mcp/managedMcpRuntimeService.js", () => ({
  managedMcpRuntimeService: {
    restoreInitialStatuses: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { startupService } from "../../src/services/startupService.js";
import { scanAndCleanupOrphanRunRepoDirectories } from "../../src/services/runtime/orphanRunRepoScanner.js";
import { memoryCleanupService } from "../../src/services/memoryCleanupService.js";

const mockScanAndCleanup = vi.mocked(scanAndCleanupOrphanRunRepoDirectories);
const mockMemoryCleanupStart = vi.mocked(memoryCleanupService.start);

describe("startupService.initialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("孤兒 run repo 清理很慢時，initialize 不應等待清理完成", async () => {
    mockScanAndCleanup.mockImplementation(
      () => new Promise<void>(() => undefined),
    );

    const result = await startupService.initialize();
    await Promise.resolve();

    expect(result.success).toBe(true);
    expect(mockScanAndCleanup).toHaveBeenCalledTimes(1);
    expect(mockMemoryCleanupStart).toHaveBeenCalledTimes(1);
  });
});
