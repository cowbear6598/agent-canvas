/**
 * #32 — Provider metadata 一致性驗證
 *
 * 驗證 providerRegistry 中每個 provider 的 metadata.availableModels
 * 與 metadata.availableModelValues 的一致性。
 *
 * capabilities.test.ts 直接測試常數（CLAUDE_AVAILABLE_MODELS 等），
 * 此檔測試 provider 實例的 metadata 欄位是否與這些常數正確綁定，
 * 兩者角度不同，不構成重複。
 */

import { describe, it, expect } from "vitest";
import { providerRegistry } from "../../src/services/provider/index.js";
import {
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
} from "../../src/services/provider/capabilities.js";
import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
} from "../../src/services/provider/capabilities.js";

describe("providerRegistry metadata 一致性", () => {
  describe("claudeProvider.metadata.availableModels", () => {
    const { metadata } = providerRegistry.claude;

    it("應與 CLAUDE_AVAILABLE_MODELS 相同", () => {
      expect(metadata.availableModels).toEqual(CLAUDE_AVAILABLE_MODELS);
    });

    it("availableModelValues 應與 CLAUDE_AVAILABLE_MODEL_VALUES 相同", () => {
      expect(metadata.availableModelValues).toEqual(
        CLAUDE_AVAILABLE_MODEL_VALUES,
      );
    });

    it("每個 availableModels 的 value 都在 availableModelValues 中", () => {
      for (const model of metadata.availableModels) {
        expect(metadata.availableModelValues.has(model.value)).toBe(true);
      }
    });

    it("availableModelValues 的大小與 availableModels 長度一致", () => {
      expect(metadata.availableModelValues.size).toBe(
        metadata.availableModels.length,
      );
    });

    it("每個 model 都有非空的 label 與 value", () => {
      for (const model of metadata.availableModels) {
        expect(typeof model.label).toBe("string");
        expect(model.label.length).toBeGreaterThan(0);
        expect(typeof model.value).toBe("string");
        expect(model.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("codexProvider.metadata.availableModels", () => {
    const { metadata } = providerRegistry.codex;

    it("應與 CODEX_AVAILABLE_MODELS 相同", () => {
      expect(metadata.availableModels).toEqual(CODEX_AVAILABLE_MODELS);
    });

    it("availableModelValues 應與 CODEX_AVAILABLE_MODEL_VALUES 相同", () => {
      expect(metadata.availableModelValues).toEqual(
        CODEX_AVAILABLE_MODEL_VALUES,
      );
    });

    it("每個 availableModels 的 value 都在 availableModelValues 中", () => {
      for (const model of metadata.availableModels) {
        expect(metadata.availableModelValues.has(model.value)).toBe(true);
      }
    });

    it("availableModelValues 的大小與 availableModels 長度一致", () => {
      expect(metadata.availableModelValues.size).toBe(
        metadata.availableModels.length,
      );
    });

    it("每個 model 都有非空的 label 與 value", () => {
      for (const model of metadata.availableModels) {
        expect(typeof model.label).toBe("string");
        expect(model.label.length).toBeGreaterThan(0);
        expect(typeof model.value).toBe("string");
        expect(model.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("所有已登記 provider 的 metadata 結構完整性", () => {
    it("每個 provider 都應有 name、capabilities、defaultOptions、availableModels、availableModelValues", () => {
      for (const [key, provider] of Object.entries(providerRegistry)) {
        expect(provider.metadata.name).toBe(key);
        expect(provider.metadata.capabilities).toBeDefined();
        expect(provider.metadata.defaultOptions).toBeDefined();
        expect(Array.isArray(provider.metadata.availableModels)).toBe(true);
        expect(provider.metadata.availableModelValues).toBeInstanceOf(Set);
      }
    });
  });
});
