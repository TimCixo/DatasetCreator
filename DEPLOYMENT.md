# Deployment Guide

## Overview

Dataset Creator is a fully static client-side application with no backend requirements. It can be deployed to any static hosting service.

## Prerequisites

- Built `dist/` folder from `npm run build`
- Git repository (for GitHub Pages)
- Hosting account (GitHub, Vercel, Netlify, etc.)

---

## GitHub Pages (Recommended for Free Hosting)

### Step 1: Configure `vite.config.ts`

The app is configured with base path `/DatasetCreator/` for deployment to user/org pages.

```typescript
export default defineConfig({
  base: '/DatasetCreator/',
  // ... other config
})
```

### Step 2: Build the Project

```bash
npm run build
```

This creates the `dist/` folder with all static files.

### Step 3: Deploy to GitHub Pages

#### Option A: GitHub Actions (Automated)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

#### Option B: Manual Push

```bash
# Build
npm run build

# Deploy using git subtree
git subtree push --prefix dist origin gh-pages
```

### Step 4: Enable GitHub Pages

1. Go to repository Settings → Pages
2. Set source to `gh-pages` branch
3. Wait 1-2 minutes for deployment
4. Access at `https://<username>.github.io/DatasetCreator/`

---

## Vercel

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Deploy

```bash
vercel
```

Follow the prompts. Vercel automatically detects Vite and builds correctly.

### Step 3: Configure for Root Domain (Optional)

Edit `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

---

## Netlify

### Step 1: Build Locally

```bash
npm run build
```

### Step 2: Deploy via Netlify UI

1. Drag and drop the `dist/` folder to [app.netlify.com](https://app.netlify.com)
2. Wait for deployment

### Step 3: Deploy via CLI

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

### Step 4: Configure Custom Domain

In Netlify dashboard → Domain settings → Add custom domain

---

## AWS S3 + CloudFront

### Step 1: Create S3 Bucket

```bash
# Create bucket
aws s3 mb s3://dataset-creator

# Enable static hosting
aws s3 website s3://dataset-creator/ \
  --index-document index.html \
  --error-document index.html
```

### Step 2: Deploy Files

```bash
npm run build

# Upload to S3
aws s3 sync dist/ s3://dataset-creator/ --delete

# Make files public
aws s3 sync s3://dataset-creator/ s3://dataset-creator/ \
  --exclude "*" --include "*" --metadata-directive REPLACE --acl public-read
```

### Step 3: Create CloudFront Distribution (Optional)

Use AWS CloudFront for CDN and HTTPS support.

---

## Docker (For Local Deployment)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -t dataset-creator .
docker run -p 80:80 dataset-creator
```

---

## Custom Domain (All Platforms)

### Point Domain to Your Host

For **GitHub Pages**:
1. Add `CNAME` file to repo root with domain name
2. Update DNS records at registrar

For **Vercel/Netlify**:
1. Add domain in dashboard
2. Update DNS records
3. Wait for SSL certificate

---

## Environment Variables

The app doesn't require environment variables for core functionality. However, you can add optional experimental features:

Create `.env.local`:

```
VITE_TAGGING_ENDPOINT=https://your-tagging-api.com/tag
```

Add to `src/vite-env.d.ts`:

```typescript
declare const __VITE_TAGGING_ENDPOINT__: string
```

---

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Core | ✅ | ✅ | ⚠️ | ✅ |
| File System API | ✅ | ❌ | ❌ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| WebP | ✅ | ✅ | ⚠️ | ✅ |

⚠️ = Limited or requires fallback

---

## Performance Optimization

### Gzip Compression

All modern hosts (Vercel, Netlify, GitHub Pages) automatically enable Gzip compression.

### Asset Caching

The app uses cache busting for all assets. Browser cache is automatically managed.

### Bundle Size

Current build size: ~500KB (gzipped: ~150KB)

---

## Monitoring & Debugging

### Local Testing

```bash
npm run preview
```

Opens the production build locally on port `4173`.

### Performance Analysis

```bash
npm install -g lighthouse
lighthouse https://your-deployed-site.com
```

### Error Tracking

Add to `src/App.tsx`:

```typescript
window.addEventListener('error', (event) => {
  // Send to error tracking service
  console.error('Error:', event.error)
})
```

---

## Troubleshooting

### 404 on Reload

**Problem**: Page works but reloading gives 404

**Solution**: Configure host to serve `index.html` for all routes

- GitHub Pages: Automatic ✅
- Vercel: Automatic ✅
- Netlify: Add `_redirects` file:
  ```
  /* /index.html 200
  ```

### Images Not Loading

**Problem**: Images show blank

**Solution**: Check base path in `vite.config.ts` matches your deployment

```typescript
base: process.env.NODE_ENV === 'production' ? '/DatasetCreator/' : '/'
```

### IndexedDB Not Persistent

**Problem**: Data lost on refresh

**Solution**: 
- Check browser's local storage limits
- Disable incognito/private mode
- Increase browser's storage quota

---

## Rollback Procedure

### GitHub Pages

```bash
git log --oneline
git revert <commit-hash>
git push origin main
```

### Vercel/Netlify

Use dashboard to revert to previous deployment

---

## Next Steps

1. Monitor user feedback on error logs
2. Set up analytics (Google Analytics, Mixpanel)
3. Plan v1.1 features based on usage
4. Consider implementing optional backend for advanced features

---

For more info, see [ARCHITECTURE.md](./ARCHITECTURE.md)
