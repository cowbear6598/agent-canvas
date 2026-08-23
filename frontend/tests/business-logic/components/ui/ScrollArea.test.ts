import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ScrollBar from "@/components/ui/scroll-area/ScrollBar.vue";

const scrollbarStyles = readFileSync(
  resolve(process.cwd(), "src/assets/styles/doodle/scrollbar.css"),
  "utf8",
);

describe("ScrollArea", () => {
  it("垂直 track 具備不透出底層內容所需的隔離與裁切 class", () => {
    const wrapper = mount(ScrollBar, {
      global: {
        stubs: {
          ScrollAreaScrollbar: { template: "<div><slot /></div>" },
          ScrollAreaThumb: { template: "<div />" },
        },
      },
    });

    const track = wrapper.get("div");
    expect(track.classes()).toEqual(expect.arrayContaining([
      "doodle-scrollbar-track",
      "overflow-hidden",
      "z-10",
    ]));
  });

  it("thumb 不會對滾動定位的 transform 套用 transition", () => {
    const thumbRule = scrollbarStyles.match(/\.doodle-scrollbar-thumb\s*\{([^}]*)\}/)?.[1];

    expect(thumbRule).toBeDefined();
    expect(thumbRule).not.toContain("transition: all");
    expect(scrollbarStyles).not.toContain("transform: scale");
  });

  it("textarea 的原生 scrollbar track 不會透出底層文字", () => {
    const textareaTrackRule = scrollbarStyles.match(
      /\.doodle-textarea::\-webkit-scrollbar-track\s*\{([^}]*)\}/,
    )?.[1];

    expect(textareaTrackRule).toBeDefined();
    expect(textareaTrackRule).toContain("background: var(--card)");
    expect(textareaTrackRule).not.toContain("background: transparent");
  });
});
