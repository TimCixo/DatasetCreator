import { useState, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import {
  generateRotationVariants,
  generateAugmentationConfigs,
  applyAugmentation,
  generateSeedFromImage,
} from '../../services/augmentation/augmentationService';
import { createDatasetItem, AugmentationConfig } from '../../types';
import { AlertCircle, ChevronDown } from 'lucide-react';

export const AugmentationStage = () => {
  const { getDatasetItems, addDatasetItem } = useProjectStore();
  const { addNotification } = useUIStore();

  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [augmentationType, setAugmentationType] = useState<AugmentationConfig['type']>('flip_h');
  const [rotationDegrees, setRotationDegrees] = useState(15);
  const [rotationVariants, setRotationVariants] = useState(3);
  const [colorVariants, setColorVariants] = useState(3);
  const [isProcessing, setIsProcessing] = useState(false);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);

  const items = getDatasetItems(false);

  const previewConfigs = useMemo(() => {
    if (selectedImages.size === 0) return [];

    const baseConfig: AugmentationConfig = {
      type: augmentationType,
      rotationDegrees,
      rotationVariants,
      rotationSeed: 12345,
    };

    return generateAugmentationConfigs(
      baseConfig,
      Array.from(selectedImages),
      augmentationType
    );
  }, [selectedImages, augmentationType, rotationDegrees, rotationVariants]);

  const toggleImageSelection = (id: string) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedImages(new Set(items.map((item) => item.id)));
  };

  const clearSelection = () => {
    setSelectedImages(new Set());
  };

  const handleApplyAugmentation = async () => {
    if (selectedImages.size === 0) {
      addNotification('warning', 'Please select images to augment');
      return;
    }

    setIsProcessing(true);
    let successCount = 0;

    try {
      const baseConfig: AugmentationConfig = {
        type: augmentationType,
        rotationDegrees,
        rotationVariants,
        rotationSeed: 12345,
      };

      for (const imageId of selectedImages) {
        const item = items.find((i) => i.id === imageId);
        if (!item) continue;

        const configs = generateAugmentationConfigs(
          baseConfig,
          [imageId],
          augmentationType
        );

        for (const config of configs) {
          try {
            const augmentedBlob = await applyAugmentation(item.imageData, config);

            const augmentedItem = createDatasetItem(
              item.sourceImageId,
              augmentedBlob,
              item.width,
              item.height,
              'augmented',
              item.aspectRatio
            );
            augmentedItem.augmentationConfig = config;

            addDatasetItem(augmentedItem);
            successCount++;
          } catch (error) {
            console.error(`Failed to apply augmentation to ${imageId}:`, error);
          }
        }
      }

      addNotification('success', `Created ${successCount} augmented variant${successCount !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Failed to apply augmentations:', error);
      addNotification('error', 'Failed to apply augmentations');
    } finally {
      setIsProcessing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images to augment. Crop or import images first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Augmentation Type & Settings */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Augmentation Type</label>
          <select
            value={augmentationType}
            onChange={(e) => setAugmentationType(e.target.value as AugmentationConfig['type'])}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="flip_h">Flip Horizontal</option>
            <option value="flip_v">Flip Vertical</option>
            <option value="color">Color (Gradient Map)</option>
            <option value="rotate">Rotate with Variants</option>
          </select>
        </div>

        {augmentationType === 'rotate' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Max Rotation: {rotationDegrees}°
              </label>
              <input
                type="range"
                min="1"
                max="180"
                value={rotationDegrees}
                onChange={(e) => setRotationDegrees(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Variants per Image: {rotationVariants}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={rotationVariants}
                onChange={(e) => setRotationVariants(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="text-sm text-muted-foreground">
              Preview: {previewConfigs.length} variant{previewConfigs.length !== 1 ? 's' : ''} per selected image
            </div>
          </div>
        )}

        {augmentationType === 'color' && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Color Variants: {colorVariants}
            </label>
            <p className="text-sm text-muted-foreground">
              Will generate {colorVariants} gradient map variations per image
            </p>
          </div>
        )}
      </div>

      {/* Image Selection */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Select Images to Augment</h3>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-sm bg-secondary hover:bg-muted rounded-md transition-colors"
            >
              Select All
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-1 text-sm bg-secondary hover:bg-muted rounded-md transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-secondary/50 transition-colors cursor-pointer"
              onClick={() => toggleImageSelection(item.id)}
            >
              <input
                type="checkbox"
                checked={selectedImages.has(item.id)}
                onChange={() => {}}
                className="w-4 h-4 rounded"
              />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {item.width} × {item.height}
                </p>
                <p className="text-xs text-muted-foreground">
                  Type: {item.type} • Aspect: {item.aspectRatio}
                </p>
              </div>

              {previewConfigs.length > 0 && (
                <span className="text-xs font-mono text-muted-foreground">
                  +{previewConfigs.length} variants
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 p-3 rounded-md bg-secondary/50">
          <p className="text-sm text-muted-foreground">
            Selected: <strong>{selectedImages.size}</strong> image{selectedImages.size !== 1 ? 's' : ''} •
            Will generate: <strong>{selectedImages.size * Math.max(previewConfigs.length, 1)}</strong> total item{selectedImages.size * Math.max(previewConfigs.length, 1) !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Apply Button */}
      <button
        onClick={handleApplyAugmentation}
        disabled={selectedImages.size === 0 || isProcessing}
        className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
      >
        {isProcessing ? 'Processing...' : `Apply Augmentation (${previewConfigs.length} variant${previewConfigs.length !== 1 ? 's' : ''} each)`}
      </button>
    </div>
  );
};
