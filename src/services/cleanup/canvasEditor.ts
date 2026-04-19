/**
 * Canvas Editor Service
 * Handles non-destructive cleanup operations
 */

export interface BrushSettings {
  size: number;
  opacity: number;
  hardness: number; // 0 = soft, 1 = hard
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
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  settings: BrushSettings
): ImageData => {
  const { size, opacity, hardness, color } = settings;
  const rgb = hexToRgb(color);

  // Use composite operation for better blending
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';

  // Create brush gradient for soft brush
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${hardness})`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

  ctx.strokeStyle = gradient;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * Draw eraser stroke
 */
export const drawEraserStroke = (
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  size: number,
  hardness: number
): ImageData => {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${hardness})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.strokeStyle = gradient;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
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
 * Get current canvas state (for display)
 */
export const getCurrentImageData = (state: CanvasState): ImageData => {
  return cloneImageData(state.brushHistory[state.historyIndex]);
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
  return '#' + [r, g, b].map((x) => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
};
