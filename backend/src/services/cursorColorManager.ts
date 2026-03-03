// 避免顏色過暗（難以辨識）或過亮（白背景上不可見）
const MIN_COLOR_BRIGHTNESS_SUM = 150
const MAX_COLOR_BRIGHTNESS_SUM = 450
const FALLBACK_NEUTRAL_COLOR = '#555555'

const PREDEFINED_COLORS = [
  '#E05252',
  '#2BA89E',
  '#2E8CB5',
  '#D16B3A',
  '#C24B8A',
  '#7B4BC2',
  '#3A8F5C',
  '#B5892E',
  '#8C3AB5',
  '#4A7DC2',
];

class CursorColorManager {
  private canvasColors: Map<string, Map<string, string>> = new Map();
  private canvasAvailable: Map<string, Set<string>> = new Map();

  private ensureCanvas(canvasId: string): { colors: Map<string, string>; available: Set<string> } {
    if (!this.canvasColors.has(canvasId)) {
      this.canvasColors.set(canvasId, new Map());
    }
    if (!this.canvasAvailable.has(canvasId)) {
      this.canvasAvailable.set(canvasId, new Set(PREDEFINED_COLORS));
    }
    return {
      colors: this.canvasColors.get(canvasId)!,
      available: this.canvasAvailable.get(canvasId)!,
    };
  }

  private toHexChannel(n: number): string {
    return n.toString(16).padStart(2, '0');
  }

  private fixOverflow(redChannel: number, greenChannel: number, blueChannel: number, overflow: number): [number, number, number] {
    if (redChannel >= greenChannel && redChannel >= blueChannel) return [Math.max(0, redChannel - overflow), greenChannel, blueChannel];
    if (greenChannel >= redChannel && greenChannel >= blueChannel) return [redChannel, Math.max(0, greenChannel - overflow), blueChannel];
    return [redChannel, greenChannel, Math.max(0, blueChannel - overflow)];
  }

  private fixDeficit(redChannel: number, greenChannel: number, blueChannel: number, deficit: number): [number, number, number] {
    if (redChannel <= greenChannel && redChannel <= blueChannel) return [Math.min(255, redChannel + deficit), greenChannel, blueChannel];
    if (greenChannel <= redChannel && greenChannel <= blueChannel) return [redChannel, Math.min(255, greenChannel + deficit), blueChannel];
    return [redChannel, greenChannel, Math.min(255, blueChannel + deficit)];
  }

  // 浮點精度安全檢查：Math.floor/ceil 仍可能因浮點誤差導致總和超出範圍
  private correctPrecision(r: number, g: number, b: number): [number, number, number] {
    const newSum = r + g + b;
    if (newSum > MAX_COLOR_BRIGHTNESS_SUM) {
      return this.fixOverflow(r, g, b, newSum - MAX_COLOR_BRIGHTNESS_SUM);
    }
    if (newSum < MIN_COLOR_BRIGHTNESS_SUM) {
      return this.fixDeficit(r, g, b, MIN_COLOR_BRIGHTNESS_SUM - newSum);
    }
    return [r, g, b];
  }

  private clampColor(hex: string): string {
    let redChannel = parseInt(hex.slice(1, 3), 16);
    let greenChannel = parseInt(hex.slice(3, 5), 16);
    let blueChannel = parseInt(hex.slice(5, 7), 16);
    const sum = redChannel + greenChannel + blueChannel;

    if (sum === 0) return FALLBACK_NEUTRAL_COLOR;
    if (sum >= MIN_COLOR_BRIGHTNESS_SUM && sum <= MAX_COLOR_BRIGHTNESS_SUM) return hex;

    const isOverflow = sum > MAX_COLOR_BRIGHTNESS_SUM;
    const factor = isOverflow ? MAX_COLOR_BRIGHTNESS_SUM / sum : MIN_COLOR_BRIGHTNESS_SUM / sum;
    const round = isOverflow ? Math.floor : Math.ceil;
    let clampedRed = Math.min(255, round(redChannel * factor));
    let clampedGreen = Math.min(255, round(greenChannel * factor));
    let clampedBlue = Math.min(255, round(blueChannel * factor));

    [clampedRed, clampedGreen, clampedBlue] = this.correctPrecision(clampedRed, clampedGreen, clampedBlue);

    return `#${this.toHexChannel(clampedRed)}${this.toHexChannel(clampedGreen)}${this.toHexChannel(clampedBlue)}`;
  }

  /**
   * 以 djb2 hash 演算法將連線 ID 映射為顏色，確保相同 ID 始終得到相同顏色。
   * hash 可為負數，但 bitwise AND 保證各 channel 皆在 [0, 255]。
   */
  private computeDjb2Hash(connectionId: string): string {
    let hash = 0;
    for (let i = 0; i < connectionId.length; i++) {
      hash = (hash << 5) - hash + connectionId.charCodeAt(i);
      hash |= 0;
    }
    const redChannel = (hash & 0xff0000) >> 16;
    const greenChannel = (hash & 0x00ff00) >> 8;
    const blueChannel = hash & 0x0000ff;
    const hex = `#${this.toHexChannel(redChannel)}${this.toHexChannel(greenChannel)}${this.toHexChannel(blueChannel)}`;
    return this.clampColor(hex);
  }

  assignColor(canvasId: string, connectionId: string): string {
    const { colors, available } = this.ensureCanvas(canvasId);

    if (colors.has(connectionId)) {
      return colors.get(connectionId)!;
    }

    if (available.size === 0) {
      const fallback = this.computeDjb2Hash(connectionId);
      colors.set(connectionId, fallback);
      return fallback;
    }

    const [firstAvailableColor] = available;
    available.delete(firstAvailableColor);
    colors.set(connectionId, firstAvailableColor);
    return firstAvailableColor;
  }

  releaseColor(canvasId: string, connectionId: string): void {
    const colors = this.canvasColors.get(canvasId);
    if (!colors) return;

    const color = colors.get(connectionId);
    if (!color) return;

    colors.delete(connectionId);

    if (PREDEFINED_COLORS.includes(color)) {
      this.canvasAvailable.get(canvasId)?.add(color);
    }

    if (colors.size === 0) {
      this.removeCanvas(canvasId);
    }
  }

  getColor(canvasId: string, connectionId: string): string | undefined {
    return this.canvasColors.get(canvasId)?.get(connectionId);
  }

  removeCanvas(canvasId: string): void {
    this.canvasColors.delete(canvasId);
    this.canvasAvailable.delete(canvasId);
  }
}

export const cursorColorManager = new CursorColorManager();
export { CursorColorManager };
