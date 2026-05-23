import { describe, expect, it } from "vitest";
import { createPodDividerPath } from "@/lib/podDividerPath";

describe("createPodDividerPath", () => {
  it("相同 pod id 會產生穩定 path", () => {
    expect(createPodDividerPath("pod-1")).toBe(createPodDividerPath("pod-1"));
  });

  it("不同 pod id 會產生不同 path", () => {
    expect(createPodDividerPath("pod-1")).not.toBe(
      createPodDividerPath("pod-2"),
    );
  });

  it("輸出固定 20 段二次曲線，並維持 0 到 200 的端點規則", () => {
    const path = createPodDividerPath("pod-1");

    expect(path).toMatch(/^M0,\d+\.\d{2} Q5,\d+\.\d{2} 10,\d+\.\d{2}/);
    expect(path).toContain("Q195,");
    expect(path).toMatch(/ 200,\d+\.\d{2}$/);
    expect(path.match(/Q/g)).toHaveLength(20);
  });

  it("支援用較少段數產生可測試的小型 path", () => {
    expect(createPodDividerPath("pod-1", { segments: 2 })).toBe(
      "M0,3.10 Q5,0.94 10,3.00 Q15,4.97 20,2.85",
    );
  });
});
