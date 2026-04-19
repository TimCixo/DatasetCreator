/**
 * Image processing utilities
 * Handles loading, resizing, and basic image operations
 */

export interface ImageInfo {
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Load image dimensions from blob
 */
export const getImageDimensions = (blob: Blob): Promise<ImageInfo> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        mimeType: blob.type || 'image/jpeg',
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
};

/**
 * Create thumbnail blob from image blob
 */
export const createThumbnail = async (
  blob: Blob,
  maxSize: number = 256
): Promise<Blob> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio = img.naturalWidth / img.naturalHeight;

        if (ratio > 1) {
          canvas.width = maxSize;
          canvas.height = Math.round(maxSize / ratio);
        } else {
          canvas.height = maxSize;
          canvas.width = Math.round(maxSize * ratio);
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create thumbnail'));
          },
          'image/jpeg',
          0.8
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail'));
    };

    img.src = url;
  });
};

/**
 * Crop image blob to specified dimensions
 */
export const cropImage = async (
  blob: Blob,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<Blob> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to crop image'));
          },
          'image/png'
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for cropping'));
    };

    img.src = url;
  });
};

/**
 * Flip image horizontally or vertically
 */
export const flipImage = async (
  blob: Blob,
  horizontal: boolean = false,
  vertical: boolean = false
): Promise<Blob> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.save();

        if (horizontal) {
          ctx.scale(-1, 1);
          ctx.translate(-canvas.width, 0);
        }

        if (vertical) {
          ctx.scale(1, -1);
          ctx.translate(0, -canvas.height);
        }

        ctx.drawImage(img, 0, 0);
        ctx.restore();

        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to flip image'));
          },
          'image/png'
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for flipping'));
    };

    img.src = url;
  });
};

/**
 * Rotate image by specified degrees
 */
export const rotateImage = async (
  blob: Blob,
  degrees: number
): Promise<Blob> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        const rad = (degrees * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const newWidth = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
        const newHeight = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));

        canvas.width = newWidth;
        canvas.height = newHeight;

        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(rad);
        ctx.drawImage(img, -w / 2, -h / 2);

        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to rotate image'));
          },
          'image/png'
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for rotation'));
    };

    img.src = url;
  });
};

/**
 * Apply gradient map to image (for color augmentation)
 */
export const applyGradientMap = async (
  blob: Blob,
  fromColor: string,
  toColor: string
): Promise<Blob> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Parse colors
        const from = hexToRgb(fromColor);
        const to = hexToRgb(toColor);

        if (!from || !to) {
          throw new Error('Invalid color format');
        }

        // Apply gradient map (convert to grayscale, then map through gradient)
        for (let i = 0; i < data.length; i += 4) {
          const gray = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;

          data[i] = Math.round(from.r + (to.r - from.r) * gray);
          data[i + 1] = Math.round(from.g + (to.g - from.g) * gray);
          data[i + 2] = Math.round(from.b + (to.b - from.b) * gray);
        }

        ctx.putImageData(imageData, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to apply gradient map'));
          },
          'image/png'
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for gradient map'));
    };

    img.src = url;
  });
};

/**
 * Utility to convert hex color to RGB
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

/**
 * Convert blob to canvas ImageData
 */
export const blobToImageData = async (blob: Blob): Promise<ImageData> => {
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        URL.revokeObjectURL(url);
        resolve(imageData);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
};

/**
 * Convert ImageData to blob
 */
export const imageDataToBlob = (imageData: ImageData): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert ImageData to blob'));
      },
      'image/png'
    );
  });
};
