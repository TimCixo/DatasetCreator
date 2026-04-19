# Dataset Creator

A powerful client-side web application for preparing Stable Diffusion training datasets. Built with React, TypeScript, Vite, and shadcn/ui.

## ✨ Features

- 🖼️ **Import & Gallery** - Drag-and-drop or folder import with automatic embedding generation
- 🔍 **Similarity Review** - Visual embeddings and clustering to detect duplicates
- 🎨 **Non-Destructive Cleanup** - Brush, eraser, color picker, zoom, undo/redo
- ✂️ **Multi-Frame Cropping** - Multiple crop frames per image with aspect ratio locks
- 🔄 **Data Augmentation** - Flip, color gradients, rotation variants with reproducible seeding
- 📊 **Final Review** - Aspect ratio filtering and dataset visualization
- 🏷️ **Auto-Tagging** - Manual and bulk tag management with keyword-first enforcement
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
7. **Auto-Tag Images** → Add tags with dataset keyword always first
8. **Export Dataset** → Save as PNG + TXT pairs

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

1. ✅ Auto-tagging (manual with keyword enforcement)
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
