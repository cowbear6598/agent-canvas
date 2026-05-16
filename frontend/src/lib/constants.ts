export const POD_MENU_X_OFFSET = 112;
export const POD_MENU_Y_OFFSET = 50;
export const HEADER_HEIGHT = 64;

export const MAX_MESSAGE_LENGTH = 10000;

export const TEXTAREA_MAX_HEIGHT = 124;

export const DEFAULT_POD_ROTATION_RANGE = 2;
export const MAX_POD_NAME_LENGTH = 50;

export const MOUSE_BUTTON = { LEFT: 0, MIDDLE: 1, RIGHT: 2 } as const;

export const GRID_SIZE = 20;

export const POD_WIDTH = 224;
/** Pod 視覺高度（與 .pod-doodle 的 min-height 同步；移除小螢幕後縮為 112） */
export const POD_HEIGHT = 112;

export const NOTE_WIDTH = 80;
export const NOTE_HEIGHT = 30;

export const PASTE_TIMEOUT_MS = 10000;

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
/** 單一 ContentBlock base64Data 大小上限（5 MB decoded） */
export const MAX_CONTENT_BLOCK_SIZE_BYTES = 5 * 1024 * 1024;
/** 所有 ContentBlock base64Data 加總大小上限（20 MB decoded） */
export const MAX_CONTENT_BLOCKS_TOTAL_BYTES = 20 * 1024 * 1024;
/** 單檔大小上限 10 MB */
export const MAX_POD_DROP_FILE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export const MAX_IMAGES_PER_DROP = 1;

export const RADIANS_TO_DEGREES = 180 / Math.PI;
export const DEGREES_TO_RADIANS = Math.PI / 180;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

export const DEFAULT_TOAST_DURATION_MS = 3000;
export const SHORT_TOAST_DURATION_MS = 2000;

export const PROGRESS_REMOVE_DELAY_MS = 1000;
export const PROGRESS_REMOVE_DELAY_ON_ERROR_MS = 2000;

export const RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH = 40;
export const RUN_RESPONSE_SUMMARY_LENGTH = 60;
export const MAX_RUNS_PER_CANVAS = 30;

// === 畫布互動常數 ===
/** 觸控板捏合縮放靈敏度因子（macOS 觸控板捏合 delta 較大，需除以更大的數；調高可增加靈敏度） */
export const ZOOM_PINCH_FACTOR_MAC = 15;
export const ZOOM_PINCH_FACTOR_DEFAULT = 1;

/** wheel deltaMode 對應的基礎係數 */
/** 正常滾一格（deltaY≈100）約 5.7%，搭配 clamp 避免大力滾動爆衝 */
export const WHEEL_DELTA_PIXEL_FACTOR = 0.0008;
export const WHEEL_DELTA_LINE_FACTOR = 0.05;
export const WHEEL_DELTA_PAGE_FACTOR = 1;

/** Firefox line mode 下每行對應的 px 數 */
export const WHEEL_LINE_TO_PX = 20;
