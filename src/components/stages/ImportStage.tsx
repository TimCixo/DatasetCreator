import { useState, useCallback, useRef } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { createSourceImage, type SourceImage } from '../../types';
import { getImageDimensions, createThumbnail } from '../../services/image/imageProcessor';
import { generateEmbedding, generateImageHash } from '../../services/image/embeddingService';

import { Upload, Trash2 } from 'lucide-react';

const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const ImportStage = () => {
  const {
    addSourceImages,
    removeSourceImage,
    setCurrentStage,
  } = useProjectStore();

  const sourceImages = useProjectStore((state) => state.sourceImages);
  const images = Object.values(sourceImages);

  const { addNotification } = useUIStore();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const logDev = useCallback((scope: string, message: string, value: number) => {
    if (import.meta.env.DEV) {
      console.log(`[${scope}] ${message}: ${value}`);
    }
  }, []);

  const processImportedFile = useCallback(
    async (file: File): Promise<SourceImage | null> => {
      if (!SUPPORTED_FORMATS.includes(file.type)) {
        console.warn(`Skipping ${file.name}: unsupported format`);
        return null;
      }

      const { width, height } = await getImageDimensions(file);
      const thumbnail = await createThumbnail(file);
      const embedding = await generateEmbedding(file);
      const hash = await generateImageHash(file);
      const previewUrl = URL.createObjectURL(file);

      const sourceImage = createSourceImage(
        file,
        file.name,
        width,
        height,
        previewUrl
      );

      sourceImage.thumbnail = thumbnail;
      sourceImage.embedding = embedding;
      sourceImage.hash = hash;

      return sourceImage;
    },
    []
  );

  const importImages = useCallback(
    async (files: File[]): Promise<number> => {
      if (files.length === 0) {
        return 0;
      }

      setIsLoading(true);
      logDev('import', 'received files', files.length);
      const newImages: SourceImage[] = [];

      try {
        for (const file of files) {
          try {
            const sourceImage = await processImportedFile(file);

            if (sourceImage) {
              newImages.push(sourceImage);
            }
          } catch (error) {
            console.error(`Failed to process ${file.name}:`, error);
            addNotification('error', `Failed to process ${file.name}`);
          }
        }

        if (newImages.length > 0) {
          addSourceImages(newImages);
          logDev('import', 'processed images', newImages.length);
          logDev(
            'import',
            'store image count',
            Object.keys(useProjectStore.getState().sourceImages).length
          );
          addNotification(
            'success',
            `Imported ${newImages.length} image${newImages.length !== 1 ? 's' : ''}`
          );
        }

        return newImages.length;
      } finally {
        setIsLoading(false);
      }
    },
    [addNotification, addSourceImages, logDev, processImportedFile]
  );

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files ? Array.from(input.files) : [];
    logDev('picker', 'selected files', files.length);
    logDev('picker', 'normalized files', files.length);

    try {
      const processedCount = await importImages(files);
      logDev('picker', 'processed images', processedCount);
      logDev(
        'picker',
        'store image count',
        Object.keys(useProjectStore.getState().sourceImages).length
      );
    } finally {
      input.value = '';
    }
  };

  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files ? Array.from(input.files) : [];
    logDev('folder', 'selected files', files.length);

    try {
      const processedCount = await importImages(files);
      logDev('folder', 'processed images', processedCount);
      logDev(
        'folder',
        'store image count',
        Object.keys(useProjectStore.getState().sourceImages).length
      );
    } finally {
      input.value = '';
    }
  };

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(event.dataTransfer.files ?? []);
    logDev('drop', 'selected files', files.length);

    const processedCount = await importImages(files);
    logDev('drop', 'processed images', processedCount);
    logDev(
      'drop',
      'store image count',
      Object.keys(useProjectStore.getState().sourceImages).length
    );
  }, [importImages, logDev]);

  const handleRemoveImage = (id: string) => {
    removeSourceImage(id);
    addNotification('info', 'Image removed');
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div 
        className={`rounded-lg border-2 border-dashed transition-colors ${
          isDragOver 
            ? 'border-primary bg-primary/5' 
            : 'border-border bg-card hover:border-primary/50'
        } p-8`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Import Images</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Select individual files or an entire folder to begin
          </p>
          
          <div className="flex gap-4 justify-center mb-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isLoading ? 'Processing...' : 'Select Files'}
            </button>
            
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isLoading}
              className="px-4 py-2 bg-secondary text-foreground rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Processing...' : 'Select Folder'}
            </button>
          </div>

          {isDragOver && (
            <p className="text-sm text-primary font-medium mb-4">
              Drop files here to import
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={SUPPORTED_FORMATS.join(',')}
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <input
            ref={folderInputRef}
            type="file"
            multiple
            accept={SUPPORTED_FORMATS.join(',')}
            {...{ webkitdirectory: 'true', mozdirectory: 'true' } as any}
            onChange={handleFolderSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* Gallery */}
      {images.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              Imported Images ({images.length})
            </h3>
            <span className="text-sm text-muted-foreground">
              Embeddings generated • Ready for next stage
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map((image) => (
              <div key={image.id} className="group relative rounded-lg overflow-hidden bg-secondary border border-border hover:border-primary transition-colors">
                <div className="aspect-square bg-black flex items-center justify-center overflow-hidden">
                  {typeof image.previewUrl === 'string' && image.previewUrl ? (
                    <img
                      src={image.previewUrl}
                      alt={image.fileName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground p-2 text-center">
                      <span className="text-xs font-medium">
                        Preview unavailable
                      </span>
                    </div>
                  )}
                </div>

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                  <button
                    onClick={() => handleRemoveImage(image.id)}
                    className="p-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
                    title="Remove image"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="text-xs text-white truncate">{image.fileName}</p>
                  <p className="text-xs text-gray-300">
                    {image.width} × {image.height}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 rounded-lg bg-secondary/50 border border-border">
            <p className="text-sm text-muted-foreground">
              <strong>{images.length}</strong> images ready •{' '}
              <strong>{(
                images.reduce((sum, img) => {
                  return sum + (img.originalFile instanceof Blob ? img.originalFile.size : 0);
                }, 0) / 1024 / 1024
              ).toFixed(1)} MB</strong> total
            </p>
          </div>
        </div>
      )}

      {/* Next Button */}
      {images.length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={() => setCurrentStage('select')}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-semibold text-lg"
          >
            Proceed to Remove Duplicates →
          </button>
        </div>
      )}

      {images.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No images imported yet</p>
        </div>
      )}
    </div>
  );
};
