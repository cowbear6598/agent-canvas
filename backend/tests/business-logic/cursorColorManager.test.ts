import { CursorColorManager } from '../../src/services/cursorColorManager.js';

describe('CursorColorManager', () => {
  let manager: CursorColorManager;

  beforeEach(() => {
    manager = new CursorColorManager();
  });

  describe('assignColor', () => {
    it('分配顏色後 getColor 可取得', () => {
      manager.assignColor('canvas-1', 'conn-1');
      const color = manager.getColor('canvas-1', 'conn-1');
      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });

    it('同 Canvas 兩個連線拿到不同顏色', () => {
      const color1 = manager.assignColor('canvas-1', 'conn-1');
      const color2 = manager.assignColor('canvas-1', 'conn-2');
      expect(color1).not.toBe(color2);
    });

    it('對同一連線重複呼叫回傳相同顏色', () => {
      const color1 = manager.assignColor('canvas-1', 'conn-1');
      const color2 = manager.assignColor('canvas-1', 'conn-1');
      expect(color1).toBe(color2);
    });

    it('超過預定義顏色數量時仍能分配（fallback）', () => {
      for (let i = 0; i < 11; i++) {
        const color = manager.assignColor('canvas-1', `conn-${i}`);
        expect(color).toBeDefined();
        expect(typeof color).toBe('string');
      }
    });

    it('不同 Canvas 之間的顏色互相獨立', () => {
      const color1 = manager.assignColor('canvas-1', 'conn-1');
      const color2 = manager.assignColor('canvas-2', 'conn-1');
      expect(color1).toBe(color2);
    });
  });

  describe('releaseColor', () => {
    it('釋放後顏色回到可用池', () => {
      const color1 = manager.assignColor('canvas-1', 'conn-1');
      manager.releaseColor('canvas-1', 'conn-1');

      const color2 = manager.assignColor('canvas-1', 'conn-2');
      expect(color2).toBe(color1);
    });

    it('fallback 顏色釋放後不會回到可用池', () => {
      // 耗盡 10 個預定義顏色
      for (let i = 0; i < 10; i++) {
        manager.assignColor('canvas-1', `conn-${i}`);
      }

      // 第 11 個連線取得 fallback 顏色
      const fallbackColor = manager.assignColor('canvas-1', 'conn-10');

      // 釋放第 11 個連線
      manager.releaseColor('canvas-1', 'conn-10');

      // 釋放一個預定義顏色，讓 available pool 有空間，確保下一個分配不受池空影響
      manager.releaseColor('canvas-1', 'conn-0');

      // 第 12 個連線不應拿到 fallback 顏色（應從可用池拿預定義顏色）
      const nextColor = manager.assignColor('canvas-1', 'conn-11');
      expect(nextColor).not.toBe(fallbackColor);
    });

    it('釋放不存在的連線不報錯', () => {
      expect(() => {
        manager.releaseColor('canvas-1', 'nonexistent-conn');
      }).not.toThrow();
    });

    it('釋放後 getColor 回傳 undefined', () => {
      manager.assignColor('canvas-1', 'conn-1');
      manager.releaseColor('canvas-1', 'conn-1');
      expect(manager.getColor('canvas-1', 'conn-1')).toBeUndefined();
    });
  });

  describe('getColor', () => {
    it('未分配時回傳 undefined', () => {
      expect(manager.getColor('canvas-1', 'conn-1')).toBeUndefined();
    });

    it('不存在的 Canvas 回傳 undefined', () => {
      expect(manager.getColor('nonexistent-canvas', 'conn-1')).toBeUndefined();
    });
  });

  describe('removeCanvas', () => {
    it('清除後所有連線的顏色都消失', () => {
      manager.assignColor('canvas-1', 'conn-1');
      manager.assignColor('canvas-1', 'conn-2');
      manager.removeCanvas('canvas-1');

      expect(manager.getColor('canvas-1', 'conn-1')).toBeUndefined();
      expect(manager.getColor('canvas-1', 'conn-2')).toBeUndefined();
    });

    it('清除不存在的 Canvas 不報錯', () => {
      expect(() => {
        manager.removeCanvas('nonexistent-canvas');
      }).not.toThrow();
    });

    it('清除後可重新分配顏色', () => {
      const color1 = manager.assignColor('canvas-1', 'conn-1');
      manager.removeCanvas('canvas-1');

      const color2 = manager.assignColor('canvas-1', 'conn-2');
      expect(color2).toBe(color1);
    });
  });

  describe('顏色亮度保證', () => {
    const parseRgbSum = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return r + g + b;
    };

    it('所有預定義顏色 RGB 總和不超過 450', () => {
      for (let i = 0; i < 10; i++) {
        const color = manager.assignColor('canvas-1', `conn-${i}`);
        expect(parseRgbSum(color)).toBeLessThanOrEqual(450);
      }
    });

    it('所有預定義顏色 RGB 總和不低於 150', () => {
      for (let i = 0; i < 10; i++) {
        const color = manager.assignColor('canvas-1', `conn-${i}`);
        expect(parseRgbSum(color)).toBeGreaterThanOrEqual(150);
      }
    });

    it('hashColor fallback 顏色 RGB 總和不超過 450', () => {
      // 耗盡 10 個預定義顏色
      for (let i = 0; i < 10; i++) {
        manager.assignColor('canvas-1', `conn-${i}`);
      }

      for (let i = 10; i < 30; i++) {
        const color = manager.assignColor('canvas-1', `conn-${i}`);
        expect(parseRgbSum(color)).toBeLessThanOrEqual(450);
      }
    });

    it('hashColor 極端輸入仍回傳合法 hex 且亮度受限', () => {
      // 耗盡預定義池
      for (let i = 0; i < 10; i++) {
        manager.assignColor('canvas-1', `conn-${i}`);
      }

      const extremeIds = ['', '12345678', 'a'.repeat(1000)];
      for (const id of extremeIds) {
        const color = manager.assignColor('canvas-1', id);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        expect(parseRgbSum(color)).toBeLessThanOrEqual(450);
      }
    });

    it('hashColor fallback 顏色 RGB 總和不低於 150', () => {
      // 耗盡 10 個預定義顏色
      for (let i = 0; i < 10; i++) {
        manager.assignColor('canvas-1', `conn-${i}`);
      }

      for (let i = 10; i < 30; i++) {
        const color = manager.assignColor('canvas-1', `conn-${i}`);
        expect(parseRgbSum(color)).toBeGreaterThanOrEqual(150);
      }
    });
  });
});
