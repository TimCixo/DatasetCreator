import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getAspectRatioDimensions = (width: number, height: number): '2:3' | '3:2' | '1:1' => {
  const ratio = width / height;
  if (ratio < 0.8) return '2:3';
  if (ratio > 1.2) return '3:2';
  return '1:1';
};

export const calculateCropDimensions = (
  containerWidth: number,
  containerHeight: number,
  aspectRatio: '2:3' | '3:2' | '1:1'
): { width: number; height: number } => {
  const ratios = { '2:3': 2/3, '3:2': 3/2, '1:1': 1 };
  const targetRatio = ratios[aspectRatio];
  
  const containerRatio = containerWidth / containerHeight;
  
  if (containerRatio > targetRatio) {
    const height = containerHeight;
    const width = height * targetRatio;
    return { width, height };
  } else {
    const width = containerWidth;
    const height = width / targetRatio;
    return { width, height };
  }
};

export const clampCropFrame = (
  x: number,
  y: number,
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { x: number; y: number; width: number; height: number } => {
  return {
    x: Math.max(0, Math.min(x, maxWidth - width)),
    y: Math.max(0, Math.min(y, maxHeight - height)),
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight),
  };
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const byteCharacters = atob(base64.split(',')[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
