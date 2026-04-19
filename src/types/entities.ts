import { v4 as uuidv4 } from 'uuid';

// ============ ENUMS ============

export type AspectRatio = '2:3' | '3:2' | '1:1';

export type ImageType = 'original' | 'crop' | 'augmented';

export type AugmentationType = 'flip_h' | 'flip_v' | 'color' | 'rotate';

export type StageName = 'import' | 'select' | 'clean' | 'crop' | 'augment' | 'review' | 'tagging' | 'export';

// ============ SOURCE IMAGE ============

export interface SourceImage {
  id: string;
  originalFile: Blob;
  fileName: string;
  width: number;
  height: number;
  mimeType: string;
  previewUrl?: string;
  thumbnail?: Blob;
  embedding?: Float32Array;
  hash?: string;
  createdAt: Date;
}

// ============ CROP & CLEANUP ============

export interface CropFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
}

export interface CanvasLayer {
  id: string;
  type: 'brush' | 'eraser';
  data: ImageData;
  opacity: number;
  timestamp: Date;
}

export interface CleanupOverlay {
  id: string;
  imageId: string;
  layers: CanvasLayer[];
  history: ImageData[];
  historyIndex: number;
}

// ============ AUGMENTATION ============

export interface AugmentationConfig {
  type: AugmentationType;
  flipH?: boolean;
  flipV?: boolean;
  colorGradient?: { from: string; to: string };
  rotationDegrees?: number;
  rotationVariants?: number;
  rotationSeed?: number;
}

// ============ DATASET ITEM ============

export interface DatasetItem {
  id: string;
  sourceImageId: string;
  imageData: Blob;
  width: number;
  height: number;
  type: ImageType;
  cropFrame?: CropFrame;
  augmentationConfig?: AugmentationConfig;
  cleanupOverlayId?: string;
  tags?: string[];
  aspectRatio: AspectRatio;
  deleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  exportOrder?: number;
}

// ============ TAGGING ============

export interface TaggingConfig {
  datasetKeyword: string;
  autoTaggingEndpoint?: string;
  threshold: number;
  maxTags: number;
  insertMode: 'prepend' | 'append' | 'overwrite';
  blacklist: string[];
}

// ============ SIMILARITY ============

export interface SimilarityResult {
  imageId1: string;
  imageId2: string;
  distance: number;
  similarity: number; // 0-1
}

export interface SimilarityCluster {
  id: string;
  imageIds: string[];
  avgSimilarity: number;
}

// ============ PROJECT ============

export interface ProjectState {
  id: string;
  name: string;
  sourceImages: Record<string, SourceImage>;
  datasetItems: Record<string, DatasetItem>;
  cleanupOverlays: Record<string, CleanupOverlay>;
  currentStage: StageName;
  stageState: Record<StageName, unknown>;
  taggingConfig: TaggingConfig;
  lastModified: Date;
  createdAt: Date;
}

export interface ProjectStageState {
  stage: StageName;
  selectedIds: Set<string>;
  selectedImageId?: string;
  viewMode?: string;
}

// ============ FACTORY FUNCTIONS ============

export const createSourceImage = (
  file: Blob,
  fileName: string,
  width: number,
  height: number,
  previewUrl?: string
): SourceImage => ({
  id: uuidv4(),
  originalFile: file,
  fileName,
  width,
  height,
  mimeType: file.type,
  previewUrl,
  createdAt: new Date(),
});

export const createDatasetItem = (
  sourceImageId: string,
  imageData: Blob,
  width: number,
  height: number,
  type: ImageType = 'original',
  aspectRatio: AspectRatio = '1:1'
): DatasetItem => ({
  id: uuidv4(),
  sourceImageId,
  imageData,
  width,
  height,
  type,
  aspectRatio,
  deleted: false,
  createdAt: new Date(),
});

export const createCropFrame = (
  x: number,
  y: number,
  width: number,
  height: number,
  aspectRatio: AspectRatio
): CropFrame => ({
  id: uuidv4(),
  x,
  y,
  width,
  height,
  aspectRatio,
});

export const createCleanupOverlay = (imageId: string): CleanupOverlay => ({
  id: uuidv4(),
  imageId,
  layers: [],
  history: [],
  historyIndex: -1,
});

export const createProject = (name: string): ProjectState => ({
  id: uuidv4(),
  name,
  sourceImages: {},
  datasetItems: {},
  cleanupOverlays: {},
  currentStage: 'import',
  stageState: {
    import: {},
    select: {},
    clean: {},
    crop: {},
    augment: {},
    review: {},
    tagging: {},
    export: {},
  },
  taggingConfig: {
    datasetKeyword: 'dataset',
    threshold: 0.5,
    maxTags: 15,
    insertMode: 'append',
    blacklist: [],
  },
  lastModified: new Date(),
  createdAt: new Date(),
});
