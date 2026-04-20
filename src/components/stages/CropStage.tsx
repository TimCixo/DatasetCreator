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
import { AlertCircle, ArrowLeft, Check, Move, Plus, Trash2 } from 'lucide-react';

interface CropState {
  frames: CropFrame[];
  selectedFrameId: string | null;
  resizingHandle: string | null;
}

type CleanupWorkingEdit = {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

type CleanupStageState = {
  sourceImageIds?: string[];
  workingEdits?: Record<string, CleanupWorkingEdit>;
};

type CropStageState = {
  workingFrames?: Record<string, CropState>;
};

type PanState = {
  active: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type FrameHit = {
  frameId: string;
  handle: string | null;
  prioritizedSelectedFrame: boolean;
  candidates: string[];
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const HANDLE_IDS = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'] as const;
const HANDLE_SIZE = 10;
const HANDLE_HIT_SIZE = 18;
const FRAME_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const getFrameColor = (index: number) => FRAME_COLORS[index % FRAME_COLORS.length];

const hexToRgba = (hex: string, alpha: number) => {
  const cleanHex = hex.replace('#', '');
  const normalized =
    cleanHex.length === 3
      ? cleanHex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : cleanHex;
  const value = parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getHandleCenter = (frame: CropFrame, handle: string) => {
  let x = frame.x + frame.width / 2;
  let y = frame.y + frame.height / 2;

  if (handle.includes('l')) x = frame.x;
  if (handle.includes('r')) x = frame.x + frame.width;
  if (handle.includes('t')) y = frame.y;
  if (handle.includes('b')) y = frame.y + frame.height;

  return { x, y };
};

const pointInsideFrame = (frame: CropFrame, x: number, y: number) =>
  x >= frame.x &&
  x <= frame.x + frame.width &&
  y >= frame.y &&
  y <= frame.y + frame.height;

const pointInsideHandle = (
  frame: CropFrame,
  handle: string,
  x: number,
  y: number,
  zoom: number,
  size: number = HANDLE_HIT_SIZE
) => {
  const center = getHandleCenter(frame, handle);
  const half = size / zoom / 2;
  return (
    x >= center.x - half &&
    x <= center.x + half &&
    y >= center.y - half &&
    y <= center.y + half
  );
};

const getFrameOverlayStyle = (
  frame: CropFrame,
  imageWidth: number,
  imageHeight: number
) => ({
  left: `${(frame.x / imageWidth) * 100}%`,
  top: `${(frame.y / imageHeight) * 100}%`,
  width: `${(frame.width / imageWidth) * 100}%`,
  height: `${(frame.height / imageHeight) * 100}%`,
});

export const CropStage = () => {
  const sourceImages = useProjectStore((state) => Object.values(state.sourceImages));
  const addDatasetItem = useProjectStore((state) => state.addDatasetItem);
  const removeDatasetItem = useProjectStore((state) => state.removeDatasetItem);
  const datasetItems = useProjectStore((state) => Object.values(state.datasetItems));
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const setStageState = useProjectStore((state) => state.setStageState);
  const cleanupStageState = useProjectStore(
    (state) => (state.stageState.clean as CleanupStageState | undefined) ?? {}
  );
  const cropStageState = useProjectStore(
    (state) => (state.stageState.crop as CropStageState | undefined) ?? {}
  );
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
  const [sessionVersion, setSessionVersion] = useState(0);
  const [finalizedImageIds, setFinalizedImageIds] = useState<Set<string>>(new Set());
  const [isFrameDropdownOpen, setIsFrameDropdownOpen] = useState(false);

  const effectiveSourceImages = useMemo(
    () =>
      sourceImages.map((image) => {
        const workingEdit = cleanupStageState.workingEdits?.[image.id];
        return {
          ...image,
          originalFile: workingEdit?.blob ?? image.originalFile,
          previewUrl: workingEdit?.previewUrl ?? image.previewUrl,
          width: workingEdit?.width ?? image.width,
          height: workingEdit?.height ?? image.height,
        };
      }),
    [cleanupStageState.workingEdits, sourceImages]
  );

  const selectedIndex = useMemo(
    () => (selectedImageId ? effectiveSourceImages.findIndex((image) => image.id === selectedImageId) : -1),
    [effectiveSourceImages, selectedImageId]
  );
  const selectedImage = selectedIndex >= 0 ? effectiveSourceImages[selectedIndex] : null;
  const isEditorMode = Boolean(selectedImage);

  const imageFrameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const image of effectiveSourceImages) {
      counts[image.id] =
        cropStageState.workingFrames?.[image.id]?.frames.length ??
        cropSessionsRef.current[image.id]?.frames.length ??
        0;
    }
    return counts;
  }, [cropStageState.workingFrames, effectiveSourceImages, sessionVersion]);

  const nearbyImages = useMemo(() => {
    if (!selectedImageId) {
      return [];
    }

    const index = effectiveSourceImages.findIndex((image) => image.id === selectedImageId);
    if (index === -1) {
      return [];
    }

    return effectiveSourceImages.filter((_, imageIndex) => Math.abs(imageIndex - index) <= 2);
  }, [effectiveSourceImages, selectedImageId]);

  const frameEntries = useMemo(
    () =>
      cropState.frames.map((frame, index) => ({
        frame,
        index,
        color: getFrameColor(index),
        label: `Frame ${index + 1}`,
        isSelected: frame.id === cropState.selectedFrameId,
      })),
    [cropState.frames, cropState.selectedFrameId]
  );

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

  const renderCanvas = useCallback(
    (image: typeof selectedImage, state: CropState, currentZoom: number) => {
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
        const selectedFrame = state.frames.find((frame) => frame.id === state.selectedFrameId) ?? null;
        const orderedFrames = selectedFrame
          ? [
              ...state.frames.filter((frame) => frame.id !== selectedFrame.id),
              selectedFrame,
            ]
          : state.frames;

        orderedFrames.forEach((frame) => {
          const frameIndex = state.frames.findIndex((candidate) => candidate.id === frame.id);
          const color = getFrameColor(Math.max(frameIndex, 0));
          const isSelected = frame.id === state.selectedFrameId;

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = (isSelected ? 3 : 2) / currentZoom;
          if (isSelected) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 18 / currentZoom;
          }
          ctx.fillStyle = hexToRgba(color, isSelected ? 0.18 : 0.08);
          ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
          ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

          const badgeWidth = 52 / currentZoom;
          const badgeHeight = 20 / currentZoom;
          ctx.fillStyle = color;
          ctx.fillRect(frame.x, Math.max(0, frame.y - badgeHeight), badgeWidth, badgeHeight);
          ctx.fillStyle = '#0f172a';
          ctx.font = `${12 / currentZoom}px sans-serif`;
          ctx.fillText(
            `${frameIndex + 1}`,
            frame.x + 8 / currentZoom,
            Math.max(12 / currentZoom, frame.y - 6 / currentZoom)
          );

          if (isSelected) {
            const handleSize = HANDLE_SIZE / currentZoom;

            HANDLE_IDS.forEach((handle) => {
              const { x, y } = getHandleCenter(frame, handle);
              ctx.fillStyle = color;
              ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1 / currentZoom;
              ctx.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
            });
          }
          ctx.restore();
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
    },
    [addNotification, selectedImage]
  );

  const updateCropState = useCallback(
    (nextState: CropState) => {
      if (!selectedImage) {
        return;
      }

      cropSessionsRef.current[selectedImage.id] = nextState;
      setCropState(nextState);
      setSessionVersion((version) => version + 1);
      setStageState('crop', {
        ...cropStageState,
        workingFrames: {
          ...(cropStageState.workingFrames ?? {}),
          [selectedImage.id]: nextState,
        },
      });

      if (import.meta.env.DEV) {
        console.log(`[crop] crop frame state updated: ${selectedImage.id} -> ${nextState.frames.length} frame(s)`);
        console.log(`[crop] crop gallery preview/state refreshed: ${selectedImage.id}`);
      }
    },
    [cropStageState, selectedImage, setStageState]
  );

  const openImageInEditor = useCallback(
    (imageId: string) => {
      const image = effectiveSourceImages.find((candidate) => candidate.id === imageId);
      if (!image) {
        return;
      }

      const nextState = cropStageState.workingFrames?.[image.id] ?? cropSessionsRef.current[image.id] ?? {
        frames: [],
        selectedFrameId: null,
        resizingHandle: null,
      };

      cropSessionsRef.current[image.id] = nextState;
      baseImageRef.current = null;
      setSelectedImageId(image.id);
      setCropState(nextState);
      setIsFrameDropdownOpen(false);
      fitImageToWorkspace(image.width, image.height);

      if (import.meta.env.DEV) {
        console.log('[crop] mode: editor');
        console.log(`[crop] active image: ${image.id}`);
        console.log(`[crop] active frame: ${nextState.selectedFrameId ?? 'none'}`);
        console.log(
          `[crop] frame list: ${nextState.frames.map((frame, index) => `${index + 1}:${frame.id}`).join(', ') || 'none'}`
        );
        console.log(
          `[crop] current crop working state per image: ${JSON.stringify(
            Object.fromEntries(
              Object.entries(cropStageState.workingFrames ?? {}).map(([id, state]) => [id, state.frames.length])
            )
          )}`
        );
      }
    },
    [cropStageState.workingFrames, effectiveSourceImages, fitImageToWorkspace]
  );

  const closeEditor = useCallback(() => {
    setSelectedImageId(null);
    baseImageRef.current = null;
    setIsFrameDropdownOpen(false);

    if (import.meta.env.DEV) {
      console.log('[crop] mode: gallery');
    }
  }, []);

  const getCanvasCoordinates = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      if (!canvasRef.current) {
        return [0, 0];
      }

      const rect = canvasRef.current.getBoundingClientRect();
      return [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom];
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

  const resolveFrameHit = useCallback(
    (x: number, y: number): FrameHit | null => {
      const selectedFrame =
        cropState.frames.find((frame) => frame.id === cropState.selectedFrameId) ?? null;

      if (selectedFrame) {
        const selectedHandleHit = HANDLE_IDS.find((handle) =>
          pointInsideHandle(selectedFrame, handle, x, y, zoom)
        );

        if (selectedHandleHit) {
          if (import.meta.env.DEV) {
            console.log(`[crop] hit test candidates: ${selectedFrame.id}`);
            console.log(`[crop] selected frame priority applied: ${selectedFrame.id}`);
            console.log(`[crop] handle hit: ${selectedHandleHit} (full square recognized)`);
          }

          return {
            frameId: selectedFrame.id,
            handle: selectedHandleHit,
            prioritizedSelectedFrame: true,
            candidates: [selectedFrame.id],
          };
        }
      }

      const reversedFrames = [...cropState.frames].reverse();
      const handleCandidates = reversedFrames.filter((frame) =>
        HANDLE_IDS.some((handle) => pointInsideHandle(frame, handle, x, y, zoom))
      );

      if (handleCandidates.length > 0) {
        const targetFrame = handleCandidates[0];
        const targetHandle =
          HANDLE_IDS.find((handle) => pointInsideHandle(targetFrame, handle, x, y, zoom)) ?? null;

        if (import.meta.env.DEV) {
          console.log(
            `[crop] hit test candidates: ${handleCandidates.map((frame) => frame.id).join(', ')}`
          );
          console.log('[crop] selected frame priority applied: no');
          console.log(`[crop] handle hit: ${targetHandle ?? 'none'} (full square recognized)`);
        }

        return {
          frameId: targetFrame.id,
          handle: targetHandle,
          prioritizedSelectedFrame: false,
          candidates: handleCandidates.map((frame) => frame.id),
        };
      }

      const hitCandidates = reversedFrames.filter((frame) => pointInsideFrame(frame, x, y));
      const candidateIds = hitCandidates.map((frame) => frame.id);
      const selectedFrameContainsPoint = selectedFrame ? pointInsideFrame(selectedFrame, x, y) : false;
      const prioritizedFrame = selectedFrameContainsPoint ? selectedFrame : hitCandidates[0] ?? null;

      if (!prioritizedFrame) {
        if (import.meta.env.DEV) {
          console.log('[crop] hit test candidates: none');
        }
        return null;
      }

      const handleHit = HANDLE_IDS.find((handle) => {
        return pointInsideHandle(prioritizedFrame, handle, x, y, zoom);
      });

      if (import.meta.env.DEV) {
        console.log(`[crop] hit test candidates: ${candidateIds.join(', ') || prioritizedFrame.id}`);
        console.log(
          `[crop] selected frame priority applied: ${
            selectedFrameContainsPoint ? prioritizedFrame.id : 'no'
          }`
        );
        console.log(
          `[crop] handle hit: ${handleHit ?? 'none'} (${handleHit ? 'full square recognized' : 'frame body'})`
        );
      }

      return {
        frameId: prioritizedFrame.id,
        handle: handleHit ?? null,
        prioritizedSelectedFrame: selectedFrameContainsPoint,
        candidates: candidateIds,
      };
    },
    [cropState.frames, cropState.selectedFrameId, zoom]
  );

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

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[crop] mode: ${isEditorMode ? 'editor' : 'gallery'}`);
      console.log(
        `[crop] crop working frame count per image in gallery mode: ${JSON.stringify(imageFrameCounts)}`
      );
    }
  }, [imageFrameCounts, isEditorMode]);

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
    const hit = resolveFrameHit(x, y);

    if (!hit) {
      return;
    }

    updateCropState({
      ...cropState,
      selectedFrameId: hit.frameId,
      resizingHandle: hit.handle,
    });
    setIsDragging(true);
    setDragStart({ x, y });

    if (import.meta.env.DEV) {
      console.log(`[crop] active frame: ${hit.frameId}`);
      console.log(`[crop] dragging frame: ${hit.frameId}`);
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
      : moveCropFrame(selectedFrame, dx, dy, selectedImage.width, selectedImage.height);

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
      console.log(`[crop] active frame: ${newFrame.id}`);
      console.log(
        `[crop] frame list: ${nextState.frames.map((frame, index) => `${index + 1}:${frame.id}`).join(', ')}`
      );
    }
  };

  const handleRemoveSelectedFrame = () => {
    if (!cropState.selectedFrameId) {
      return;
    }

    const nextFrames = cropState.frames.filter((frame) => frame.id !== cropState.selectedFrameId);
    const nextSelectedFrameId = nextFrames[0]?.id ?? null;
    updateCropState({
      ...cropState,
      frames: nextFrames,
      selectedFrameId: nextSelectedFrameId,
    });

    if (import.meta.env.DEV) {
      console.log(`[crop] active frame: ${nextSelectedFrameId ?? 'none'}`);
      console.log(
        `[crop] frame list: ${nextFrames.map((frame, index) => `${index + 1}:${frame.id}`).join(', ') || 'none'}`
      );
    }
  };

  const handleSelectFrame = (frameId: string) => {
    updateCropState({
      ...cropState,
      selectedFrameId: frameId,
    });
    setIsFrameDropdownOpen(false);

    if (import.meta.env.DEV) {
      console.log(`[crop] frame selector changed: ${frameId}`);
      console.log(`[crop] active frame: ${frameId}`);
    }
  };

  const finalizeCrops = useCallback(async () => {
    let createdCount = 0;
    const finalizedImages = new Set<string>();
    const cleanupEdits = cleanupStageState.workingEdits ?? {};
    const workingFrames = cropStageState.workingFrames ?? {};

    for (const item of datasetItems) {
      if (item.type === 'crop') {
        removeDatasetItem(item.id);
      }
    }

    for (const image of effectiveSourceImages) {
      const session = workingFrames[image.id] ?? cropSessionsRef.current[image.id];
      if (!session || session.frames.length === 0) {
        continue;
      }

      const cropSource = cleanupEdits[image.id]?.blob ?? image.originalFile;

      for (const frame of session.frames) {
        const croppedBlob = await cropImage(
          cropSource,
          frame.x,
          frame.y,
          frame.width,
          frame.height
        );

        const datasetItem = createDatasetItem(
          image.id,
          croppedBlob,
          frame.width,
          frame.height,
          'crop',
          frame.aspectRatio
        );
        datasetItem.cropFrame = frame;
        addDatasetItem(datasetItem);
        createdCount += 1;
      }

      finalizedImages.add(image.id);
    }

    setFinalizedImageIds(finalizedImages);
    if (import.meta.env.DEV) {
      console.log(`[augment-transition] cleanup-edited images materialized: ${Object.keys(cleanupEdits).length}`);
      console.log(`[augment-transition] crop-defined outputs materialized: ${createdCount}`);
      console.log(
        `[augment-transition] final derived input count received by Augment Dataset: ${
          useProjectStore.getState().getDatasetItems(false).length
        }`
      );
    }
    return createdCount;
  }, [addDatasetItem, cleanupStageState.workingEdits, cropStageState.workingFrames, datasetItems, effectiveSourceImages, removeDatasetItem]);

  const handleFinishCrop = async () => {
    try {
      const createdCount = await finalizeCrops();
      if (createdCount === 0) {
        addNotification('warning', 'Create at least one crop frame before finishing');
        return;
      }

      if (import.meta.env.DEV) {
        console.log('[crop] Finish Crop transition target stage: augment');
      }
      addNotification('success', `Created ${createdCount} crop${createdCount !== 1 ? 's' : ''}`);
      setCurrentStage('augment');
    } catch (error) {
      console.error('Failed to finalize crop stage:', error);
      addNotification('error', 'Failed to finalize crop stage');
    }
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
    <div className="rounded-lg border border-border bg-card overflow-hidden min-h-[calc(100vh-13rem)] flex flex-col">
      {!selectedImage ? (
        <>
          <div className="border-b border-border p-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Crop Gallery</h3>
              <p className="text-sm text-muted-foreground">
                Choose an image to crop. Frames stay in working state until you finish the stage.
              </p>
            </div>
            <button
              onClick={() => void handleFinishCrop()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
            >
              Finish Crop
            </button>
          </div>

          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 overflow-y-auto">
            {effectiveSourceImages.map((image, index) => {
              const frameState =
                cropStageState.workingFrames?.[image.id] ?? cropSessionsRef.current[image.id] ?? null;
              const frameCount = frameState?.frames.length ?? 0;

              if (import.meta.env.DEV) {
                console.log(`[crop] whether crop gallery preview is built from remembered crop state: ${image.id} -> ${frameCount > 0}`);
                console.log(`[crop] whether gallery overlay reflects frame count correctly: ${image.id} -> ${frameCount}`);
              }

              return (
                <button
                  key={image.id}
                  onClick={() => openImageInEditor(image.id)}
                  className="group relative rounded-lg overflow-hidden bg-secondary border border-border hover:border-primary transition-colors text-left"
                >
                  <div className="relative aspect-square bg-black flex items-center justify-center overflow-hidden">
                    {(cleanupStageState.workingEdits?.[image.id]?.previewUrl ?? image.previewUrl) ? (
                      <img
                        src={cleanupStageState.workingEdits?.[image.id]?.previewUrl ?? image.previewUrl}
                        alt={image.fileName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{image.width} x {image.height}</span>
                    )}

                    {frameState?.frames.map((frame, frameIndex) => (
                      <div
                        key={frame.id}
                        className="absolute rounded-sm pointer-events-none"
                        style={{
                          ...getFrameOverlayStyle(frame, image.width, image.height),
                          border: `2px solid ${getFrameColor(frameIndex)}`,
                          backgroundColor: hexToRgba(getFrameColor(frameIndex), 0.14),
                          boxShadow: `0 0 0 1px ${hexToRgba(getFrameColor(frameIndex), 0.35)} inset`,
                        }}
                      />
                    ))}

                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-white">Image #{index + 1}</p>
                          <p className="text-xs text-gray-300">
                            {frameCount === 0 ? 'No crop frames' : `Frames: ${frameCount}`}
                          </p>
                        </div>
                        {finalizedImageIds.has(image.id) && (
                          <Check size={16} className="text-green-400 shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={closeEditor}
                className="p-2 rounded-md bg-secondary hover:bg-muted transition-colors"
                title="Back to gallery"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 className="font-semibold">Crop Image</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedImage.fileName} - {selectedIndex + 1} / {sourceImages.length}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Wheel: zoom</span>
              <span>-</span>
              <span>MMB / Space+Drag: pan</span>
            </div>
          </div>

          <div className="border-b border-border p-4 flex items-start gap-4 flex-wrap">
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

            <div className="min-w-[240px] flex-1">
              <label className="text-sm font-medium block mb-1">Crop Frames</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsFrameDropdownOpen((open) => !open)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 flex items-center justify-between gap-3 text-left"
                >
                  {frameEntries.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No frames yet</span>
                  ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            frameEntries.find((entry) => entry.isSelected)?.color ?? frameEntries[0].color,
                        }}
                      />
                      <span className="text-sm font-medium truncate">
                        {frameEntries.find((entry) => entry.isSelected)?.label ?? frameEntries[0].label}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {frameEntries.find((entry) => entry.isSelected)?.frame.id ?? frameEntries[0].frame.id}
                      </span>
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {isFrameDropdownOpen ? 'Close' : 'Select'}
                  </span>
                </button>

                {isFrameDropdownOpen && frameEntries.length > 0 && (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                    {frameEntries.map((entry) => (
                      <button
                        key={entry.frame.id}
                        type="button"
                        onClick={() => handleSelectFrame(entry.frame.id)}
                        className={`w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition-colors ${
                          entry.isSelected ? 'bg-primary/10' : 'hover:bg-secondary'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-sm font-medium truncate">{entry.label}</span>
                          <span className="text-xs text-muted-foreground truncate">{entry.frame.id}</span>
                        </div>
                        {entry.isSelected && (
                          <span className="text-xs font-medium text-primary">Active</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="text-sm text-muted-foreground mt-6">
              {cropState.frames.length} frame{cropState.frames.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-[72px_minmax(0,1fr)_220px]">
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
                onClick={() => {
                  const firstFrameId = cropState.frames[0]?.id ?? null;
                  if (firstFrameId) {
                    handleSelectFrame(firstFrameId);
                  }
                }}
                disabled={cropState.frames.length === 0}
                className="p-3 rounded-md bg-secondary hover:bg-muted disabled:opacity-50 transition-colors"
                title="Select first frame"
              >
                <Move size={18} />
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

            <div className="border-l border-border bg-secondary/20 p-3 overflow-y-auto">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                Images
              </p>
              <div className="space-y-3">
                {nearbyImages.map((image) => (
                  <button
                    key={image.id}
                    onClick={() => openImageInEditor(image.id)}
                    className={`w-full text-left rounded-lg border p-2 transition-colors ${
                      image.id === selectedImage.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40 bg-background'
                    }`}
                  >
                    <div className="aspect-square rounded-md overflow-hidden bg-black mb-2 flex items-center justify-center">
                      {image.previewUrl ? (
                        <img src={image.previewUrl} alt={image.fileName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground text-center px-2">
                          {image.width} x {image.height}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium truncate">{image.fileName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {imageFrameCounts[image.id] ?? 0} frame(s)
                    </p>
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
