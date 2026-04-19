import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ASPECT_RATIOS, ASPECT_RATIO_LABELS } from '../../lib/constants';
import { cropImage } from '../../services/image/imageProcessor';
import {
  createCenteredCropFrame,
  moveCropFrame,
  resizeCropFrameFromHandle,
} from '../../services/crop/cropService';
import { createDatasetItem, type CropFrame, type AspectRatio } from '../../types';
import { AlertCircle, ArrowLeft, Check, Crop as CropIcon, Move, Plus, Trash2 } from 'lucide-react';

interface CropState {
  frames: CropFrame[];
  selectedFrameId: string | null;
  resizingHandle: string | null;
}

type PanState = {
  active: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const CropStage = () => {
  const sourceImages = useProjectStore((state) => Object.values(state.sourceImages));
  const addDatasetItem = useProjectStore((state) => state.addDatasetItem);
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const { addNotification } = useUIStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const isSpacePressedRef = useRef(false);
  const cropSessionsRef = useRef<Record<string, CropState>>({});
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>('1:1');
  const [cropState, setCropState] = useState<CropState>({
    frames: [],
    selectedFrameId: null,
    resizingHandle: null,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panState, setPanState] = useState<PanState>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const [appliedImageIds, setAppliedImageIds] = useState<Set<string>>(new Set());

  const selectedIndex = useMemo(
    () => (selectedImageId ? sourceImages.findIndex((image) => image.id === selectedImageId) : -1),
    [selectedImageId, sourceImages]
  );
  const selectedImage = selectedIndex >= 0 ? sourceImages[selectedIndex] : null;

  const fitImageToWorkspace = useCallback((width: number, height: number) => {
    if (!workspaceRef.current) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    const bounds = workspaceRef.current.getBoundingClientRect();
    const fitScale = Math.min(bounds.width / width, bounds.height / height, 1);
    const resolvedZoom = Math.max(MIN_ZOOM, fitScale);
    const offsetX = Math.max((bounds.width - width * resolvedZoom) / 2, 0);
    const offsetY = Math.max((bounds.height - height * resolvedZoom) / 2, 0);

    setZoom(resolvedZoom);
    setPan({ x: offsetX, y: offsetY });
  }, []);

  const renderCanvas = useCallback((image: typeof selectedImage, state: CropState, currentZoom: number) => {
    if (!canvasRef.current || !image) {
      return;
    }

    const canvas = canvasRef.current;
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const drawFrames = () => {
      state.frames.forEach((frame) => {
        const isSelected = frame.id === state.selectedFrameId;

        ctx.strokeStyle = isSelected ? '#3b82f6' : '#22c55e';
        ctx.lineWidth = 2 / currentZoom;
        ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

        ctx.fillStyle = isSelected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(34, 197, 94, 0.08)';
        ctx.fillRect(frame.x, frame.y, frame.width, frame.height);

        if (isSelected) {
          const handleSize = 8 / currentZoom;
          const handles = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];

          handles.forEach((handle) => {
            let hx = 0;
            let hy = 0;

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
    };

    const existingImage = baseImageRef.current;
    if (existingImage) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(existingImage, 0, 0);
      drawFrames();
      return;
    }

    const url = URL.createObjectURL(image.originalFile);
    const img = new Image();
    img.onload = () => {
      baseImageRef.current = img;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      drawFrames();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      addNotification('error', 'Failed to render crop image');
    };
    img.src = url;
  }, [addNotification]);

  const openImageInEditor = useCallback((imageId: string) => {
    const image = sourceImages.find((candidate) => candidate.id === imageId);
    if (!image) {
      return;
    }

    const nextState = cropSessionsRef.current[image.id] ?? {
      frames: [],
      selectedFrameId: null,
      resizingHandle: null,
    };

    cropSessionsRef.current[image.id] = nextState;
    baseImageRef.current = null;
    setSelectedImageId(image.id);
    setCropState(nextState);
    fitImageToWorkspace(image.width, image.height);

    if (import.meta.env.DEV) {
      console.log(`[crop] active image id: ${image.id}`);
      console.log(`[crop] crop frame count: ${nextState.frames.length}`);
    }
  }, [fitImageToWorkspace, sourceImages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        isSpacePressedRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    renderCanvas(selectedImage, cropState, zoom);
  }, [cropState, renderCanvas, selectedImage, zoom]);

  const updateCropState = useCallback((nextState: CropState) => {
    if (!selectedImage) {
      return;
    }

    cropSessionsRef.current[selectedImage.id] = nextState;
    setCropState(nextState);
  }, [selectedImage]);

  const getCanvasCoordinates = useCallback((clientX: number, clientY: number): [number, number] => {
    if (!canvasRef.current) {
      return [0, 0];
    }

    const rect = canvasRef.current.getBoundingClientRect();
    return [
      (clientX - rect.left) / zoom,
      (clientY - rect.top) / zoom,
    ];
  }, [zoom]);

  const beginPan = useCallback((clientX: number, clientY: number) => {
    setPanState({
      active: true,
      startX: clientX,
      startY: clientY,
      originX: pan.x,
      originY: pan.y,
    });
  }, [pan.x, pan.y]);

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedImage) {
      return;
    }

    if (event.button === 1 || (event.button === 0 && isSpacePressedRef.current)) {
      event.preventDefault();
      beginPan(event.clientX, event.clientY);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const [x, y] = getCanvasCoordinates(event.clientX, event.clientY);

    for (const frame of cropState.frames) {
      if (frame.id !== cropState.selectedFrameId) {
        continue;
      }

      const handles = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
      const handleSize = 16 / zoom;

      for (const handle of handles) {
        let hx = 0;
        let hy = 0;

        if (handle.includes('l')) hx = frame.x;
        else if (handle.includes('r')) hx = frame.x + frame.width;
        else hx = frame.x + frame.width / 2;

        if (handle.includes('t')) hy = frame.y;
        else if (handle.includes('b')) hy = frame.y + frame.height;
        else hy = frame.y + frame.height / 2;

        if (Math.abs(x - hx) < handleSize / 2 && Math.abs(y - hy) < handleSize / 2) {
          updateCropState({
            ...cropState,
            resizingHandle: handle,
          });
          setIsDragging(true);
          setDragStart({ x, y });
          return;
        }
      }
    }

    const clickedFrame = cropState.frames.find(
      (frame) =>
        x >= frame.x &&
        x <= frame.x + frame.width &&
        y >= frame.y &&
        y <= frame.y + frame.height
    );

    if (clickedFrame) {
      updateCropState({
        ...cropState,
        selectedFrameId: clickedFrame.id,
      });
      setIsDragging(true);
      setDragStart({ x, y });
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (panState.active) {
      setPan({
        x: panState.originX + (event.clientX - panState.startX),
        y: panState.originY + (event.clientY - panState.startY),
      });
      return;
    }

    if (!isDragging || !selectedImage) {
      return;
    }

    const [x, y] = getCanvasCoordinates(event.clientX, event.clientY);
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;

    const selectedFrame = cropState.frames.find((frame) => frame.id === cropState.selectedFrameId);
    if (!selectedFrame) {
      return;
    }

    const nextFrame = cropState.resizingHandle
      ? resizeCropFrameFromHandle(
          selectedFrame,
          cropState.resizingHandle,
          dx,
          dy,
          selectedImage.width,
          selectedImage.height
        )
      : moveCropFrame(
          selectedFrame,
          dx,
          dy,
          selectedImage.width,
          selectedImage.height
        );

    updateCropState({
      ...cropState,
      frames: cropState.frames.map((frame) => (frame.id === selectedFrame.id ? nextFrame : frame)),
    });
    setDragStart({ x, y });
  };

  const finishInteraction = () => {
    if (panState.active) {
      setPanState((prev) => ({ ...prev, active: false }));
    }

    if (isDragging) {
      setIsDragging(false);
      updateCropState({
        ...cropState,
        resizingHandle: null,
      });
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * scaleFactor));
    const ratio = nextZoom / zoom;

    setPan((prev) => ({
      x: event.clientX - (event.clientX - prev.x) * ratio,
      y: event.clientY - (event.clientY - prev.y) * ratio,
    }));
    setZoom(nextZoom);
  };

  const handleAddCropFrame = () => {
    if (!selectedImage) {
      return;
    }

    const newFrame = createCenteredCropFrame(
      selectedImage.width,
      selectedImage.height,
      selectedAspectRatio
    );

    const nextState = {
      ...cropState,
      frames: [...cropState.frames, newFrame],
      selectedFrameId: newFrame.id,
    };
    updateCropState(nextState);

    if (import.meta.env.DEV) {
      console.log(`[crop] crop frame count: ${nextState.frames.length}`);
    }
  };

  const handleRemoveSelectedFrame = () => {
    if (!cropState.selectedFrameId) {
      return;
    }

    const nextFrames = cropState.frames.filter((frame) => frame.id !== cropState.selectedFrameId);
    updateCropState({
      ...cropState,
      frames: nextFrames,
      selectedFrameId: nextFrames[0]?.id ?? null,
    });
  };

  const handleApplyCrops = async () => {
    if (!selectedImage || cropState.frames.length === 0) {
      addNotification('warning', 'No crop frames created');
      return;
    }

    try {
      for (const frame of cropState.frames) {
        const croppedBlob = await cropImage(
          selectedImage.originalFile,
          frame.x,
          frame.y,
          frame.width,
          frame.height
        );

        const datasetItem = createDatasetItem(
          selectedImage.id,
          croppedBlob,
          frame.width,
          frame.height,
          'crop',
          frame.aspectRatio
        );
        datasetItem.cropFrame = frame;
        addDatasetItem(datasetItem);
      }

      setAppliedImageIds((prev) => new Set(prev).add(selectedImage.id));
      addNotification('success', `Created ${cropState.frames.length} crop${cropState.frames.length !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Failed to apply crops:', error);
      addNotification('error', 'Failed to apply crops');
    }
  };

  const handleFinishCrop = () => {
    setCurrentStage('augment');
  };

  if (sourceImages.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No source images available. Import images first.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 h-[calc(100vh-13rem)]">
      <aside className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold">Crop Gallery</h3>
              <p className="text-xs text-muted-foreground">{sourceImages.length} images available</p>
            </div>
            <button
              onClick={handleFinishCrop}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
            >
              Finish Crop
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Select any image to edit. Crop sessions persist while moving between images.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sourceImages.map((image, index) => (
            <button
              key={image.id}
              onClick={() => openImageInEditor(image.id)}
              className={`w-full text-left rounded-lg border p-2 transition-colors ${
                selectedImageId === image.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40 bg-background'
              }`}
            >
              <div className="aspect-square rounded-md overflow-hidden bg-black mb-2 flex items-center justify-center">
                {image.previewUrl ? (
                  <img src={image.previewUrl} alt={image.fileName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground px-2 text-center">{image.width} × {image.height}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium truncate">#{index + 1}</p>
                  <p className="text-xs text-muted-foreground truncate">{image.fileName}</p>
                </div>
                {appliedImageIds.has(image.id) && <Check size={16} className="text-green-500 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-lg border border-border bg-card overflow-hidden flex flex-col min-w-0">
        {!selectedImage ? (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Gallery Overview</h3>
              <p className="text-sm text-muted-foreground">
                Choose an image from the left to open the crop editor, or finish the stage directly.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {sourceImages.map((image, index) => (
                <button
                  key={image.id}
                  onClick={() => openImageInEditor(image.id)}
                  className="rounded-lg border border-border bg-background overflow-hidden hover:border-primary/50 transition-colors text-left"
                >
                  <div className="aspect-square bg-black flex items-center justify-center overflow-hidden">
                    {image.previewUrl ? (
                      <img src={image.previewUrl} alt={image.fileName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{image.width} × {image.height}</span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-sm">Image #{index + 1}</p>
                    <p className="text-xs text-muted-foreground truncate">{image.fileName}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedImageId(null)}
                  className="p-2 rounded-md bg-secondary hover:bg-muted transition-colors"
                  title="Back to gallery"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 className="font-semibold">Crop Image</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedImage.fileName} • {selectedIndex + 1} / {sourceImages.length}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Wheel: zoom</span>
                <span>•</span>
                <span>MMB / Space+Drag: pan</span>
              </div>
            </div>

            <div className="border-b border-border p-4 flex items-center gap-4 flex-wrap">
              <div>
                <label className="text-sm font-medium block mb-1">Aspect Ratio</label>
                <select
                  value={selectedAspectRatio}
                  onChange={(event) => setSelectedAspectRatio(event.target.value as AspectRatio)}
                  className="px-3 py-2 rounded-md border border-border bg-background text-sm"
                >
                  {ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ASPECT_RATIO_LABELS[ratio]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-sm text-muted-foreground mt-5">
                {cropState.frames.length} frame{cropState.frames.length !== 1 ? 's' : ''}
              </div>

              <div className="ml-auto">
                <button
                  onClick={() => void handleApplyCrops()}
                  disabled={cropState.frames.length === 0}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium"
                >
                  Apply Crops
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-[72px_minmax(0,1fr)]">
              <div className="border-r border-border bg-secondary/20 p-3 flex flex-col items-center gap-3">
                <button
                  onClick={handleAddCropFrame}
                  className="p-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  title="Add crop frame"
                >
                  <Plus size={18} />
                </button>
                <button
                  onClick={handleRemoveSelectedFrame}
                  disabled={!cropState.selectedFrameId}
                  className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                  title="Remove selected frame"
                >
                  <Trash2 size={18} />
                </button>
                <button
                  onClick={() => setCropState((prev) => ({ ...prev, selectedFrameId: prev.frames[0]?.id ?? null }))}
                  disabled={cropState.frames.length === 0}
                  className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                  title="Select first frame"
                >
                  <Move size={18} />
                </button>
                <button
                  onClick={() => void handleApplyCrops()}
                  disabled={cropState.frames.length === 0}
                  className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                  title="Apply crops"
                >
                  <CropIcon size={18} />
                </button>
              </div>

              <div
                ref={workspaceRef}
                onWheel={handleWheel}
                className="relative overflow-hidden bg-black"
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={finishInteraction}
                  onMouseLeave={finishInteraction}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'top left',
                    cursor: panState.active || isSpacePressedRef.current ? 'grab' : 'move',
                  }}
                  className="absolute top-0 left-0 select-none"
                />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
