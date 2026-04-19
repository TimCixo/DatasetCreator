import { useState, useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ASPECT_RATIOS, ASPECT_RATIO_LABELS } from '../../lib/constants';
import { cropImage } from '../../services/image/imageProcessor';
import {
  createCenteredCropFrame,
  moveCropFrame,
  resizeCropFrameFromHandle,
  validateCropFrame,
  checkCropOverlap,
} from '../../services/crop/cropService';
import { createDatasetItem, CropFrame, AspectRatio } from '../../types';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';

interface CropState {
  frames: CropFrame[];
  selectedFrameId: string | null;
  resizingHandle: string | null;
}

export const CropStage = () => {
  const { getSourceImages, addDatasetItem, getDatasetItems } = useProjectStore();
  const { addNotification } = useUIStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>('1:1');
  const [cropState, setCropState] = useState<CropState>({
    frames: [],
    selectedFrameId: null,
    resizingHandle: null,
  });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const sourceImages = getSourceImages();
  const existingItems = getDatasetItems(false);

  if (sourceImages.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No source images available. Import images first.</p>
      </div>
    );
  }

  const currentImage = sourceImages[currentImageIndex];

  // Draw canvas preview
  useEffect(() => {
    if (!canvasRef.current || !currentImage) return;

    const canvas = canvasRef.current;
    canvas.width = currentImage.width;
    canvas.height = currentImage.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw image
    const url = URL.createObjectURL(currentImage.originalFile);
    const img = new Image();

    img.onload = () => {
      ctx.drawImage(img, 0, 0);

      // Draw crop frames
      cropState.frames.forEach((frame) => {
        const isSelected = frame.id === cropState.selectedFrameId;

        // Draw frame
        ctx.strokeStyle = isSelected ? '#3b82f6' : '#8b5cf6';
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

        // Draw fill
        ctx.fillStyle = isSelected ? 'rgba(59, 130, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)';
        ctx.fillRect(frame.x, frame.y, frame.width, frame.height);

        // Draw handles if selected
        if (isSelected) {
          const handleSize = 8 / zoom;
          const handles = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];

          handles.forEach((handle) => {
            let hx = 0, hy = 0;

            if (handle.includes('l')) hx = frame.x;
            else if (handle.includes('r')) hx = frame.x + frame.width;
            else hx = frame.x + frame.width / 2;

            if (handle.includes('t')) hy = frame.y;
            else if (handle.includes('b')) hy = frame.y + frame.height;
            else hy = frame.y + frame.height / 2;

            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
          });
        }
      });

      URL.revokeObjectURL(url);
    };

    img.src = url;
  }, [cropState.frames, cropState.selectedFrameId, currentImage, zoom]);

  const getCanvasCoordinates = (e: React.MouseEvent): [number, number] => {
    if (!canvasRef.current) return [0, 0];

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    return [x, y];
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const [x, y] = getCanvasCoordinates(e);

    // Check if clicking on a handle
    for (const frame of cropState.frames) {
      if (frame.id === cropState.selectedFrameId) {
        const handles = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
        const handleSize = 16 / zoom;

        for (const handle of handles) {
          let hx = 0, hy = 0;

          if (handle.includes('l')) hx = frame.x;
          else if (handle.includes('r')) hx = frame.x + frame.width;
          else hx = frame.x + frame.width / 2;

          if (handle.includes('t')) hy = frame.y;
          else if (handle.includes('b')) hy = frame.y + frame.height;
          else hy = frame.y + frame.height / 2;

          if (
            Math.abs(x - hx) < handleSize / 2 &&
            Math.abs(y - hy) < handleSize / 2
          ) {
            setCropState((prev) => ({
              ...prev,
              resizingHandle: handle,
            }));
            setIsDragging(true);
            setDragStart({ x, y });
            return;
          }
        }
      }
    }

    // Check if clicking on a frame
    const clickedFrame = cropState.frames.find(
      (f) =>
        x >= f.x &&
        x <= f.x + f.width &&
        y >= f.y &&
        y <= f.y + f.height
    );

    if (clickedFrame) {
      setCropState((prev) => ({
        ...prev,
        selectedFrameId: clickedFrame.id,
      }));
      setIsDragging(true);
      setDragStart({ x, y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const [x, y] = getCanvasCoordinates(e);
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;

    setCropState((prev) => {
      const selectedFrame = prev.frames.find((f) => f.id === prev.selectedFrameId);
      if (!selectedFrame) return prev;

      let newFrame: CropFrame;

      if (prev.resizingHandle) {
        newFrame = resizeCropFrameFromHandle(
          selectedFrame,
          prev.resizingHandle,
          dx,
          dy,
          currentImage.width,
          currentImage.height
        );
      } else {
        newFrame = moveCropFrame(
          selectedFrame,
          dx,
          dy,
          currentImage.width,
          currentImage.height
        );
      }

      return {
        ...prev,
        frames: prev.frames.map((f) => (f.id === selectedFrame.id ? newFrame : f)),
      };
    });

    setDragStart({ x, y });
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    setCropState((prev) => ({ ...prev, resizingHandle: null }));
  };

  const handleAddCropFrame = () => {
    const newFrame = createCenteredCropFrame(
      currentImage.width,
      currentImage.height,
      selectedAspectRatio
    );

    setCropState((prev) => ({
      ...prev,
      frames: [...prev.frames, newFrame],
      selectedFrameId: newFrame.id,
    }));
  };

  const handleRemoveCropFrame = (id: string) => {
    setCropState((prev) => ({
      ...prev,
      frames: prev.frames.filter((f) => f.id !== id),
      selectedFrameId: prev.selectedFrameId === id ? null : prev.selectedFrameId,
    }));
  };

  const handleApplyCrops = async () => {
    if (cropState.frames.length === 0) {
      addNotification('warning', 'No crop frames created');
      return;
    }

    try {
      for (const frame of cropState.frames) {
        const croppedBlob = await cropImage(
          currentImage.originalFile,
          frame.x,
          frame.y,
          frame.width,
          frame.height
        );

        const datasetItem = createDatasetItem(
          currentImage.id,
          croppedBlob,
          frame.width,
          frame.height,
          'crop',
          frame.aspectRatio
        );
        datasetItem.cropFrame = frame;

        addDatasetItem(datasetItem);
      }

      addNotification('success', `Created ${cropState.frames.length} crop${cropState.frames.length !== 1 ? 's' : ''}`);

      // Move to next image
      if (currentImageIndex < sourceImages.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
        setCropState({ frames: [], selectedFrameId: null, resizingHandle: null });
      } else {
        addNotification('success', 'All crops completed');
      }
    } catch (error) {
      console.error('Failed to apply crops:', error);
      addNotification('error', 'Failed to apply crops');
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-4 items-center">
            <div>
              <label className="text-sm font-medium block mb-1">Aspect Ratio</label>
              <select
                value={selectedAspectRatio}
                onChange={(e) => setSelectedAspectRatio(e.target.value as AspectRatio)}
                className="px-3 py-2 rounded-md border border-border bg-background text-sm"
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ASPECT_RATIO_LABELS[ratio]}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleAddCropFrame}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Plus size={16} />
              Add Frame
            </button>
          </div>

          <div className="text-sm text-muted-foreground">
            {cropState.frames.length} frame{cropState.frames.length !== 1 ? 's' : ''}
          </div>
        </div>

        {cropState.frames.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium block">Crop Frames</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {cropState.frames.map((frame) => (
                <div
                  key={frame.id}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${
                    frame.id === cropState.selectedFrameId
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-border hover:border-primary'
                  }`}
                  onClick={() =>
                    setCropState((prev) => ({
                      ...prev,
                      selectedFrameId: frame.id,
                    }))
                  }
                >
                  <div className="text-xs font-mono mb-1">
                    {ASPECT_RATIO_LABELS[frame.aspectRatio]}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {Math.round(frame.width)} × {Math.round(frame.height)}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveCropFrame(frame.id);
                    }}
                    className="w-full px-2 py-1 text-xs bg-destructive/20 text-destructive hover:bg-destructive/30 rounded transition-colors"
                  >
                    <Trash2 size={12} className="inline" /> Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="rounded-lg border border-border overflow-auto bg-black flex items-center justify-center"
        style={{ height: '500px' }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          style={{ transform: `scale(${zoom})` }}
          className="block cursor-move"
        />
      </div>

      {/* Controls */}
      <div className="flex gap-4 items-center">
        <button
          onClick={() => setZoom(Math.max(0.5, zoom - 0.2))}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted transition-colors"
        >
          Zoom Out
        </button>

        <span className="text-sm font-mono w-12 text-center">{zoom.toFixed(1)}x</span>

        <button
          onClick={() => setZoom(zoom + 0.2)}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted transition-colors"
        >
          Zoom In
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))}
          disabled={currentImageIndex === 0}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Previous
        </button>

        <span className="text-sm text-muted-foreground">
          Image {currentImageIndex + 1} of {sourceImages.length}
        </span>

        <button
          onClick={() => setCurrentImageIndex(Math.min(sourceImages.length - 1, currentImageIndex + 1))}
          disabled={currentImageIndex === sourceImages.length - 1}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Next
        </button>

        <button
          onClick={handleApplyCrops}
          disabled={cropState.frames.length === 0}
          className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Apply Crops
        </button>
      </div>
    </div>
  );
};
