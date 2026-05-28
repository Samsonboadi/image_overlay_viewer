import { buildClassLookup, normalizeBase } from './utils.js';

export const rendererMixin = {
    resizeCanvas() {
        const container = document.getElementById('imageContainer');
        const rect = container.getBoundingClientRect();
        this.canvas.width = Math.max(60, rect.width - 24);
        this.canvas.height = Math.max(60, rect.height - 24);
        this.drawImage();
    },

    applyMaskToImageData(data, lookup) {
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i]; // red channel = greyscale class index
            const entry = lookup.get(gray);

            if (entry && entry.visible) {
                data[i] = entry.color.r;
                data[i + 1] = entry.color.g;
                data[i + 2] = entry.color.b;
                data[i + 3] = 255;
            } else if (entry && !entry.visible) {
                data[i + 3] = 0;
            } else {
                if (this.transparentBackground) {
                    data[i + 3] = 0;
                } else {
                    data[i] = this.backgroundColor.r;
                    data[i + 1] = this.backgroundColor.g;
                    data[i + 2] = this.backgroundColor.b;
                    data[i + 3] = 255;
                }
            }
        }
    },

    drawImage() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.images.length || this.currentIndex >= this.images.length) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '15px var(--font-body), sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No images loaded. Drag and drop files or select a directory to begin.', this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        const currentImage = this.images[this.currentIndex];

        // Dynamic preload for lazy Azure images
        if (this.isAzureMode && !currentImage.img) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = 'var(--accent-secondary)';
            ctx.font = '15px var(--font-body), sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`🔄 Loading cloud image: ${currentImage.name}...`, this.canvas.width / 2, this.canvas.height / 2);

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { currentImage.img = img; this.drawImage(); };
            img.onerror = () => { ctx.fillText(`❌ Failed to load: ${currentImage.name}`, this.canvas.width / 2, this.canvas.height / 2); };
            img.src = currentImage.url;
            return;
        }

        const img = currentImage.img;
        let scale = Math.min((this.canvas.width * 0.9) / img.width, (this.canvas.height * 0.9) / img.height);
        scale *= this.zoom;

        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const drawX = (this.canvas.width - drawW) / 2 + this.panX;
        const drawY = (this.canvas.height - drawH) / 2 + this.panY;

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // On-demand mask fetch for Azure mode
        let maskObj = this.findMaskForImage(currentImage.name);

        if (this.isAzureMode && !maskObj && !this.pendingMaskLoads.has(currentImage.name)) {
            this.pendingMaskLoads.add(currentImage.name);
            const maskUrl = currentImage.url.replace('/img/', '/msk/');

            const maskImg = new Image();
            maskImg.crossOrigin = 'anonymous';
            maskImg.onload = () => {
                const loadedMask = { img: maskImg, name: currentImage.name, url: maskUrl };
                this.masks.push(loadedMask);
                this.masksMap.set(normalizeBase(currentImage.name), loadedMask);
                this.drawImage();
            };
            maskImg.src = maskUrl;
        }

        if (maskObj) {
            const lookup = buildClassLookup(this.maskClasses);
            const temp = document.createElement('canvas');
            temp.width = drawW;
            temp.height = drawH;
            const tctx = temp.getContext('2d');

            tctx.drawImage(maskObj.img, 0, 0, drawW, drawH);
            const imageData = tctx.getImageData(0, 0, drawW, drawH);
            this.applyMaskToImageData(imageData.data, lookup);
            tctx.putImageData(imageData, 0, 0);

            ctx.globalAlpha = this.transparency;
            ctx.drawImage(temp, drawX, drawY);
            ctx.globalAlpha = 1.0;
        }
    },

    startDrag(e) {
        this.isDragging = true;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
    },

    drag(e) {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.lastMousePos.x;
        const deltaY = e.clientY - this.lastMousePos.y;

        this.panX += deltaX;
        this.panY += deltaY;

        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.drawImage();
    },

    endDrag() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    },

    handleZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom = Math.max(0.1, Math.min(5, this.zoom * delta));

        document.getElementById('zoomSlider').value = this.zoom * 100;
        document.getElementById('zoomValue').textContent = Math.round(this.zoom * 100) + '%';

        this.drawImage();
    },
};
