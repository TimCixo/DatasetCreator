/**
 * Augmentation Service
 * Generates dataset variants through various transformations
 */

import {
  flipImage,
  rotateImage,
  applyGradientMap,
} from '../image/imageProcessor';
import { AugmentationConfig, AspectRatio } from '../../types';

/**
 * Seeded random number generator for reproducible results
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Apply flip augmentation
 */
export const applyFlipAugmentation = async (
  blob: Blob,
  horizontal: boolean = true,
  vertical: boolean = false
): Promise<Blob> => {
  return flipImage(blob, horizontal, vertical);
};

/**
 * Apply color augmentation (gradient map)
 */
export const applyColorAugmentation = async (
  blob: Blob,
  fromColor: string,
  toColor: string
): Promise<Blob> => {
  return applyGradientMap(blob, fromColor, toColor);
};

/**
 * Apply rotation augmentation
 */
export const applyRotationAugmentation = async (
  blob: Blob,
  degrees: number
): Promise<Blob> => {
  return rotateImage(blob, degrees);
};

/**
 * Generate rotation variants with seed
 */
export const generateRotationVariants = (
  maxDegrees: number,
  numVariants: number,
  seed: number
): number[] => {
  const rng = new SeededRandom(seed);
  const variants: number[] = [];

  for (let i = 0; i < numVariants; i++) {
    const degrees = rng.range(-maxDegrees, maxDegrees);
    variants.push(degrees);
  }

  return variants;
};

/**
 * Apply augmentation config to image
 */
export const applyAugmentation = async (
  blob: Blob,
  config: AugmentationConfig
): Promise<Blob> => {
  let result = blob;

  switch (config.type) {
    case 'flip_h':
      result = await applyFlipAugmentation(result, true, false);
      break;

    case 'flip_v':
      result = await applyFlipAugmentation(result, false, true);
      break;

    case 'color':
      if (config.colorGradient) {
        result = await applyColorAugmentation(
          result,
          config.colorGradient.from,
          config.colorGradient.to
        );
      }
      break;

    case 'rotate':
      if (config.rotationDegrees !== undefined) {
        result = await applyRotationAugmentation(result, config.rotationDegrees);
      }
      break;
  }

  return result;
};

/**
 * Generate augmentation variants with configs
 */
export const generateAugmentationConfigs = (
  baseConfig: AugmentationConfig,
  selectedImages: string[],
  augmentationType: AugmentationConfig['type']
): AugmentationConfig[] => {
  const configs: AugmentationConfig[] = [];

  switch (augmentationType) {
    case 'flip_h':
      configs.push({ type: 'flip_h' });
      break;

    case 'flip_v':
      configs.push({ type: 'flip_v' });
      break;

    case 'color': {
      const colorVariations = [
        { from: '#ff0000', to: '#0000ff' },
        { from: '#00ff00', to: '#ff00ff' },
        { from: '#0000ff', to: '#ffff00' },
        { from: '#ffffff', to: '#000000' },
        { from: '#ff6600', to: '#00ff99' },
      ];

      colorVariations.forEach((gradient) => {
        configs.push({
          type: 'color',
          colorGradient: gradient,
        });
      });
      break;
    }

    case 'rotate': {
      if (baseConfig.rotationVariants && baseConfig.rotationSeed !== undefined) {
        const rotations = generateRotationVariants(
          baseConfig.rotationDegrees || 15,
          baseConfig.rotationVariants,
          baseConfig.rotationSeed
        );

        rotations.forEach((degrees) => {
          configs.push({
            type: 'rotate',
            rotationDegrees: degrees,
            rotationSeed: baseConfig.rotationSeed,
          });
        });
      }
      break;
    }
  }

  return configs;
};

/**
 * Generate deterministic seed from image data
 */
export const generateSeedFromImage = (imageId: string): number => {
  let hash = 0;
  for (let i = 0; i < imageId.length; i++) {
    const char = imageId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};
