# Dataset Creator

A powerful client-side web application for preparing Stable Diffusion training datasets. Built with React, TypeScript, Vite, and shadcn/ui.

## ✨ Features

- 🖼️ **Import & Gallery** - Drag-and-drop or folder import with automatic embedding generation
- 🔍 **Similarity Review** - Visual embeddings and clustering to detect duplicates
- 🎨 **Non-Destructive Cleanup** - Brush, eraser, color picker, zoom, undo/redo
- ✂️ **Multi-Frame Cropping** - Multiple crop frames per image with aspect ratio locks
- 🔄 **Data Augmentation** - Flip, color gradients, rotation variants with reproducible seeding
- 📊 **Final Review** - Aspect ratio filtering and dataset visualization
- 🏷️ **Auto-Tagging** - Manual, bulk, and local browser-side ONNX tagging with keyword-first enforcement
- 📦 **Export** - PNG + TXT pairs with optional ZIP or File System API saving

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm

### Local Development

```bash
# Install dependencies
npm install

# Start dev server (opens http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## 📋 Workflow

The app follows an 8-stage pipeline:

1. **Import Images** → Select individual files or folders
2. **Remove Duplicates** → Review similarity clusters and remove redundant images
3. **Clean Images** → Non-destructive brush cleanup
4. **Crop Images** → Create multiple crops with different aspect ratios
5. **Augment Dataset** → Generate variants (flip, color, rotate)
6. **Final Review** → Filter by aspect ratio and review final dataset
7. **Tag Images** → Add manual tags, bulk tags, or connect a compatible local tagger model
8. **Export Dataset** → Save as PNG + TXT pairs

## Stage 7 Local Auto-Tagger

Stage 7 can run a user-provided Danbooru-style ONNX tagger entirely in the browser. Images are not uploaded to a server for the default local workflow. The app only acts as an interface for a compatible model bundle that you download and connect yourself.

### Supported v1 model bundle format

Version 1 intentionally supports one strict local bundle contract. Select a folder that contains these files at the top level:

```text
model.onnx
selected_tags.csv
```

The app validates both files before enabling auto-tagging. It does not claim support for arbitrary unknown model formats. Other models may be used only if they provide the same supported `model.onnx` plus `selected_tags.csv` structure.

### Recommended compatible models

Start with one of these supported WD v3 taggers:

- `wd-vit-tagger-v3`
- `wd-convnext-tagger-v3`
- `wd-swinv2-tagger-v3`

Larger WD variants may work if they satisfy the same bundle contract, but they are heavier and are not the default recommendation for v1.

### Download and connect a model

1. Download one recommended model from its model page, such as `https://huggingface.co/SmilingWolf/wd-vit-tagger-v3`.
2. Put `model.onnx` and `selected_tags.csv` in one local folder. If the downloaded ONNX file has a different name, rename the compatible ONNX file to `model.onnx`.
3. Open the app and move to Stage 7, Tag Images.
4. In the Local tagger block, click `Connect model`.
5. Select the folder that contains `model.onnx` and `selected_tags.csv`.
6. Wait for validation and first model load. Large models can take noticeable time on the first connection.
7. When the status becomes `Ready`, click `Run auto-tagging`.

Auto-tagging uses the Stage 7 settings already shown in the app: threshold, max tags, insert mode, and blacklist. Predicted tags are written into the same per-image tag state as manual tags, so duplicates and blacklisted tags are filtered through the same workflow. The dataset keyword is export-only metadata and is added to exported TXT files during export.

### Browser compatibility

The preferred connection flow uses the browser directory picker, which requires user selection and may require a secure context such as `localhost` or HTTPS. The app cannot read arbitrary filesystem paths.

If the directory picker is unavailable, the app falls back to a folder upload input where the browser supports it. If neither path is available, use a Chromium-based desktop browser or run the app from `localhost`/HTTPS. Model access is kept for the current session only; after a page reload you may need to reconnect the folder because browser file permissions are not guaranteed to persist.

The app tries WebGPU first when available, then falls back to ONNX Runtime WebAssembly. GPU support depends on the browser, OS, drivers, and model compatibility.

### Troubleshooting

- `Missing required file(s): model.onnx`: the selected folder does not contain `model.onnx` at the top level.
- `Missing required file(s): selected_tags.csv`: the selected folder does not contain `selected_tags.csv` at the top level.
- `selected_tags.csv is missing the required "name" column`: use the selected tags CSV from a compatible WD-style tagger bundle.
- Status stays `Not ready`: reconnect a folder that satisfies the exact v1 bundle contract.
- `Directory picker access requires a secure context`: open the app through `localhost` or HTTPS, or try the folder upload fallback.
- Model load failure: confirm the ONNX file is a browser-compatible tagger model and not a PyTorch, Safetensors, TensorFlow, or unsupported ONNX variant.
- Runtime inference failure: try a smaller recommended model or a browser with WebGPU/WASM support.

## 📋 Detailed Requirements

### Import Stage Requirements

#### Inputs

Support all of the following import methods:

* selecting **multiple individual image files**
* selecting an **entire folder**
* **drag-and-drop import** onto a visible dropzone

#### Drag-and-drop UX

The import screen must contain a clearly visible drop area with the text:

**Import Images**
**Select individual files or an entire folder to begin**

The user must be able to drag and drop:

* multiple image files
* a whole folder, when supported by the browser
* mixed batches of images

The dropzone must provide clear visual feedback on hover / drag-over / invalid drop.

#### File selection behavior

The file picker must support:

* selecting **multiple files at once**
* selecting a **folder**
* adding more files later without overwriting the existing imported set unless the user explicitly chooses to replace it

It is a bug if the app only imports **one file** when the user selects multiple files or a folder.
This must be fixed.

**✅ FIXED:** Drag-and-drop import, multiple file/folder import, and navigation to next stage are now working.

#### Navigation requirement

After at least one valid image has been imported, the user must be able to proceed to the **next stage**.

Requirements:

* the **Next** button must exist on the import stage
* it must become enabled once valid images are loaded
* the user must not get stuck on the import screen after successful import

#### Gallery

Display imported items in a **masonry grid**.

The gallery must support:

* reorder
* add more items later
* remove items
* multi-select
* shift-select
* bulk actions

#### Image pipeline rule

Imported images are source assets.
Final exported images must always be **PNG**.

### Import-stage issues that must be fixed

The current implementation has the following unacceptable problems:

1. There is no working **drag-and-drop import** on the import area.
2. Selecting **multiple images** or an **entire folder** imports only one file.
3. The user cannot proceed to the **next stage** after import.

These issues must be treated as **blocking bugs** and fixed before considering the import stage complete.

## 💾 Storage

- **Browser Storage**: IndexedDB for all project data
- **Auto-Save**: Debounced saves on every state change
- **Project Persistence**: Close and reopen browser to resume work

## 🌐 Deployment

### GitHub Pages (Recommended)

1. **Build the project**
   ```bash
   npm run build
   ```

2. **Upload `dist/` folder to GitHub Pages**
   ```bash
   # Option A: GitHub Actions (recommended)
   # Option B: Manual push to gh-pages branch
   git subtree push --prefix dist origin gh-pages
   ```

3. **Access at**: `https://<username>.github.io/DatasetCreator/`

### Static Hosting (Vercel, Netlify, etc.)

1. Build: `npm run build`
2. Deploy the `dist` folder
3. No backend required - fully client-side

## 📊 Performance

- **Embeddings**: Simple histogram-based (can be upgraded to ONNX/TensorFlow)
- **Image Processing**: Canvas-based with optional Web Workers
- **Memory**: Chunked processing for large datasets

## 🛠️ Architecture

```
src/
├── components/stages/     # 8 pipeline stages
├── services/              # Business logic
│   ├── image/            # Image processing
│   ├── similarity/        # Embedding & clustering
│   ├── cleanup/          # Canvas editing
│   ├── crop/             # Frame management
│   ├── augmentation/      # Variant generation
│   ├── export/           # ZIP & file saving
│   └── persistence/      # IndexedDB
├── stores/               # Zustand state management
├── types/                # TypeScript definitions
└── lib/                  # Utilities & constants
```

## 📦 Key Dependencies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **JSZip** - ZIP creation
- **Lucide React** - Icons

## 🎯 MVP Priorities Implemented

1. ✅ Auto-tagging (manual, bulk, and local ONNX with keyword enforcement)
2. ✅ Cropping (multi-frame, aspect ratios)
3. ✅ Similarity heatmaps (clustering)
4. ✅ Cleanup editor (non-destructive)
5. ✅ Augmentation (flip, color, rotate)
6. ✅ Final review (filtering)
7. ✅ Export (PNG + TXT)
8. ✅ Persistence (IndexedDB)

## 🚧 Future Enhancements

- **v2**: Smart eraser (inpainting-like fill)
- **v2**: Cloud sync (optional backend)
- **v2**: Batch processing
- **v2**: Better ML models (ONNX transformers)
- **v3**: Plugin system for custom augmentations

## 🐛 Known Limitations

- **iOS/Safari**: Limited File System API support
- **Large Datasets**: >10,000 items may be slower due to client-side processing
- **Mobile**: Desktop-first UI (touch gestures not fully optimized)
- **Embeddings**: Simple histogram method (suitable for MVP)

## 📄 License

MIT

## 🙏 Contributing

This is an open-source project. Contributions welcome!

---

Made with ❤️ for the Stable Diffusion community
