/**
 * Canvas Editor Service
 * Handles non-destructive cleanup operations
 */

export interface BrushSettings {
  size: number;
  opacity: number;
  hardness: number;
  color: string;
}

export interface CanvasState {
  baseImage: ImageData;
  brushHistory: ImageData[];
  historyIndex: number;
  currentBrushSettings: BrushSettings;
}

/**
 * Create a new canvas state from base image
 */
export const createCanvasState = (baseImage: ImageData): CanvasState => ({
  baseImage,
  brushHistory: [cloneImageData(baseImage)],
  historyIndex: 0,
  currentBrushSettings: {
    size: 20,
    opacity: 1,
    hardness: 0.8,
    color: '#000000',
  },
});

/**
 * Clone ImageData
 */
export const cloneImageData = (imageData: ImageData): ImageData => {
  const cloned = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  return cloned;
};

/**
 * Draw brush stroke on canvas
 */
export const drawBrushStroke = (
  source: ImageData,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  settings: BrushSettings
): ImageData => {
  const { ctx } = createWorkingCanvas(source);
  const { size, opacity, hardness, color } = settings;
  const rgb = hexToRgb(color);
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const step = Math.max(1, size / 4);
  const radius = size / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  for (let traveled = 0; traveled <= distance; traveled += step) {
    const progress = traveled / distance;
    const x = startX + dx * progress;
    const y = startY + dy * progress;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
    gradient.addColorStop(
      Math.max(0.01, hardness),
      `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * hardness})`
    );
    gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  return ctx.getImageData(0, 0, source.width, source.height);
};

/**
 * Draw eraser stroke
 */
export const drawEraserStroke = (
  source: ImageData,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  size: number,
  hardness: number
): ImageData => {
  const { ctx } = createWorkingCanvas(source);
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const step = Math.max(1, size / 4);
  const radius = size / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  for (let traveled = 0; traveled <= distance; traveled += step) {
    const progress = traveled / distance;
    const x = startX + dx * progress;
    const y = startY + dy * progress;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(Math.max(0.01, hardness), `rgba(0, 0, 0, ${hardness})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  return ctx.getImageData(0, 0, source.width, source.height);
};

/**
 * Sample color from image
 */
export const sampleColor = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): string => {
  const imageData = ctx.getImageData(x, y, 1, 1);
  const [r, g, b] = imageData.data;
  return rgbToHex(r, g, b);
};

/**
 * Apply undo
 */
export const undo = (state: CanvasState): CanvasState => {
  if (state.historyIndex > 0) {
    return {
      ...state,
      historyIndex: state.historyIndex - 1,
    };
  }
  return state;
};

/**
 * Apply redo
 */
export const redo = (state: CanvasState): CanvasState => {
  if (state.historyIndex < state.brushHistory.length - 1) {
    return {
      ...state,
      historyIndex: state.historyIndex + 1,
    };
  }
  return state;
};

/**
 * Add history entry
 */
export const addToHistory = (state: CanvasState, imageData: ImageData): CanvasState => {
  const newHistory = state.brushHistory.slice(0, state.historyIndex + 1);
  newHistory.push(cloneImageData(imageData));
  return {
    ...state,
    brushHistory: newHistory,
    historyIndex: newHistory.length - 1,
  };
};

/**
 * Get current canvas state
 */
export const getCurrentImageData = (state: CanvasState): ImageData => {
  return cloneImageData(state.brushHistory[state.historyIndex]);
};

const createWorkingCanvas = (
  source: ImageData
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.putImageData(cloneImageData(source), 0, 0);
  return { canvas, ctx };
};

/**
 * Utility functions
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b]
    .map((value) => {
      const hex = value.toString(16);
      return hex.length === 1 ? `0${hex}` : hex;
    })
    .join('')
    .toUpperCase();
};
