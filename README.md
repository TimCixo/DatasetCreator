<h1 align="center"> 🍍TimCixo's DatasetCreator🍍 </h1>

<!-- BADGES -->
</br>
<p align="center">
  <img src="https://img.shields.io/github/repo-size/TimCixo/DatasetCreator">
  <img src="https://img.shields.io/badge/react-18-blue">
  <img src="https://img.shields.io/badge/typescript-ready-blue">
  <img src="https://img.shields.io/badge/vite-powered-purple">
  <img src="https://img.shields.io/badge/local--first-browser-green">
</p>

</br>

## 📚 Table of Contents

* [🚀 Getting Started](#-getting-started)
* [🧭 Workflow](#-workflow)
* [🏷️ Local Auto-Tagger](#️-local-auto-tagger)
* [📦 Export](#-export)
* [💾 Storage](#-storage)
* [🛠️ Tech Stack](#️-tech-stack)
* [🌐 Deployment](#-deployment)
* [⚠️ Known Limitations](#️-known-limitations)
* [📄 License](#-license)

<!-- INFO -->

</br>
<h2 align="left"> 📝 Description </h2>

<!-- Preview image placeholder: add a screenshot/GIF here when a repository asset is available. -->

DatasetCreator is a local-first web app for preparing image datasets for Stable Diffusion training.</br>
Import images, clean them, crop them, augment them, review similarity, tag everything, and export ready-to-train PNG + TXT pairs.

* 🖼️ Import individual images or whole folders;
* 🔍 Review duplicates and similarity clusters;
* 🎨 Clean images with non-destructive editing tools;
* ✂️ Create multi-aspect crops for training sets;
* 🔄 Generate augmentation variants;
* 🕸️ Inspect final dataset relationships in Graph view;
* 🏷️ Add manual, bulk, or local ONNX auto-tags;
* 📦 Export clean PNG + TXT dataset files.

</br>

<!-- HOW TO USE -->

## 🚀 Getting Started

### Requirements

* Node.js 16+
* npm

### Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL, usually:

```text
http://localhost:5173
```

### Build

```bash
npm run build
npm run preview
```

## 🧭 Workflow

DatasetCreator follows an 8-stage dataset pipeline:

1. **Import Images** - add files or folders.
2. **Remove Duplicates** - inspect similarity groups and remove repeats.
3. **Clean Images** - brush, erase, zoom, undo, and redo.
4. **Crop Images** - create multiple crop frames with aspect ratio locks.
5. **Augment Dataset** - generate flips, color variants, and rotations.
6. **Final Review** - inspect the dataset and graph relationships.
7. **Tag Images** - edit tags manually, bulk apply tags, or use a local tagger.
8. **Export Dataset** - save PNG images with matching TXT prompts.

## 🏷️ Local Auto-Tagger

Stage 7 supports a user-provided Danbooru-style ONNX tagger in the browser.</br>
No backend is required for the default local workflow, and images are not uploaded to a server.

### Supported v1 bundle

Select a local folder with this exact structure:

```text
model.onnx
selected_tags.csv
```

The app validates the folder before enabling auto-tagging. Unknown arbitrary model layouts are not supported in v1.

### Recommended compatible models

For full Stage 7 auto-tagging, download one compatible tagger model manually:

* [`wd-vit-tagger-v3`](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/tree/main)
* [`wd-convnext-tagger-v3`](https://huggingface.co/SmilingWolf/wd-convnext-tagger-v3)
* [`wd-swinv2-tagger-v3`](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3)
* [`wd-vit-large-tagger-v3`](https://huggingface.co/SmilingWolf/wd-vit-large-tagger-v3) - heavier optional model

Download a compatible model manually, place `model.onnx` and `selected_tags.csv` in one folder, then connect it from Stage 7 with **Connect model**.

### Browser notes

* Directory access requires user-selected files or folders.
* `localhost` or HTTPS is recommended for secure browser APIs.
* WebGPU is used when available, with ONNX Runtime WebAssembly as fallback.
* Model access is session-based; after reload, reconnecting may be required.

## 📦 Export

Export creates training-ready file pairs:

```text
1.png
1.txt
2.png
2.txt
```

The dataset keyword is handled at export time, so editable Stage 7 tags stay clean.

## 💾 Storage

* Browser-first project state;
* Local object URLs for previews;
* IndexedDB-backed persistence where supported;
* No required backend for the main workflow.

## 🛠️ Tech Stack

* React 18
* TypeScript
* Vite
* Tailwind CSS
* Zustand
* JSZip
* ONNX Runtime Web
* Lucide React

## 🌐 Deployment

DatasetCreator is a static client-side app and is ready for GitHub Pages.

```bash
npm run build
```

Pushes to `main` deploy through GitHub Actions to:

```text
https://timcixo.github.io/DatasetCreator/
```

For another static host, deploy the generated `dist/` folder.

## ⚠️ Known Limitations

* Desktop browsers are the main target.
* Safari and iOS have limited File System API support.
* Very large datasets can be slower because processing happens client-side.
* Local model performance depends on browser, hardware, and backend support.

## 📄 License

MIT

---

Made with ❤️ for Stable Diffusion dataset workflows.
