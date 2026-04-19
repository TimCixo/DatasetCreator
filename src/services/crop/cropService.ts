/**
 * Crop Service
 * Handles crop frame operations and validation
 */

import { CropFrame, AspectRatio, createCropFrame } from '../../types';
import { clampCropFrame, calculateCropDimensions } from '../../lib/utils';

/**
 * Validate crop frame against image bounds
 */
export const validateCropFrame = (
  frame: CropFrame,
  imageWidth: number,
  imageHeight: number
): CropFrame => {
  const clamped = clampCropFrame(
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    imageWidth,
    imageHeight
  );

  return {
    ...frame,
    ...clamped,
  };
};

/**
 * Create crop frame centered on image
 */
export const createCenteredCropFrame = (
  imageWidth: number,
  imageHeight: number,
  aspectRatio: AspectRatio,
  size: number = 0.8
): CropFrame => {
  const { width, height } = calculateCropDimensions(imageWidth, imageHeight, aspectRatio);

  // Scale to desired size
  const scaledWidth = Math.min(width, imageWidth) * size;
  const scaledHeight = scaledWidth / (width / height);

  const x = (imageWidth - scaledWidth) / 2;
  const y = (imageHeight - scaledHeight) / 2;

  return createCropFrame(x, y, scaledWidth, scaledHeight, aspectRatio);
};

/**
 * Move crop frame
 */
export const moveCropFrame = (
  frame: CropFrame,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number
): CropFrame => {
  const newFrame = { ...frame, x: frame.x + dx, y: frame.y + dy };
  return validateCropFrame(newFrame, imageWidth, imageHeight);
};

/**
 * Resize crop frame (maintaining aspect ratio)
 */
export const resizeCropFrame = (
  frame: CropFrame,
  newWidth: number,
  newHeight: number,
  imageWidth: number,
  imageHeight: number
): CropFrame => {
  // Ensure minimum size
  const minSize = 50;
  const width = Math.max(minSize, newWidth);
  const height = Math.max(minSize, newHeight);

  const newFrame = { ...frame, width, height };
  return validateCropFrame(newFrame, imageWidth, imageHeight);
};

/**
 * Resize from handle (corner/edge)
 */
export const resizeCropFrameFromHandle = (
  frame: CropFrame,
  handle: string, // 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number
): CropFrame => {
  let x = frame.x;
  let y = frame.y;
  let width = frame.width;
  let height = frame.height;

  const aspectRatio = width / height;

  switch (handle) {
    case 'tl':
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
      // Maintain aspect ratio
      height = width / aspectRatio;
      break;

    case 'tr':
      y += dy;
      width += dx;
      height -= dy;
      height = width / aspectRatio;
      break;

    case 'bl':
      x += dx;
      width -= dx;
      height += dy;
      height = width / aspectRatio;
      break;

    case 'br':
      width += dx;
      height += dy;
      height = width / aspectRatio;
      break;

    case 't':
      y += dy;
      height -= dy;
      break;

    case 'b':
      height += dy;
      break;

    case 'l':
      x += dx;
      width -= dx;
      break;

    case 'r':
      width += dx;
      break;
  }

  return validateCropFrame(
    { ...frame, x, y, width, height },
    imageWidth,
    imageHeight
  );
};

/**
 * Get all active crop frames for image
 */
export const getActiveCropFrames = (frames: CropFrame[]): CropFrame[] => {
  return frames.filter((f) => f.width > 0 && f.height > 0);
};

/**
 * Check if crop frames overlap significantly
 */
export const checkCropOverlap = (frame1: CropFrame, frame2: CropFrame): number => {
  const x_left = Math.max(frame1.x, frame2.x);
  const y_top = Math.max(frame1.y, frame2.y);
  const x_right = Math.min(frame1.x + frame1.width, frame2.x + frame2.width);
  const y_bottom = Math.min(frame1.y + frame1.height, frame2.y + frame2.height);

  if (x_right < x_left || y_bottom < y_top) {
    return 0;
  }

  const intersectArea = (x_right - x_left) * (y_bottom - y_top);
  const area1 = frame1.width * frame1.height;
  const area2 = frame2.width * frame2.height;
  const minArea = Math.min(area1, area2);

  return intersectArea / minArea;
};
