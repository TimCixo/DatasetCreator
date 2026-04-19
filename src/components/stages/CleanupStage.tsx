import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { blobToImageData, imageDataToBlob } from '../../services/image/imageProcessor';
import {
  createCanvasState,
  drawBrushStroke,
  drawEraserStroke,
  sampleColor,
  undo,
  redo,
  addToHistory,
  getCurrentImageData,
  type CanvasState,
  type BrushSettings,
} from '../../services/cleanup/canvasEditor';
import { AlertCircle, Undo2, Redo2, Droplet, Eraser, Pencil, ZoomIn, ZoomOut } from 'lucide-react';

export const CleanupStage = () => {
  const { getDatasetItems, updateDatasetItem } = useProjectStore();
  const { addNotification } = useUIStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [tool, setTool] = useState<'brush' | 'eraser' | 'eyedropper'>('brush');
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    opacity: 1,
    hardness: 0.8,
    color: '#000000',
  });
  const [zoom, setZoom] = useState(1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);

  const items = getDatasetItems(false);

  // Initialize canvas on mount or when image changes
  useEffect(() => {
    if (items.length === 0) return;

    const initializeCanvas = async () => {
      const item = items[currentImageIndex];
      try {
        const imageData = await blobToImageData(item.imageData);
        const state = createCanvasState(imageData);
        setCanvasState(state);

        // Set up display canvas
        if (displayCanvasRef.current) {
          displayCanvasRef.current.width = imageData.width;
          displayCanvasRef.current.height = imageData.height;

          const ctx = displayCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.putImageData(imageData, 0, 0);
          }
        }
      } catch (error) {
        console.error('Failed to initialize canvas:', error);
        addNotification('error', 'Failed to load image for cleanup');
      }
    };

    initializeCanvas();
  }, [currentImageIndex, items, addNotification]);

  // Render canvas display
  useEffect(() => {
    if (!canvasState || !displayCanvasRef.current) return;

    const ctx = displayCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const imageData = getCurrentImageData(canvasState);
    ctx.putImageData(imageData, 0, 0);
  }, [canvasState]);

  const getCanvasCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): [number, number] => {
    if (!displayCanvasRef.current) return [0, 0];

    const rect = displayCanvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    return [x, y];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasState || !canvasRef.current || !displayCanvasRef.current) return;

    const [x, y] = getCanvasCoordinates(e);
    setLastX(x);
    setLastY(y);
    setIsDrawing(true);

    if (tool === 'eyedropper') {
      const ctx = displayCanvasRef.current.getContext('2d');
      if (ctx) {
        const color = sampleColor(ctx, x, y);
        setBrushSettings((prev) => ({ ...prev, color }));
        setTool('brush');
        addNotification('info', 'Color picked');
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasState || !canvasRef.current || !displayCanvasRef.current) return;

    const [x, y] = getCanvasCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Draw stroke
    let newImageData: ImageData;
    if (tool === 'brush') {
      newImageData = drawBrushStroke(
        canvasRef.current,
        ctx,
        lastX,
        lastY,
        x,
        y,
        brushSettings
      );
    } else if (tool === 'eraser') {
      newImageData = drawEraserStroke(
        canvasRef.current,
        ctx,
        lastX,
        lastY,
        x,
        y,
        brushSettings.size,
        brushSettings.hardness
      );
    } else {
      return;
    }

    // Update display
    const displayCtx = displayCanvasRef.current.getContext('2d');
    if (displayCtx) {
      displayCtx.putImageData(newImageData, 0, 0);
    }

    setLastX(x);
    setLastY(y);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !canvasState || !displayCanvasRef.current) return;

    const ctx = displayCanvasRef.current.getContext('2d');
    if (ctx) {
      const imageData = ctx.getImageData(
        0,
        0,
        displayCanvasRef.current.width,
        displayCanvasRef.current.height
      );
      setCanvasState((prev) => (prev ? addToHistory(prev, imageData) : null));
    }

    setIsDrawing(false);
  };

  const handleUndo = () => {
    setCanvasState((prev) => (prev ? undo(prev) : null));
  };

  const handleRedo = () => {
    setCanvasState((prev) => (prev ? redo(prev) : null));
  };

  const handleSaveCleanup = async () => {
    if (!canvasState || !displayCanvasRef.current) return;

    try {
      const imageData = displayCanvasRef.current.getContext('2d')?.getImageData(
        0,
        0,
        displayCanvasRef.current.width,
        displayCanvasRef.current.height
      );

      if (!imageData) throw new Error('Failed to get image data');

      const blob = await imageDataToBlob(imageData);
      const item = items[currentImageIndex];

      updateDatasetItem(item.id, { imageData: blob });
      addNotification('success', 'Image cleanup saved');

      // Move to next image
      if (currentImageIndex < items.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
      } else {
        addNotification('success', 'All images reviewed');
      }
    } catch (error) {
      console.error('Failed to save cleanup:', error);
      addNotification('error', 'Failed to save cleanup');
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images to clean. Import or crop images first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setTool('brush')}
              className={`p-2 rounded-md transition-colors ${
                tool === 'brush'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
              title="Brush tool"
            >
              <Pencil size={18} />
            </button>

            <button
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-md transition-colors ${
                tool === 'eraser'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
              title="Eraser tool"
            >
              <Eraser size={18} />
            </button>

            <button
              onClick={() => setTool('eyedropper')}
              className={`p-2 rounded-md transition-colors ${
                tool === 'eyedropper'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-muted'
              }`}
              title="Color picker"
            >
              <Droplet size={18} />
            </button>

            <div className="w-px bg-border mx-2" />

            <button
              onClick={handleUndo}
              disabled={!canvasState || canvasState.historyIndex === 0}
              className="p-2 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
              title="Undo"
            >
              <Undo2 size={18} />
            </button>

            <button
              onClick={handleRedo}
              disabled={!canvasState || canvasState.historyIndex === canvasState.brushHistory.length - 1}
              className="p-2 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
              title="Redo"
            >
              <Redo2 size={18} />
            </button>
          </div>

          <div className="flex gap-4 items-center">
            <div>
              <label className="text-sm font-medium block mb-1">Color</label>
              <input
                type="color"
                value={brushSettings.color}
                onChange={(e) =>
                  setBrushSettings((prev) => ({ ...prev, color: e.target.value }))
                }
                className="w-12 h-8 rounded cursor-pointer"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Size: {brushSettings.size}</label>
              <input
                type="range"
                min="1"
                max="100"
                value={brushSettings.size}
                onChange={(e) =>
                  setBrushSettings((prev) => ({ ...prev, size: parseInt(e.target.value) }))
                }
                className="w-32"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Opacity: {brushSettings.opacity.toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={brushSettings.opacity}
                onChange={(e) =>
                  setBrushSettings((prev) => ({ ...prev, opacity: parseFloat(e.target.value) }))
                }
                className="w-32"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Hardness: {brushSettings.hardness.toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={brushSettings.hardness}
                onChange={(e) =>
                  setBrushSettings((prev) => ({ ...prev, hardness: parseFloat(e.target.value) }))
                }
                className="w-32"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => setZoom(Math.max(1, zoom - 0.5))}
            className="p-2 rounded-md bg-secondary hover:bg-muted transition-colors"
          >
            <ZoomOut size={18} />
          </button>

          <span className="text-sm font-mono w-12 text-center">{zoom.toFixed(1)}x</span>

          <button
            onClick={() => setZoom(zoom + 0.5)}
            className="p-2 rounded-md bg-secondary hover:bg-muted transition-colors"
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      {canvasState && (
        <div className="rounded-lg border border-border overflow-auto bg-black flex items-center justify-center" style={{ height: '500px' }}>
          <canvas
            ref={displayCanvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ transform: `scale(${zoom})`, cursor: tool === 'eyedropper' ? 'crosshair' : 'crosshair' }}
            className="block"
          />
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))}
          disabled={currentImageIndex === 0}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Previous
        </button>

        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">
            Image {currentImageIndex + 1} of {items.length}
          </span>
        </div>

        <button
          onClick={() => setCurrentImageIndex(Math.min(items.length - 1, currentImageIndex + 1))}
          disabled={currentImageIndex === items.length - 1}
          className="px-4 py-2 bg-secondary rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Next
        </button>

        <button
          onClick={handleSaveCleanup}
          className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );
};
