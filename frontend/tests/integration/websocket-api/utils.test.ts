import { describe, it, expect, vi, afterEach } from "vitest";
import { generateUUID } from "@/services/utils";

describe("services/utils", () => {
  describe("generateUUID", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("產生符合 UUID 格式的字串", () => {
      vi.spyOn(global.crypto, "randomUUID").mockReturnValue(
        "a1b2c3d4-e5f6-4789-8abc-def012345678",
      );

      const uuid = generateUUID();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(uuid).toMatch(uuidRegex);
    });

    it("當 crypto.randomUUID 不存在時使用 getRandomValues fallback", () => {
      const mockGetRandomValues = vi.fn((array: Uint8Array) => {
        array[0] = 15;
        return array;
      });

      vi.stubGlobal("crypto", {
        getRandomValues: mockGetRandomValues,
      });

      const uuid = generateUUID();

      expect(mockGetRandomValues).toHaveBeenCalled();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      vi.unstubAllGlobals();
    });

    it("fallback 產生的 UUID 符合版本 4 格式", () => {
      vi.stubGlobal("crypto", {
        getRandomValues: (array: Uint8Array) => {
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 16);
          }
          return array;
        },
      });

      const uuid = generateUUID();
      const parts = uuid.split("-");

      expect(parts[2]![0]).toBe("4");
      expect(["8", "9", "a", "b"]).toContain(parts[3]![0]);

      vi.unstubAllGlobals();
    });
  });
});
