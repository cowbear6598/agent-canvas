const DEFAULT_SEGMENTS = 20;
const DEFAULT_SEGMENT_WIDTH = 10;

export interface PodDividerPathOptions {
  segments?: number;
  segmentWidth?: number;
}

function hashPodIdToSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixedState = Math.imul(state ^ (state >>> 15), 1 | state);
    mixedState =
      (mixedState +
        Math.imul(mixedState ^ (mixedState >>> 7), 61 | mixedState)) ^
      mixedState;
    return ((mixedState ^ (mixedState >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 用 pod id 產生穩定的手繪分隔線 path。
 * 輸出座標對應 CanvasPod divider 的 viewBox：0 0 200 6。
 */
export function createPodDividerPath(
  podId: string,
  options: PodDividerPathOptions = {},
): string {
  const rng = createSeededRandom(hashPodIdToSeed(podId));
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const segmentWidth = options.segmentWidth ?? DEFAULT_SEGMENT_WIDTH;
  const parts: string[] = [];

  parts.push(`M0,${(2.7 + rng() * 0.6).toFixed(2)}`);

  for (let i = 0; i < segments; i++) {
    const ctrlX = i * segmentWidth + segmentWidth / 2;
    const endX = (i + 1) * segmentWidth;
    const isPeak = i % 2 === 0;
    const ctrlY = isPeak ? 0.2 + rng() * 0.9 : 4.9 + rng() * 0.9;
    const endY = 2.7 + rng() * 0.6;
    parts.push(`Q${ctrlX},${ctrlY.toFixed(2)} ${endX},${endY.toFixed(2)}`);
  }

  return parts.join(" ");
}
