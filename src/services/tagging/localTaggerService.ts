import type { InferenceSession, Tensor } from 'onnxruntime-web';

export type LocalTaggerRuntime = 'webgpu' | 'wasm';

export type LocalTaggerPrediction = {
  tag: string;
  score: number;
};

export type LocalTaggerBundle = {
  name: string;
  session: InferenceSession;
  inputName: string;
  outputName: string;
  tags: string[];
  inputWidth: number;
  inputHeight: number;
  layout: 'nhwc' | 'nchw';
  runtime: LocalTaggerRuntime;
};

export type LocalTaggerProgress = (message: string) => void;

type DirectoryBundleSource = {
  kind: 'directory';
  name: string;
  handle: FileSystemDirectoryHandle;
};

type FileBundleSource = {
  kind: 'files';
  name: string;
  files: File[];
};

export type LocalTaggerBundleSource = DirectoryBundleSource | FileBundleSource;

type OrtModule = typeof import('onnxruntime-web/all');

const REQUIRED_MODEL_FILE = 'model.onnx';
const REQUIRED_TAGS_FILE = 'selected_tags.csv';
const DEFAULT_INPUT_SIZE = 448;
const ORT_WASM_URL = new URL(
  '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
  import.meta.url
).href;

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
};

const normalizeTagName = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '_');

export const parseSelectedTagsCsv = (csv: string): string[] => {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('selected_tags.csv must contain a header row and at least one tag row.');
  }

  const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  const nameIndex = header.indexOf('name');

  if (nameIndex === -1) {
    throw new Error('selected_tags.csv is missing the required "name" column.');
  }

  const tags = lines
    .slice(1)
    .map((line) => normalizeTagName(parseCsvLine(line)[nameIndex] ?? ''))
    .filter(Boolean);

  if (tags.length === 0) {
    throw new Error('selected_tags.csv did not contain any parseable tag names.');
  }

  return tags;
};

const getFileFromDirectory = async (
  handle: FileSystemDirectoryHandle,
  fileName: string
): Promise<File | undefined> => {
  try {
    const fileHandle = await handle.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return undefined;
  }
};

const getFileFromSelection = (files: File[], fileName: string): File | undefined =>
  files.find((file) => {
    const relativePath = file.webkitRelativePath || file.name;
    const pathParts = relativePath.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1] === fileName;
  });

const readBundleFiles = async (
  source: LocalTaggerBundleSource
): Promise<{ modelFile: File; tagsFile: File }> => {
  const modelFile =
    source.kind === 'directory'
      ? await getFileFromDirectory(source.handle, REQUIRED_MODEL_FILE)
      : getFileFromSelection(source.files, REQUIRED_MODEL_FILE);
  const tagsFile =
    source.kind === 'directory'
      ? await getFileFromDirectory(source.handle, REQUIRED_TAGS_FILE)
      : getFileFromSelection(source.files, REQUIRED_TAGS_FILE);

  const missing = [
    modelFile ? undefined : REQUIRED_MODEL_FILE,
    tagsFile ? undefined : REQUIRED_TAGS_FILE,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required file(s): ${missing.join(', ')}.`);
  }

  return { modelFile: modelFile!, tagsFile: tagsFile! };
};

const inferInputSpec = (session: InferenceSession) => {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const metadata = session.inputMetadata.find((entry) => entry.name === inputName);
  const dims = metadata?.isTensor ? metadata.shape : [];
  const numericDims = dims.map((dimension) => (typeof dimension === 'number' ? dimension : undefined));
  const secondDim = numericDims[1];
  const layout: 'nhwc' | 'nchw' = secondDim === 3 ? 'nchw' : 'nhwc';
  const height = layout === 'nchw' ? numericDims[2] : numericDims[1];
  const width = layout === 'nchw' ? numericDims[3] : numericDims[2];

  if (!inputName || !outputName) {
    throw new Error('The ONNX model does not expose a usable input and output.');
  }

  return {
    inputName,
    outputName,
    inputWidth: width && width > 0 ? width : DEFAULT_INPUT_SIZE,
    inputHeight: height && height > 0 ? height : DEFAULT_INPUT_SIZE,
    layout,
  };
};

const validateOutputTagCount = (session: InferenceSession, outputName: string, tagCount: number) => {
  const metadata = session.outputMetadata.find((entry) => entry.name === outputName);
  const shape = metadata?.isTensor ? metadata.shape : [];
  const outputCount = [...shape].reverse().find((dimension) => typeof dimension === 'number' && dimension > 1);

  if (typeof outputCount === 'number' && outputCount !== tagCount) {
    throw new Error(
      `selected_tags.csv contains ${tagCount} tags, but the model output expects ${outputCount}.`
    );
  }
};

const createSession = async (
  ort: OrtModule,
  modelBuffer: ArrayBuffer,
  onProgress?: LocalTaggerProgress
): Promise<{ session: InferenceSession; runtime: LocalTaggerRuntime }> => {
  const webGpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

  if (!globalThis.crossOriginIsolated) {
    ort.env.wasm.numThreads = 1;
  }
  ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL };

  if (webGpuAvailable) {
    try {
      onProgress?.('Loading ONNX model with WebGPU acceleration...');
      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu'],
      });
      return { session, runtime: 'webgpu' };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[tagging] WebGPU model load failed, falling back to WASM', error);
      }
    }
  }

  onProgress?.('Loading ONNX model with WASM runtime...');
  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
  });
  return { session, runtime: 'wasm' };
};

export const connectLocalTaggerBundle = async (
  source: LocalTaggerBundleSource,
  onProgress?: LocalTaggerProgress
): Promise<LocalTaggerBundle> => {
  onProgress?.('Validating model folder...');
  const { modelFile, tagsFile } = await readBundleFiles(source);

  onProgress?.('Reading selected_tags.csv...');
  const tags = parseSelectedTagsCsv(await tagsFile.text());

  onProgress?.('Loading browser ONNX runtime...');
  const ort = await import('onnxruntime-web/all');

  const { session, runtime } = await createSession(ort, await modelFile.arrayBuffer(), onProgress);

  try {
    const inputSpec = inferInputSpec(session);
    validateOutputTagCount(session, inputSpec.outputName, tags.length);

    if (tags.length === 0) {
      throw new Error('selected_tags.csv did not contain any usable tags.');
    }

    return {
      name: source.name || 'Local model',
      session,
      tags,
      runtime,
      ...inputSpec,
    };
  } catch (error) {
    await session.release();
    throw error;
  }
};

const loadImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: 'default' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Failed to decode image for tagging.'));
        element.src = url;
      });
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

const preprocessImage = async (image: Blob, bundle: LocalTaggerBundle): Promise<Tensor> => {
  const ort = await import('onnxruntime-web/all');
  const bitmap = await loadImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = bundle.inputWidth;
  canvas.height = bundle.inputHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Browser canvas is unavailable for image preprocessing.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
  const offsetX = Math.round((canvas.width - targetWidth) / 2);
  const offsetY = Math.round((canvas.height - targetHeight) / 2);

  context.drawImage(bitmap, offsetX, offsetY, targetWidth, targetHeight);
  bitmap.close();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const channelSize = canvas.width * canvas.height;
  const data =
    bundle.layout === 'nhwc'
      ? new Float32Array(channelSize * 3)
      : new Float32Array(channelSize * 3);

  for (let pixelIndex = 0; pixelIndex < channelSize; pixelIndex += 1) {
    const sourceIndex = pixelIndex * 4;
    const red = pixels[sourceIndex];
    const green = pixels[sourceIndex + 1];
    const blue = pixels[sourceIndex + 2];

    if (bundle.layout === 'nhwc') {
      const targetIndex = pixelIndex * 3;
      data[targetIndex] = red;
      data[targetIndex + 1] = green;
      data[targetIndex + 2] = blue;
    } else {
      data[pixelIndex] = red;
      data[channelSize + pixelIndex] = green;
      data[channelSize * 2 + pixelIndex] = blue;
    }
  }

  const dims =
    bundle.layout === 'nhwc'
      ? [1, canvas.height, canvas.width, 3]
      : [1, 3, canvas.height, canvas.width];

  return new ort.Tensor('float32', data, dims);
};

export const predictLocalTags = async (
  bundle: LocalTaggerBundle,
  image: Blob,
  threshold: number,
  maxTags: number
): Promise<LocalTaggerPrediction[]> => {
  const inputTensor = await preprocessImage(image, bundle);
  const results = await bundle.session.run({ [bundle.inputName]: inputTensor });
  const output = results[bundle.outputName];

  if (!output) {
    throw new Error('The ONNX model did not return the expected output tensor.');
  }

  const scores = Array.from(output.data as Float32Array | number[]);
  return scores
    .map((score, index) => ({ tag: bundle.tags[index], score }))
    .filter((prediction) => prediction.tag && prediction.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxTags);
};
