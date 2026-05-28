import { buildClassLookup, normalizeBase } from './utils.js';

export const exporterMixin = {
    exportResults() {
        if (!this.images.length) {
            this.showToast('No data to export');
            return;
        }

        const results = {
            sessionInfo: {
                sessionId: this.sessionData.sessionId,
                createdAt: this.sessionData.createdAt,
                exportedAt: new Date().toISOString(),
                totalImages: this.stats.total,
                settings: this.sessionData.settings || {}
            },
            summary: this.stats,
            details: []
        };

        this.images.forEach((image, index) => {
            const classification = this.sessionData.classifications[image.name] || { status: 'pending' };
            results.details.push({
                index: index + 1,
                filename: image.name,
                status: classification.status,
                timestamp: classification.timestamp,
                notes: classification.notes || ''
            });
        });

        const dataStr = JSON.stringify(results, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `image_analysis_results_${this.sessionData.sessionId}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showToast('Results exported successfully');
    },

    exportView() {
        if (!this.images.length) {
            this.showToast('No image to export');
            return;
        }

        const currentImage = this.images[this.currentIndex];
        const maskObj = this.findMaskForImage(currentImage.name);

        if (this.isAzureMode && !currentImage.img) {
            this.showToast('Please wait for image to load before exporting');
            return;
        }

        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        exportCanvas.width = currentImage.img.width;
        exportCanvas.height = currentImage.img.height;
        exportCtx.drawImage(currentImage.img, 0, 0);

        if (maskObj) {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = currentImage.img.width;
            tempCanvas.height = currentImage.img.height;

            tempCtx.drawImage(maskObj.img, 0, 0, currentImage.img.width, currentImage.img.height);
            const imageData = tempCtx.getImageData(0, 0, currentImage.img.width, currentImage.img.height);

            this.applyMaskToImageData(imageData.data, buildClassLookup(this.maskClasses));
            tempCtx.putImageData(imageData, 0, 0);

            exportCtx.globalAlpha = this.transparency;
            exportCtx.drawImage(tempCanvas, 0, 0);
            exportCtx.globalAlpha = 1.0;
        }

        exportCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `overlay_export_${this.currentIndex + 1}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('View exported successfully');
        });
    },

    createRandomSubset() {
        if (!this.images.length) {
            this.showToast('No images loaded');
            return;
        }

        const percentage = document.getElementById('percentageSlider').value;
        const count = Math.max(1, Math.floor(this.images.length * (percentage / 100)));

        if (count >= this.images.length) {
            this.showToast('Percentage too high - using all images');
            return;
        }

        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        progressBar.style.display = 'block';

        const indices = [];
        while (indices.length < count) {
            const randomIndex = Math.floor(Math.random() * this.images.length);
            if (!indices.includes(randomIndex)) indices.push(randomIndex);
        }
        indices.sort((a, b) => a - b);

        const newImages = [];
        let processIndex = 0;
        const processNext = () => {
            if (processIndex >= indices.length) {
                this.images = newImages;
                const allowed = new Set(this.images.map(im => im.name));
                const newClass = {};
                for (const name of Object.keys(this.sessionData.classifications)) {
                    if (allowed.has(name)) newClass[name] = this.sessionData.classifications[name];
                }
                this.sessionData.classifications = newClass;
                this.stats.total = this.images.length;
                this.currentIndex = 0;

                progressBar.style.display = 'none';
                progressFill.style.width = '0%';

                this.newSession();
                this.updateSessionWithImages();
                this.updateUI();
                this.drawImage();
                this.saveToLocalStorage();
                this.showToast(`Created subset with ${count} images`);
                return;
            }

            newImages.push(this.images[indices[processIndex]]);
            progressFill.style.width = ((processIndex + 1) / indices.length * 100) + '%';
            processIndex++;
            setTimeout(processNext, 15);
        };

        processNext();
    },

    async loadJSZip() {
        if (window.JSZip) return window.JSZip;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.onload = () => resolve(window.JSZip);
            s.onerror = () => reject(new Error('Failed to load JSZip from CDN'));
            document.body.appendChild(s);
        });
    },

    getImageBlob(img) {
        return new Promise((resolve) => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob(resolve, 'image/png');
        });
    },

    createOverlayBlob(img, mask) {
        return new Promise((resolve) => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);

            if (mask) {
                const tc = document.createElement('canvas');
                tc.width = img.width;
                tc.height = img.height;
                const tctx = tc.getContext('2d');
                tctx.drawImage(mask.img, 0, 0, img.width, img.height);
                const imageData = tctx.getImageData(0, 0, img.width, img.height);
                this.applyMaskToImageData(imageData.data, buildClassLookup(this.maskClasses));
                tctx.putImageData(imageData, 0, 0);

                ctx.globalAlpha = this.transparency;
                ctx.drawImage(tc, 0, 0);
                ctx.globalAlpha = 1.0;
            }
            c.toBlob(resolve, 'image/png');
        });
    },

    generateReadmeContent() {
        const { total, approved: app, rejected: rej, skipped: skp, pending: pnd } = this.stats;

        return `# Geominds Image Analysis Project Export

This archive contains the sorted results of your Geominds image analysis session.

## Classification Summary
- **Total Images**: ${total}
- **Approved**: ${app} (${Math.round(app / Math.max(1, total) * 100)}%)
- **Rejected**: ${rej} (${Math.round(rej / Math.max(1, total) * 100)}%)
- **Skipped**: ${skp} (${Math.round(skp / Math.max(1, total) * 100)}%)
- **Pending**: ${pnd} (${Math.round(pnd / Math.max(1, total) * 100)}%)

## File Structure
- **01_approved/**: Images approved for training or production
- **02_rejected/**: Images flagged with quality or segmentation issues
- **03_skipped/**: Images skipped during classification
- **04_pending/**: Images that have not been classified yet
- **results.json**: Full machine-readable export metadata
- **results.csv**: Spreadsheet table containing filenames, statuses, and notes
`;
    },

    generateCSVResults() {
        const rows = [['Index', 'Filename', 'Status', 'Timestamp', 'Notes']];
        this.images.forEach((image, index) => {
            const c = this.sessionData.classifications[image.name] || { status: 'pending' };
            rows.push([
                index + 1,
                `"${image.name}"`,
                `"${c.status}"`,
                `"${c.timestamp || ''}"`,
                `"${(c.notes || '').replace(/"/g, '""')}"`
            ]);
        });
        return rows.map(r => r.join(',')).join('\n');
    },

    async downloadCompleteProject() {
        if (!this.images.length) {
            this.showToast('No images to package');
            return;
        }

        const btn = document.getElementById('downloadProjectBtn');
        const progressContainer = document.getElementById('downloadProgress');
        const progressFill = document.getElementById('downloadProgressFill');
        const statusText = document.getElementById('downloadStatus');

        btn.disabled = true;
        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        statusText.textContent = '📦 Initializing package library...';

        try {
            const JSZip = await this.loadJSZip();
            const zip = new JSZip();

            const incMasks = document.getElementById('includeMasksInDownload').checked;
            const incOverlays = document.getElementById('includeOverlaysInDownload').checked;

            const folders = {
                approved: zip.folder('01_approved'),
                rejected: zip.folder('02_rejected'),
                skipped: zip.folder('03_skipped'),
                pending: zip.folder('04_pending')
            };

            for (let i = 0; i < this.images.length; i++) {
                const item = this.images[i];
                statusText.textContent = `📦 Packing image ${i + 1}/${this.images.length}: ${item.name}...`;

                if (!item.img) {
                    await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload = () => { item.img = img; resolve(); };
                        img.onerror = () => reject(new Error(`Failed to load ${item.name}`));
                        img.src = item.url;
                    });
                }

                const c = this.sessionData.classifications[item.name] || { status: 'pending' };
                const folder = folders[c.status] || folders.pending;

                const imgBlob = await this.getImageBlob(item.img);
                folder.file(item.name, imgBlob);

                let maskObj = this.findMaskForImage(item.name);

                if (this.isAzureMode && !maskObj && incMasks) {
                    const maskUrl = item.url.replace('/img/', '/msk/');
                    await new Promise((resolve) => {
                        const maskImg = new Image();
                        maskImg.crossOrigin = 'anonymous';
                        maskImg.onload = () => {
                            const newMask = { img: maskImg, name: item.name, url: maskUrl };
                            this.masks.push(newMask);
                            this.masksMap.set(normalizeBase(item.name), newMask);
                            resolve();
                        };
                        maskImg.onerror = () => resolve();
                        maskImg.src = maskUrl;
                    });
                    maskObj = this.findMaskForImage(item.name);
                }

                if (maskObj && incMasks) {
                    folder.file(`mask_${item.name}`, await this.getImageBlob(maskObj.img));
                }

                if (incOverlays) {
                    folder.file(`preview_${item.name}`, await this.createOverlayBlob(item.img, maskObj));
                }

                progressFill.style.width = `${((i + 1) / this.images.length) * 80}%`;
                await new Promise(r => setTimeout(r, 10));
            }

            statusText.textContent = '📦 Formatting spreadsheets and readme...';

            zip.file('README.md', this.generateReadmeContent());
            zip.file('results.csv', this.generateCSVResults());
            zip.file('results.json', JSON.stringify({
                sessionInfo: {
                    sessionId: this.sessionData.sessionId,
                    createdAt: this.sessionData.createdAt,
                    exportedAt: new Date().toISOString(),
                    totalImages: this.stats.total,
                    settings: this.sessionData.settings || {}
                },
                summary: this.stats,
                classifications: this.sessionData.classifications
            }, null, 2));

            statusText.textContent = '📦 Compressing zip archive (may take a moment)...';
            progressFill.style.width = '90%';

            const zipContent = await zip.generateAsync({ type: 'blob' }, (metadata) => {
                progressFill.style.width = `${90 + (metadata.percent * 0.1)}%`;
            });

            statusText.textContent = '📦 Downloading archive!';
            progressFill.style.width = '100%';

            const url = URL.createObjectURL(zipContent);
            const a = document.createElement('a');
            a.href = url;
            a.download = `geominds_overlay_project_${this.sessionData.sessionId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast('Project downloaded successfully');
            statusText.textContent = '✅ Package download complete';

        } catch (error) {
            console.error('JSZip package compilation failed:', error);
            statusText.textContent = `❌ Export error: ${error.message}`;
            this.showToast('Export compilation failed');
        } finally {
            btn.disabled = false;
            setTimeout(() => {
                progressContainer.style.display = 'none';
                statusText.textContent = 'Packages images, masks, and metadata into organized directories.';
            }, 4000);
        }
    },
};
