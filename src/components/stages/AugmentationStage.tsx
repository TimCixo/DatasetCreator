import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import {
  applyAugmentation,
  generateAugmentationConfigs,
  generateSeedFromImage,
} from '../../services/augmentation/augmentationService';
import { createDatasetItem, type AspectRatio, type AugmentationConfig } from '../../types';
import { AlertCircle, Check } from 'lucide-react';

type CleanupWorkingEdit = {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

type CleanupStageState = {
  workingEdits?: Record<string, CleanupWorkingEdit>;
};

type AugmentTypeState = {
  config: AugmentationConfig;
  selectedImageKeys: string[];
};

type AugmentStageState = {
  selectedType?: AugmentationConfig['type'];
  byType?: Partial<Record<AugmentationConfig['type'], AugmentTypeState>>;
};

type AugmentCandidate = {
  key: string;
  displayIdentity: string;
  kind: 'original' | 'crop';
  blob: Blob;
  previewUrl?: string;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
  sourceImageId: string;
  datasetItemId?: string;
};

const TYPE_LABELS: Record<AugmentationConfig['type'], string> = {
  flip_h: 'Flip H',
  flip_v: 'Flip V',
  color: 'Gradient',
  rotate: 'Rotate',
};

const inferAspectRatio = (width: number, height: number): AspectRatio => {
  const ratio = width / height;
  const targets: Array<{ value: AspectRatio; ratio: number }> = [
    { value: '2:3', ratio: 2 / 3 },
    { value: '3:2', ratio: 3 / 2 },
    { value: '1:1', ratio: 1 },
  ];

  return targets.reduce((best, current) =>
    Math.abs(current.ratio - ratio) < Math.abs(best.ratio - ratio) ? current : best
  ).value;
};

const getDefaultConfig = (type: AugmentationConfig['type']): AugmentationConfig => {
  switch (type) {
    case 'flip_h':
      return { type: 'flip_h' };
    case 'flip_v':
      return { type: 'flip_v' };
    case 'color':
      return { type: 'color' };
    case 'rotate':
      return {
        type: 'rotate',
        rotationDegrees: 15,
        rotationVariants: 3,
      };
  }
};

export const AugmentationStage = () => {
  const sourceImages = useProjectStore((state) => Object.values(state.sourceImages));
  const datasetItems = useProjectStore((state) =>
    Object.values(state.datasetItems).filter((item) => !item.deleted)
  );
  const addDatasetItem = useProjectStore((state) => state.addDatasetItem);
  const removeDatasetItem = useProjectStore((state) => state.removeDatasetItem);
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const setStageState = useProjectStore((state) => state.setStageState);
  const cleanupStageState = useProjectStore(
    (state) => (state.stageState.clean as CleanupStageState | undefined) ?? {}
  );
  const augmentStageState = useProjectStore(
    (state) => (state.stageState.augment as AugmentStageState | undefined) ?? {}
  );
  const { addNotification } = useUIStore();

  const [isProcessing, setIsProcessing] = useState(false);

  const cropItems = useMemo(
    () => datasetItems.filter((item) => item.type === 'crop'),
    [datasetItems]
  );

  const sourceOrder = useMemo(
    () => Object.fromEntries(sourceImages.map((image, index) => [image.id, index + 1])),
    [sourceImages]
  );

  const cropPreviewUrls = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const item of cropItems) {
      entries[item.id] = URL.createObjectURL(item.imageData);
    }
    return entries;
  }, [cropItems]);

  useEffect(() => {
    return () => {
      Object.values(cropPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [cropPreviewUrls]);

  const candidates = useMemo<AugmentCandidate[]>(() => {
    const originals: AugmentCandidate[] = sourceImages.map((image) => {
      const workingEdit = cleanupStageState.workingEdits?.[image.id];
      return {
        key: `original:${image.id}`,
        displayIdentity: `${sourceOrder[image.id]}`,
        kind: 'original',
        blob: workingEdit?.blob ?? image.originalFile,
        previewUrl: workingEdit?.previewUrl ?? image.previewUrl,
        width: workingEdit?.width ?? image.width,
        height: workingEdit?.height ?? image.height,
        aspectRatio: inferAspectRatio(workingEdit?.width ?? image.width, workingEdit?.height ?? image.height),
        sourceImageId: image.id,
      };
    });

    const cropIndicesByParent: Record<string, number> = {};
    const crops: AugmentCandidate[] = cropItems.map((item) => {
      cropIndicesByParent[item.sourceImageId] = (cropIndicesByParent[item.sourceImageId] ?? 0) + 1;
      const cropIndex = cropIndicesByParent[item.sourceImageId];
      return {
        key: `crop:${item.id}`,
        displayIdentity: `${sourceOrder[item.sourceImageId]}.${cropIndex}`,
        kind: 'crop',
        blob: item.imageData,
        previewUrl: cropPreviewUrls[item.id],
        width: item.width,
        height: item.height,
        aspectRatio: item.aspectRatio,
        sourceImageId: item.sourceImageId,
        datasetItemId: item.id,
      };
    });

    if (import.meta.env.DEV) {
      console.log(`[augment] originals included: ${originals.length}`);
      console.log(`[augment] crop-derived included: ${crops.length}`);
      console.log(`[augment] final candidate count: ${originals.length + crops.length}`);
    }

    return [...originals, ...crops];
  }, [cleanupStageState.workingEdits, cropItems, cropPreviewUrls, sourceImages, sourceOrder]);

  const selectedType = augmentStageState.selectedType ?? 'flip_h';

  const currentTypeState = augmentStageState.byType?.[selectedType] ?? {
    config: getDefaultConfig(selectedType),
    selectedImageKeys: [],
  };

  const selectedImageKeys = new Set(currentTypeState.selectedImageKeys);

  const updateAugmentStageState = (nextState: AugmentStageState) => {
    setStageState('augment', nextState);
  };

  const updateCurrentTypeState = (nextTypeState: AugmentTypeState) => {
    updateAugmentStageState({
      ...augmentStageState,
      selectedType,
      byType: {
        ...(augmentStageState.byType ?? {}),
        [selectedType]: nextTypeState,
      },
    });

    if (import.meta.env.DEV) {
      console.log(`[augment] selected augmentation type: ${selectedType}`);
      console.log(`[augment] parameter values per type: ${JSON.stringify(nextTypeState.config)}`);
      console.log(
        `[augment] assigned image ids per type: ${JSON.stringify(nextTypeState.selectedImageKeys)}`
      );
    }
  };

  const plannedTypesByImage = useMemo(() => {
    const planned = new Map<string, AugmentationConfig['type'][]>();
    for (const [type, state] of Object.entries(augmentStageState.byType ?? {}) as Array<
      [AugmentationConfig['type'], AugmentTypeState]
    >) {
      for (const imageKey of state.selectedImageKeys) {
        const current = planned.get(imageKey) ?? [];
        current.push(type);
        planned.set(imageKey, current);
      }
    }
    return planned;
  }, [augmentStageState.byType]);

  const previewConfigs = useMemo(() => {
    return generateAugmentationConfigs({
      ...currentTypeState.config,
      type: selectedType,
      rotationSeed: currentTypeState.config.rotationSeed ?? 12345,
    });
  }, [currentTypeState.config, selectedType]);

  const handleTypeChange = (type: AugmentationConfig['type']) => {
    const restoredState = augmentStageState.byType?.[type] ?? {
      config: getDefaultConfig(type),
      selectedImageKeys: [],
    };

    updateAugmentStageState({
      ...augmentStageState,
      selectedType: type,
      byType: {
        ...(augmentStageState.byType ?? {}),
        [type]: restoredState,
      },
    });

    if (import.meta.env.DEV) {
      console.log(`[augment] selected augmentation type: ${type}`);
      console.log(`[augment] restored settings: ${JSON.stringify(restoredState.config)}`);
      console.log(`[augment] restored selected images: ${JSON.stringify(restoredState.selectedImageKeys)}`);
    }
  };

  const toggleImageSelection = (imageKey: string) => {
    const nextSelectedImageKeys = new Set(currentTypeState.selectedImageKeys);
    if (nextSelectedImageKeys.has(imageKey)) {
      nextSelectedImageKeys.delete(imageKey);
    } else {
      nextSelectedImageKeys.add(imageKey);
    }

    updateCurrentTypeState({
      ...currentTypeState,
      selectedImageKeys: Array.from(nextSelectedImageKeys),
    });
  };

  const selectAllForCurrentType = () => {
    updateCurrentTypeState({
      ...currentTypeState,
      selectedImageKeys: candidates.map((candidate) => candidate.key),
    });
  };

  const clearCurrentType = () => {
    updateCurrentTypeState({
      ...currentTypeState,
      selectedImageKeys: [],
    });
  };

  const handleRotationDegreesChange = (rotationDegrees: number) => {
    updateCurrentTypeState({
      ...currentTypeState,
      config: {
        ...currentTypeState.config,
        type: selectedType,
        rotationDegrees,
      },
    });
  };

  const handleRotationVariantsChange = (rotationVariants: number) => {
    updateCurrentTypeState({
      ...currentTypeState,
      config: {
        ...currentTypeState.config,
        type: selectedType,
        rotationVariants,
      },
    });
  };

  const handleProceedToFinalReview = async () => {
    setIsProcessing(true);

    try {
      const augmentationAssignments = Array.from(
        Object.entries(augmentStageState.byType ?? {})
      ) as Array<[AugmentationConfig['type'], AugmentTypeState]>;

      const existingGeneratedItems = datasetItems.filter(
        (item) => item.type === 'original' || item.type === 'augmented'
      );
      for (const item of existingGeneratedItems) {
        removeDatasetItem(item.id);
      }

      for (const candidate of candidates.filter((candidate) => candidate.kind === 'original')) {
        const originalItem = createDatasetItem(
          candidate.sourceImageId,
          candidate.blob,
          candidate.width,
          candidate.height,
          'original',
          candidate.aspectRatio
        );
        addDatasetItem(originalItem);
      }

      let generatedAugmentedOutputs = 0;
      for (const [type, state] of augmentationAssignments) {
        const baseConfig = {
          ...state.config,
          type,
          rotationSeed: state.config.rotationSeed ?? generateSeedFromImage(type),
        };
        const configs = generateAugmentationConfigs(baseConfig);

        for (const imageKey of state.selectedImageKeys) {
          const candidate = candidates.find((item) => item.key === imageKey);
          if (!candidate) {
            continue;
          }

          for (const config of configs) {
            const augmentedBlob = await applyAugmentation(candidate.blob, config);
            const augmentedItem = createDatasetItem(
              candidate.sourceImageId,
              augmentedBlob,
              candidate.width,
              candidate.height,
              'augmented',
              candidate.aspectRatio
            );
            augmentedItem.augmentationConfig = config;
            addDatasetItem(augmentedItem);
            generatedAugmentedOutputs += 1;
          }
        }
      }

      if (import.meta.env.DEV) {
        console.log(
          `[augment-transition] remembered augmentation assignments: ${augmentationAssignments.reduce(
            (sum, [, state]) => sum + state.selectedImageKeys.length,
            0
          )}`
        );
        console.log(`[augment-transition] generated augmented outputs on transition: ${generatedAugmentedOutputs}`);
        console.log(
          `[augment-transition] final input count received by Final Review: ${
            useProjectStore.getState().getDatasetItems(false).length
          }`
        );
      }

      addNotification('success', `Prepared ${generatedAugmentedOutputs} augmented item(s) for review`);
      setCurrentStage('review');
    } catch (error) {
      console.error('Failed to finalize augmentation stage:', error);
      addNotification('error', 'Failed to prepare augmentations for review');
    } finally {
      setIsProcessing(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images available for augmentation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Augmentation Type</label>
            <p className="text-xs text-muted-foreground">
              Each type remembers its own image assignments and parameter values.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedType}
              onChange={(event) => handleTypeChange(event.target.value as AugmentationConfig['type'])}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              <option value="flip_h">Flip Horizontal</option>
              <option value="flip_v">Flip Vertical</option>
              <option value="color">Gradient Map</option>
              <option value="rotate">Rotate</option>
            </select>
            <button
              onClick={selectAllForCurrentType}
              className="px-3 py-2 text-sm bg-secondary hover:bg-muted rounded-md transition-colors"
            >
              Select All
            </button>
            <button
              onClick={clearCurrentType}
              className="px-3 py-2 text-sm bg-secondary hover:bg-muted rounded-md transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {selectedType === 'rotate' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Max Rotation: {currentTypeState.config.rotationDegrees ?? 15}°
              </label>
              <input
                type="range"
                min="1"
                max="180"
                value={currentTypeState.config.rotationDegrees ?? 15}
                onChange={(event) => handleRotationDegreesChange(parseInt(event.target.value, 10))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Variants per Image: {currentTypeState.config.rotationVariants ?? 3}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={currentTypeState.config.rotationVariants ?? 3}
                onChange={(event) => handleRotationVariantsChange(parseInt(event.target.value, 10))}
                className="w-full"
              />
            </div>
          </div>
        )}

        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-sm text-muted-foreground">
          Current type: <strong>{TYPE_LABELS[selectedType]}</strong> • Assigned images:{' '}
          <strong>{currentTypeState.selectedImageKeys.length}</strong> • Planned variants:{' '}
          <strong>{previewConfigs.length}</strong>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h3 className="text-lg font-semibold">Augmentation Gallery</h3>
            <p className="text-sm text-muted-foreground">
              Originals and crop-derived images can both be assigned augmentations.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
            </div>
            <button
              onClick={() => void handleProceedToFinalReview()}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium"
            >
              {isProcessing ? 'Preparing Final Review...' : 'Proceed to Final Review'}
            </button>
          </div>
        </div>

        <div className="gallery-masonry">
          {candidates.map((candidate) => {
            const plannedTypes = plannedTypesByImage.get(candidate.key) ?? [];
            const isSelectedForCurrentType = selectedImageKeys.has(candidate.key);
            const statusText =
              plannedTypes.length > 0
                ? plannedTypes.map((type) => TYPE_LABELS[type]).join(', ')
                : 'No augmentations assigned';

            return (
              <button
                key={candidate.key}
                onClick={() => toggleImageSelection(candidate.key)}
                className={`gallery-masonry-item group relative rounded-lg overflow-hidden border transition-colors text-left ${
                  isSelectedForCurrentType
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-secondary hover:border-primary/50'
                }`}
              >
                <div className="relative min-h-[12rem] bg-black flex items-center justify-center overflow-hidden">
                  {candidate.previewUrl ? (
                    <img
                      src={candidate.previewUrl}
                      alt={`Image ${candidate.displayIdentity}`}
                      className="w-full h-auto object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {candidate.width} x {candidate.height}
                    </span>
                  )}

                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <span className="px-2 py-1 rounded-full bg-black/60 text-[10px] font-medium text-white">
                      {candidate.kind === 'original' ? 'Original' : 'Crop'}
                    </span>
                    {isSelectedForCurrentType && (
                      <span className="p-1 rounded-full bg-primary text-primary-foreground">
                        <Check size={12} />
                      </span>
                    )}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3">
                    <p className="text-sm font-medium text-white">Image #{candidate.displayIdentity}</p>
                    <p className="text-xs text-gray-300 line-clamp-2">{statusText}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
        <p className="text-sm text-blue-600">
          Stage 5 stores augmentation assignments as working state. Outputs are generated only when
          proceeding to Final Review.
        </p>
      </div>
    </div>
  );
};
