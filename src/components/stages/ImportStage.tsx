import { useState, useCallback, useRef } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { createSourceImage } from '../../types';
import { getImageDimensions, createThumbnail } from '../../services/image/imageProcessor';
import { generateEmbedding, generateImageHash } from '../../services/image/embeddingService';

import { Upload, Trash2 } from 'lucide-react';

const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const ImportStage = () => {
  const {

    addSourceImage,
    removeSourceImage,
    getSourceImages,
  } = useProjectStore();

  const { addNotification } = useUIStore();
  
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const importImages = useCallback(
    async (files: FileList | null) => {
      if (!files) return;

      setIsLoading(true);
      const newImages = [];

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];

          // Validate format
          if (!SUPPORTED_FORMATS.includes(file.type)) {
            console.warn(`Skipping ${file.name}: unsupported format`);
            continue;
          }

          try {
            // Get image dimensions
            const { width, height } = await getImageDimensions(file);

            // Generate thumbnail
            await createThumbnail(file);

            // Generate embedding for similarity
            const embedding = await generateEmbedding(file);

            // Generate perceptual hash
            const hash = await generateImageHash(file);

            // Create source image
            const sourceImage = createSourceImage(
              file,
              file.name,
              width,
              height
            );
            sourceImage.embedding = embedding;
            sourceImage.hash = hash;

            addSourceImage(sourceImage);
            newImages.push(sourceImage);
          } catch (error) {
            console.error(`Failed to process ${file.name}:`, error);
            addNotification('error', `Failed to process ${file.name}`);
          }
        }

        if (newImages.length > 0) {
          addNotification(
            'success',
            `Imported ${newImages.length} image${newImages.length !== 1 ? 's' : ''}`
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [addSourceImage, addNotification]
  );

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    importImages(event.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    importImages(event.target.files);
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (id: string) => {
    removeSourceImage(id);
    addNotification('info', 'Image removed');
  };

  const images = getSourceImages();

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="rounded-lg border border-dashed border-border bg-card p-8">
        <div className="text-center">
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Import Images</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Select individual files or an entire folder to begin
          </p>
          
          <div className="flex gap-4 justify-center">
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
            {...{ webkitdirectory: 'true', mozdirectory: 'true' } as any}
            accept={SUPPORTED_FORMATS.join(',')}
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
                  <img
                    src={URL.createObjectURL(image.originalFile)}
                    alt={image.fileName}
                    className="w-full h-full object-cover"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      URL.revokeObjectURL(img.src);
                    }}
                  />
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
              <strong>{(images.reduce((sum, img) => sum + img.originalFile.size, 0) / 1024 / 1024).toFixed(1)} MB</strong> total
            </p>
          </div>
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
