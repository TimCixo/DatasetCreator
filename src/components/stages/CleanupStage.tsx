import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { blobToImageData, imageDataToBlob } from '../../services/image/imageProcessor';
import {
  addToHistory,
  createCanvasState,
  drawBrushStroke,
  drawEraserStroke,
  getCurrentImageData,
  redo,
  sampleColor,
  undo,
  type BrushSettings,
  type CanvasState,
} from '../../services/cleanup/canvasEditor';
import { type DatasetItem, type SourceImage } from '../../types';
import { AlertCircle, ArrowLeft, Check, Droplet, Eraser, Pencil, Redo2, Undo2 } from 'lucide-react';

type CleanupImage =
  | {
      kind: 'dataset';
      id: string;
      blob: Blob;
      width: number;
      height: number;
      label: string;
      sourceImageId?: string;
      previewUrl?: string;
    }
  | {
      kind: 'source';
      id: string;
      blob: Blob;
      width: number;
      height: number;
      label: string;
      sourceImageId: string;
      previewUrl?: string;
    };

type PanState = {
  active: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export const CleanupStage = () => {
  const datasetItems = useProjectStore((state) =>
    Object.values(state.datasetItems).filter((item) => !item.deleted)
  );
  const sourceImages = useProjectStore((state) => state.sourceImages);
  const cleanupStageState = useProjectStore(
    (state) => state.stageState.clean as { sourceImageIds?: string[] } | undefined
  );
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const updateDatasetItem = useProjectStore((state) => state.updateDatasetItem);
  const updateSourceImage = useProjectStore((state) => state.updateSourceImage);
  const { addNotification } = useUIStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const isSpacePressedRef = useRef(false);
  const sessionsRef = useRef<Record<string, CanvasState>>({});
  const strokeDraftRef = useRef<ImageData | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const openingImageIdRef = useRef<string | null>(null);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [tool, setTool] = useState<'brush' | 'eraser' | 'eyedropper'>('brush');
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    opacity: 1,
    hardness: 0.8,
    color: '#000000',
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState({ x: 0, y: 0 });
  const [panState, setPanState] = useState<PanState>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const [persistedImageIds, setPersistedImageIds] = useState<Set<string>>(new Set());
  const [sessionVersion, setSessionVersion] = useState(0);

  const items = useMemo<CleanupImage[]>(() => {
    if (datasetItems.length > 0) {
      return datasetItems.map((item: DatasetItem) => ({
        kind: 'dataset',
        id: item.id,
        blob: item.imageData,
        width: item.width,
        height: item.height,
        label: `${item.type} - ${item.aspectRatio}`,
        sourceImageId: item.sourceImageId,
      }));
    }

    const preferredIds = cleanupStageState?.sourceImageIds ?? Object.keys(sourceImages);
    return preferredIds
      .map((id) => sourceImages[id])
      .filter((image): image is SourceImage => Boolean(image))
      .map((image) => ({
        kind: 'source',
        id: image.id,
        sourceImageId: image.id,
        blob: image.originalFile,
        width: image.width,
        height: image.height,
        label: image.fileName,
        previewUrl: image.previewUrl,
      }));
  }, [cleanupStageState, datasetItems, sourceImages]);

  const selectedItem = items.find((item) => item.id === selectedImageId) ?? null;
  const currentSession = selectedImageId ? sessionsRef.current[selectedImageId] ?? null : null;

  const nearbyItems = useMemo(() => {
    if (!selectedImageId) {
      return [];
    }

    const selectedIndex = items.findIndex((item) => item.id === selectedImageId);
    if (selectedIndex === -1) {
      return [];
    }

    return items.filter((_, index) => Math.abs(index - selectedIndex) <= 2);
  }, [items, selectedImageId]);

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

  const renderImageData = useCallback((imageData: ImageData | null) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) {
      return;
    }

    if (
      canvasSizeRef.current.width !== imageData.width ||
      canvasSizeRef.current.height !== imageData.height
    ) {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvasSizeRef.current = { width: imageData.width, height: imageData.height };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(imageData, 0, 0);

    if (import.meta.env.DEV) {
      console.log('[cleanup] canvas redraw from session state');
    }
  }, []);

  const syncSession = useCallback((imageId: string, nextState: CanvasState) => {
    sessionsRef.current[imageId] = nextState;
    setSessionVersion((version) => version + 1);
  }, []);

  const renderSessionToCanvas = useCallback(
    (imageId: string, reason: string) => {
      const session = sessionsRef.current[imageId];
      if (!session) {
        return;
      }

      if (import.meta.env.DEV) {
        console.log(`[cleanup] render session: ${imageId} (${reason})`);
      }

      renderImageData(getCurrentImageData(session));
    },
    [renderImageData]
  );

  const persistImageData = useCallback(
    async (item: CleanupImage, imageData: ImageData) => {
      const blob = await imageDataToBlob(imageData);

      if (item.kind === 'dataset') {
        updateDatasetItem(item.id, { imageData: blob });
      } else {
        const sourceImage = sourceImages[item.id];
        if (sourceImage?.previewUrl) {
          try {
            URL.revokeObjectURL(sourceImage.previewUrl);
          } catch (error) {
            console.warn('Failed to revoke previous preview URL', error);
          }
        }

        updateSourceImage(item.id, {
          originalFile: blob,
          previewUrl: URL.createObjectURL(blob),
        });
      }

      setPersistedImageIds((prev) => new Set(prev).add(item.id));

      if (import.meta.env.DEV) {
        console.log(`[cleanup] finish-stage persist success: ${item.id}`);
      }
    },
    [sourceImages, updateDatasetItem, updateSourceImage]
  );

  const saveAllEdits = useCallback(async () => {
    for (const item of items) {
      const session = sessionsRef.current[item.id];
      if (!session) {
        continue;
      }

      await persistImageData(item, getCurrentImageData(session));
    }
  }, [items, persistImageData]);

  const openImageInEditor = useCallback(
    async (imageId: string) => {
      const item = items.find((candidate) => candidate.id === imageId);
      if (!item) {
        return;
      }

      if (selectedImageId === imageId && sessionsRef.current[imageId]) {
        return;
      }

      openingImageIdRef.current = imageId;

      try {
        let session = sessionsRef.current[imageId];

        if (!session) {
          const imageData = await blobToImageData(item.blob);
          session = createCanvasState(imageData);
          sessionsRef.current[imageId] = session;
          setSessionVersion((version) => version + 1);
        }

        setSelectedImageId(imageId);
        setBrushSettings(session.currentBrushSettings);
        strokeDraftRef.current = null;
        fitImageToWorkspace(session.baseImage.width, session.baseImage.height);
        renderImageData(getCurrentImageData(session));

        if (import.meta.env.DEV) {
          console.log(`[cleanup] editor open image: ${imageId}`);
          console.log(`[cleanup] active image id: ${imageId}`);
        }
      } catch (error) {
        console.error('Failed to open cleanup editor:', error);
        addNotification('error', 'Failed to open image editor');
      } finally {
        if (openingImageIdRef.current === imageId) {
          openingImageIdRef.current = null;
        }
      }
    },
    [addNotification, fitImageToWorkspace, items, renderImageData, selectedImageId]
  );

  useEffect(() => {
    if (!selectedImageId) {
      return;
    }

    const stillExists = items.some((item) => item.id === selectedImageId);
    if (!stillExists) {
      setSelectedImageId(null);
    }
  }, [items, selectedImageId]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[cleanup] images available to clean: ${items.length}`);
    }
  }, [items.length]);

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
    if (!selectedImageId || !currentSession) {
      return;
    }

    if (openingImageIdRef.current === selectedImageId) {
      if (import.meta.env.DEV) {
        console.log(`[cleanup] effect skipped while opening: ${selectedImageId}`);
      }
      return;
    }

    renderSessionToCanvas(selectedImageId, 'session-version-sync');
  }, [currentSession, renderSessionToCanvas, selectedImageId, sessionVersion]);

  const getCanvasCoordinates = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      if (!canvasRef.current) {
        return [0, 0];
      }

      const rect = canvasRef.current.getBoundingClientRect();
      const x = (clientX - rect.left) / zoom;
      const y = (clientY - rect.top) / zoom;
      return [x, y];
    },
    [zoom]
  );

  const beginPan = useCallback(
    (clientX: number, clientY: number) => {
      setPanState({
        active: true,
        startX: clientX,
        startY: clientY,
        originX: pan.x,
        originY: pan.y,
      });
    },
    [pan.x, pan.y]
  );

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedItem || !currentSession) {
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

    if (event.altKey || tool === 'eyedropper') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const color = sampleColor(ctx, x, y);
        setBrushSettings((prev) => ({ ...prev, color }));
        if (tool === 'eyedropper') {
          setTool('brush');
        }
        addNotification('info', 'Color picked');
      }
      return;
    }

    strokeDraftRef.current = getCurrentImageData(currentSession);
    setLastPoint({ x, y });
    setIsDrawing(true);
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (panState.active) {
      setPan({
        x: panState.originX + (event.clientX - panState.startX),
        y: panState.originY + (event.clientY - panState.startY),
      });
      return;
    }

    if (!isDrawing || !strokeDraftRef.current) {
      return;
    }

    const [x, y] = getCanvasCoordinates(event.clientX, event.clientY);
    const nextImageData =
      tool === 'eraser'
        ? drawEraserStroke(
            strokeDraftRef.current,
            lastPoint.x,
            lastPoint.y,
            x,
            y,
            brushSettings.size,
            brushSettings.hardness
          )
        : drawBrushStroke(
            strokeDraftRef.current,
            lastPoint.x,
            lastPoint.y,
            x,
            y,
            brushSettings
          );

    strokeDraftRef.current = nextImageData;
    renderImageData(nextImageData);
    setLastPoint({ x, y });
  };

  const finishInteraction = () => {
    if (panState.active) {
      setPanState((prev) => ({ ...prev, active: false }));
    }

    if (!isDrawing || !selectedImageId || !currentSession || !strokeDraftRef.current) {
      setIsDrawing(false);
      return;
    }

    const nextState = addToHistory(currentSession, strokeDraftRef.current);
    nextState.currentBrushSettings = brushSettings;
    syncSession(selectedImageId, nextState);
    renderImageData(getCurrentImageData(nextState));
    strokeDraftRef.current = null;
    setIsDrawing(false);

    if (import.meta.env.DEV) {
      console.log(`[cleanup] stroke commit count: ${nextState.historyIndex}`);
      console.log(`[cleanup] undo stack length: ${nextState.historyIndex + 1}`);
      console.log(
        `[cleanup] redo stack length: ${nextState.brushHistory.length - nextState.historyIndex - 1}`
      );
    }
  };

  const handleUndo = () => {
    if (!selectedImageId || !currentSession) {
      return;
    }

    const nextState = undo(currentSession);
    nextState.currentBrushSettings = brushSettings;
    syncSession(selectedImageId, nextState);
    renderImageData(getCurrentImageData(nextState));

    if (import.meta.env.DEV) {
      console.log(`[cleanup] undo stack length: ${nextState.historyIndex + 1}`);
      console.log(
        `[cleanup] redo stack length: ${nextState.brushHistory.length - nextState.historyIndex - 1}`
      );
    }
  };

  const handleRedo = () => {
    if (!selectedImageId || !currentSession) {
      return;
    }

    const nextState = redo(currentSession);
    nextState.currentBrushSettings = brushSettings;
    syncSession(selectedImageId, nextState);
    renderImageData(getCurrentImageData(nextState));

    if (import.meta.env.DEV) {
      console.log(`[cleanup] undo stack length: ${nextState.historyIndex + 1}`);
      console.log(
        `[cleanup] redo stack length: ${nextState.brushHistory.length - nextState.historyIndex - 1}`
      );
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!canvasRef.current) {
      return;
    }

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

  const handleFinishCleanup = async () => {
    try {
      await saveAllEdits();
      addNotification('success', 'Cleanup edits saved');
      setCurrentStage('crop');
    } catch (error) {
      console.error('Failed to finish cleanup:', error);
      addNotification('error', 'Failed to save cleanup edits');
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
    <div className="rounded-lg border border-border bg-card overflow-hidden min-h-[calc(100vh-13rem)] flex flex-col">
      {!selectedItem || !currentSession ? (
        <>
          <div className="border-b border-border p-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Cleanup Gallery</h3>
              <p className="text-sm text-muted-foreground">
                Choose an image to edit. All edits are carried forward automatically.
              </p>
            </div>
            <button
              onClick={handleFinishCleanup}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
            >
              Finish Cleanup
            </button>
          </div>

          <div className="p-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => void openImageInEditor(item.id)}
                className="rounded-lg border border-border bg-background overflow-hidden hover:border-primary/50 transition-colors text-left"
              >
                <div className="aspect-square bg-black flex items-center justify-center overflow-hidden">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt={item.label} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {item.width} x {item.height}
                    </span>
                  )}
                </div>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">Image #{index + 1}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.label}</p>
                  </div>
                  {persistedImageIds.has(item.id) && (
                    <Check size={16} className="text-green-500 shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedImageId(null);
                  strokeDraftRef.current = null;
                  if (import.meta.env.DEV) {
                    console.log('[cleanup] editor close');
                  }
                }}
                className="p-2 rounded-md bg-secondary hover:bg-muted transition-colors"
                title="Back to gallery"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 className="font-semibold">Clean Image</h3>
                <p className="text-xs text-muted-foreground">{selectedItem.label}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Wheel: zoom</span>
              <span>-</span>
              <span>MMB / Space+Drag: pan</span>
              <span>-</span>
              <span>Alt+Click: eyedropper</span>
            </div>
          </div>

          <div className="border-b border-border p-4 flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-sm font-medium block mb-1">Color</label>
              <input
                type="color"
                value={brushSettings.color}
                onChange={(event) =>
                  setBrushSettings((prev) => ({ ...prev, color: event.target.value }))
                }
                className="w-12 h-9 rounded cursor-pointer"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Size: {brushSettings.size}</label>
              <input
                type="range"
                min="1"
                max="100"
                value={brushSettings.size}
                onChange={(event) =>
                  setBrushSettings((prev) => ({ ...prev, size: parseInt(event.target.value, 10) }))
                }
                className="w-36"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">
                Opacity: {brushSettings.opacity.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={brushSettings.opacity}
                onChange={(event) =>
                  setBrushSettings((prev) => ({
                    ...prev,
                    opacity: parseFloat(event.target.value),
                  }))
                }
                className="w-36"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">
                Hardness: {brushSettings.hardness.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={brushSettings.hardness}
                onChange={(event) =>
                  setBrushSettings((prev) => ({
                    ...prev,
                    hardness: parseFloat(event.target.value),
                  }))
                }
                className="w-36"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-[72px_minmax(0,1fr)_220px]">
            <div className="border-r border-border bg-secondary/20 p-3 flex flex-col items-center gap-3">
              <button
                onClick={() => setTool('brush')}
                className={`p-3 rounded-md transition-colors ${
                  tool === 'brush'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary hover:bg-muted'
                }`}
                title="Brush"
              >
                <Pencil size={18} />
              </button>
              <button
                onClick={() => setTool('eraser')}
                className={`p-3 rounded-md transition-colors ${
                  tool === 'eraser'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary hover:bg-muted'
                }`}
                title="Eraser"
              >
                <Eraser size={18} />
              </button>
              <button
                onClick={() => setTool('eyedropper')}
                className={`p-3 rounded-md transition-colors ${
                  tool === 'eyedropper'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary hover:bg-muted'
                }`}
                title="Eyedropper"
              >
                <Droplet size={18} />
              </button>
              <div className="w-full h-px bg-border my-1" />
              <button
                onClick={handleUndo}
                disabled={!currentSession || currentSession.historyIndex === 0}
                className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                title="Undo"
              >
                <Undo2 size={18} />
              </button>
              <button
                onClick={handleRedo}
                disabled={
                  !currentSession ||
                  currentSession.historyIndex === currentSession.brushHistory.length - 1
                }
                className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                title="Redo"
              >
                <Redo2 size={18} />
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
                  cursor: panState.active || isSpacePressedRef.current ? 'grab' : 'crosshair',
                }}
                className="absolute top-0 left-0 select-none"
              />
            </div>

            <div className="border-l border-border bg-secondary/20 p-3 overflow-y-auto">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                Images
              </p>
              <div className="space-y-3">
                {nearbyItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => void openImageInEditor(item.id)}
                    className={`w-full text-left rounded-lg border p-2 transition-colors ${
                      item.id === selectedItem.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40 bg-background'
                    }`}
                  >
                    <div className="aspect-square rounded-md overflow-hidden bg-black mb-2 flex items-center justify-center">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt={item.label} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground text-center px-2">
                          {item.width} x {item.height}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium truncate">{item.label}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
