// src/scripts/app.js

const DEFAULT_CLASS_COLORS = [
    '#ff0000', '#00cc44', '#3498db', '#f1c40f', '#e74c3c',
    '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71', '#d35400',
    '#8e44ad', '#16a085', '#c0392b', '#2980b9', '#27ae60',
    '#f39c12', '#7f8c8d', '#2c3e50', '#1a5276', '#d4ac0d'
];

export class ModernImageOverlayApp {
    constructor() {
        this.images = [];
        this.masks = [];
        this.masksMap = new Map(); // normalise base name -> mask object
        this.currentIndex = 0;
        this.transparency = 0.5;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.lastMousePos = { x: 0, y: 0 };
        
        // Multi-class configuration parameters
        this.transparentBackground = true;
        this.backgroundColor = { r: 0, g: 0, b: 0 };
        this.maskClasses = [
            { label: 'Background', pixelValue: 0, color: { r: 0, g: 0, b: 0 }, visible: false },
            { label: 'Ditch', pixelValue: 1, color: { r: 255, g: 0, b: 0 }, visible: true }
        ];
        
        // Azure Integration properties
        this.isAzureMode = false;
        this.azureBaseUrl = '';
        this.pendingMaskLoads = new Set();
        
        // Auto-advance control
        this.autoAdvance = true;
        this.deferredRestore = null;
        this.projectId = null;
        
        // Session data
        this.sessionData = {
            sessionId: this.generateSessionId(),
            createdAt: new Date().toISOString(),
            classifications: {}, // filename: {status: 'approved/rejected/skipped', timestamp: '...', notes: ''}
            settings: {}
        };
        
        this.stats = {
            approved: 0,
            rejected: 0,
            skipped: 0,
            pending: 0,
            total: 0
        };
        
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.setupEventListeners();
        this.setupTouchEvents();
        this.renderClassList();
        this.updateUI();
        this.updateSessionStatus();
    }
    
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    normalizeBase(name) {
        return (name || '').toLowerCase().replace(/\.[^/.]+$/, '');
    }
    
    rgbToHex(rgb) {
        return "#" + ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 0, b: 0 };
    }
    
    computeProjectId() {
        const names = this.images.map(i => i.name).sort().join('|');
        let hash = 5381;
        for (let i = 0; i < names.length; i++) {
            hash = ((hash << 5) + hash) + names.charCodeAt(i);
            hash |= 0;
        }
        return 'geoai_overlay_' + (hash >>> 0);
    }
    
    // --- Multi-class UI ---
    renderClassList() {
        const container = document.getElementById('classListContainer');
        if (!container) return;
        
        container.innerHTML = '';
        this.maskClasses.forEach((cls, idx) => {
            const row = document.createElement('div');
            row.className = 'class-row';
            row.innerHTML = `
                <input type="text" value="${cls.label}" placeholder="Class label" data-idx="${idx}" data-field="label" title="Class label">
                <input type="number" value="${cls.pixelValue}" min="0" max="255" data-idx="${idx}" data-field="pixelValue" title="Pixel value (0-255)">
                <input type="color" value="${this.rgbToHex(cls.color)}" data-idx="${idx}" data-field="color" title="Overlay color">
                <button class="class-visibility-btn ${cls.visible ? '' : 'hidden'}" data-idx="${idx}" title="Toggle visibility">${cls.visible ? '👁️' : '🚫'}</button>
            `;
            container.appendChild(row);
        });

        // Attach events
        container.querySelectorAll('input[data-field="label"]').forEach(el => {
            el.addEventListener('change', (e) => {
                this.maskClasses[+e.target.dataset.idx].label = e.target.value;
                this.persistSettings();
            });
        });
        container.querySelectorAll('input[data-field="pixelValue"]').forEach(el => {
            el.addEventListener('change', (e) => {
                const val = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                e.target.value = val;
                this.maskClasses[+e.target.dataset.idx].pixelValue = val;
                this.drawImage();
                this.persistSettings();
            });
        });
        container.querySelectorAll('input[data-field="color"]').forEach(el => {
            el.addEventListener('change', (e) => {
                this.maskClasses[+e.target.dataset.idx].color = this.hexToRgb(e.target.value);
                this.drawImage();
                this.persistSettings();
            });
        });
        container.querySelectorAll('.class-visibility-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = +e.currentTarget.dataset.idx;
                this.maskClasses[idx].visible = !this.maskClasses[idx].visible;
                this.renderClassList();
                this.drawImage();
                this.persistSettings();
            });
        });

        const numInput = document.getElementById('numClassesInput');
        if (numInput) {
            numInput.value = this.maskClasses.length;
        }
        this.updateClassInfo();
    }
    
    updateClassInfo() {
        const info = document.getElementById('classInfo');
        if (!info) return;
        
        const vals = this.maskClasses.map(c => c.pixelValue);
        const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
        if (dupes.length > 0) {
            info.textContent = `⚠️ Duplicate values: ${[...new Set(dupes)].join(', ')}`;
            info.style.color = '#ef4444';
        } else {
            info.textContent = `${this.maskClasses.length} class${this.maskClasses.length !== 1 ? 'es' : ''} configured`;
            info.style.color = 'var(--text-dim)';
        }
    }
    
    handleNumClassesChange(newCount) {
        newCount = Math.max(1, Math.min(50, newCount));
        const current = this.maskClasses.length;
        if (newCount > current) {
            for (let i = current; i < newCount; i++) {
                const colorHex = DEFAULT_CLASS_COLORS[i % DEFAULT_CLASS_COLORS.length];
                this.maskClasses.push({
                    label: `Class ${i}`,
                    pixelValue: i,
                    color: this.hexToRgb(colorHex),
                    visible: true
                });
            }
        } else if (newCount < current) {
            this.maskClasses = this.maskClasses.slice(0, newCount);
        }
        this.renderClassList();
        this.drawImage();
        this.persistSettings();
    }
    
    buildClassLookup() {
        const map = new Map();
        for (const cls of this.maskClasses) {
            if (!map.has(cls.pixelValue)) {
                map.set(cls.pixelValue, { color: cls.color, visible: cls.visible });
            }
        }
        return map;
    }
    
    saveToLocalStorage() {
        if (!this.projectId) return;
        const payload = {
            sessionId: this.sessionData.sessionId,
            classifications: this.sessionData.classifications,
            settings: this.sessionData.settings,
            currentIndex: this.currentIndex,
            lastViewedFilename: this.images[this.currentIndex] ? this.images[this.currentIndex].name : null,
            savedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(this.projectId, JSON.stringify(payload));
        } catch (e) {}
    }
    
    tryRestoreFromLocalStorage() {
        if (!this.projectId) return false;
        try {
            const raw = localStorage.getItem(this.projectId);
            if (!raw) return false;
            const data = JSON.parse(raw);
            this.sessionData.classifications = {
                ...this.sessionData.classifications,
                ...(data.classifications || {})
            };
            if (data.settings) {
                this.applySettings(data.settings);
            }
            if (data.lastViewedFilename) {
                const idx = this.images.findIndex(im => im.name === data.lastViewedFilename);
                if (idx >= 0) this.currentIndex = idx;
            } else if (typeof data.currentIndex === 'number') {
                this.currentIndex = Math.min(Math.max(0, data.currentIndex), Math.max(0, this.images.length - 1));
            }
            this.updateStats();
            this.updateUI();
            this.showToast('Session recovered automatically');
            return true;
        } catch (e) {
            return false;
        }
    }
    
    applySettings(s) {
        if (s.maskClasses && Array.isArray(s.maskClasses)) {
            this.maskClasses = s.maskClasses;
            this.renderClassList();
        }
        if (s.backgroundColor) {
            this.backgroundColor = s.backgroundColor;
            const bgPicker = document.getElementById('backgroundColorPicker');
            if (bgPicker) bgPicker.value = this.rgbToHex(this.backgroundColor);
        }
        if (typeof s.transparentBackground === 'boolean') {
            this.transparentBackground = s.transparentBackground;
            const bgCheck = document.getElementById('transparentBackgroundCheckbox');
            if (bgCheck) bgCheck.checked = this.transparentBackground;
        }
        if (typeof s.transparency === 'number') {
            this.transparency = s.transparency;
            const slider = document.getElementById('transparencySlider');
            if (slider) slider.value = this.transparency * 100;
            const valSpan = document.getElementById('transparencyValue');
            if (valSpan) valSpan.textContent = Math.round(this.transparency * 100) + '%';
        }
        if (typeof s.autoAdvance === 'boolean') {
            this.autoAdvance = s.autoAdvance;
            const advCheck = document.getElementById('autoAdvanceCheckbox');
            if (advCheck) advCheck.checked = this.autoAdvance;
        }
    }
    
    setupEventListeners() {
        // Local File inputs
        document.getElementById('imageInput').addEventListener('change', (e) => {
            this.isAzureMode = false;
            this.loadImages(e.target.files);
        });
        document.getElementById('maskInput').addEventListener('change', (e) => {
            this.loadMasks(e.target.files);
        });
        
        // Azure Cloud Loader
        document.getElementById('azureLoadBtn').addEventListener('click', () => {
            let endpoint = document.getElementById('azureApiUrl').value.trim();
            if (!endpoint) {
                endpoint = 'https://image-backend-chgrh9eag3czcsck.westeurope-01.azurewebsites.net';
            }
            const limit = parseInt(document.getElementById('azureLimit').value) || 50;
            const offset = parseInt(document.getElementById('azureOffset').value) || 0;
            this.loadFromAzure(endpoint, limit, offset);
        });
        
        // Session management
        document.getElementById('saveSessionBtn').addEventListener('click', () => this.saveSession());
        document.getElementById('loadSessionBtn').addEventListener('click', () => document.getElementById('sessionInput').click());
        document.getElementById('sessionInput').addEventListener('change', (e) => this.loadSession(e.target.files[0]));
        document.getElementById('newSessionBtn').addEventListener('click', () => this.newSession());
        
        // Status actions
        document.getElementById('approveBtn').addEventListener('click', () => {
            this.setImageStatus('approved');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('rejectBtn').addEventListener('click', () => {
            this.setImageStatus('rejected');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('skipCurrentBtn').addEventListener('click', () => {
            this.setImageStatus('skipped');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('clearStatusBtn').addEventListener('click', () => {
            this.clearImageStatus();
            this.saveToLocalStorage();
        });
        
        document.getElementById('autoAdvanceCheckbox').addEventListener('change', (e) => {
            this.autoAdvance = e.target.checked;
            this.persistSettings();
        });
        document.getElementById('nextPendingBtn').addEventListener('click', () => this.jumpToNextPending());
        
        // Drop zones
        this.setupDropZone('imageDropZone', 'imageInput');
        this.setupDropZone('maskDropZone', 'maskInput');
        
        // Sliders
        document.getElementById('transparencySlider').addEventListener('input', (e) => {
            this.transparency = e.target.value / 100;
            document.getElementById('transparencyValue').textContent = e.target.value + '%';
            this.drawImage();
            this.persistSettings();
        });
        
        document.getElementById('zoomSlider').addEventListener('input', (e) => {
            this.zoom = e.target.value / 100;
            document.getElementById('zoomValue').textContent = e.target.value + '%';
            this.drawImage();
        });
        
        document.getElementById('percentageSlider').addEventListener('input', (e) => {
            document.getElementById('percentageValue').textContent = e.target.value + '%';
        });
        
        // Mask class count, color, transparency pickers
        document.getElementById('numClassesInput').addEventListener('change', (e) => {
            this.handleNumClassesChange(parseInt(e.target.value) || 1);
        });
        document.getElementById('backgroundColorPicker').addEventListener('change', (e) => {
            this.backgroundColor = this.hexToRgb(e.target.value);
            this.drawImage();
            this.persistSettings();
        });
        document.getElementById('transparentBackgroundCheckbox').addEventListener('change', (e) => {
            this.transparentBackground = e.target.checked;
            this.drawImage();
            this.persistSettings();
        });
        
        // Navigation & Exporters
        document.getElementById('prevBtn').addEventListener('click', () => this.previousImage());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextImage());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportView());
        document.getElementById('exportResultsBtn').addEventListener('click', () => this.exportResults());
        document.getElementById('createSubsetBtn').addEventListener('click', () => this.createRandomSubset());
        document.getElementById('downloadProjectBtn').addEventListener('click', () => this.downloadCompleteProject());
        
        // Navigation bar buttons
        document.getElementById('navPrevBtn').addEventListener('click', () => this.previousImage());
        document.getElementById('navNextBtn').addEventListener('click', () => this.nextImage());
        
        // Canvas events
        this.canvas.addEventListener('mousedown', (e) => this.startDrag(e));
        this.canvas.addEventListener('mousemove', (e) => this.drag(e));
        this.canvas.addEventListener('mouseup', () => this.endDrag());
        this.canvas.addEventListener('wheel', (e) => this.handleZoom(e), { passive: false });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    setupTouchEvents() {
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.startDrag({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.drag({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.endDrag();
        }, { passive: false });
        
        let lastDistance = 0;
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastDistance = Math.sqrt(dx * dx + dy * dy);
            }
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (lastDistance > 0) {
                    const scale = distance / lastDistance;
                    this.zoom *= scale;
                    this.zoom = Math.max(0.1, Math.min(5, this.zoom));
                    document.getElementById('zoomSlider').value = this.zoom * 100;
                    document.getElementById('zoomValue').textContent = Math.round(this.zoom * 100) + '%';
                    this.drawImage();
                }
                lastDistance = distance;
            }
        }, { passive: false });
    }
    
    setupDropZone(dropZoneId, inputId) {
        const dropZone = document.getElementById(dropZoneId);
        const input = document.getElementById(inputId);
        
        dropZone.addEventListener('click', () => input.click());
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            
            const files = Array.from(e.dataTransfer.files).filter(file => 
                file.type.startsWith('image/')
            );
            
            if (dropZoneId === 'imageDropZone') {
                this.isAzureMode = false;
                this.loadImages(files);
            } else {
                this.loadMasks(files);
            }
        });
    }

    // --- Azure Storage Fetch Client ---
    async loadFromAzure(apiUrl, limit, offset) {
        const statusDiv = document.getElementById('azureStatus');
        statusDiv.textContent = '🔄 Contacting backend inventory...';
        statusDiv.style.color = 'var(--accent-secondary)';
        
        try {
            // normalise trailing slashes
            const cleanUrl = apiUrl.replace(/\/+$/, '');
            const response = await fetch(`${cleanUrl}/images?limit=${limit}&offset=${offset}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            const base_url = data.base_url;
            const imagePaths = data.images || [];
            
            if (imagePaths.length === 0) {
                statusDiv.textContent = '⚠️ No image records found in container';
                statusDiv.style.color = '#fbbf24';
                return;
            }
            
            this.images = [];
            this.masks = [];
            this.masksMap.clear();
            this.pendingMaskLoads.clear();
            this.isAzureMode = true;
            this.azureBaseUrl = base_url;
            
            statusDiv.textContent = `🔄 Loading ${imagePaths.length} cloud records...`;
            
            // Build absolute urls
            for (let i = 0; i < imagePaths.length; i++) {
                const path = imagePaths[i];
                const filename = path.split('/').pop();
                const absoluteUrl = base_url + path;
                
                // Add reference object without full Image preloads over network to avoid slow startup.
                // We will load the actual Image asset lazily when it becomes the active index!
                this.images.push({
                    name: filename,
                    url: absoluteUrl,
                    img: null // preloaded dynamically
                });
            }
            
            this.currentIndex = 0;
            this.stats.total = this.images.length;
            this.projectId = this.computeProjectId();
            
            this.updateSessionWithImages();
            
            if (!this.tryRestoreFromLocalStorage()) {
                this.saveToLocalStorage();
            }
            
            statusDiv.textContent = `✅ Loaded ${this.images.length} cloud images successfully`;
            statusDiv.style.color = '#34d399';
            
            this.showToast(`Fetched ${this.images.length} images from Azure`);
            this.updateUI();
            this.resizeCanvas();
            this.drawImage();
            
        } catch (error) {
            console.error('Azure Storage Loader Error:', error);
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.style.color = '#f87171';
            this.showToast('Cloud connection failed');
        }
    }
    
    async loadImages(files) {
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!imageFiles.length) return;
        
        const progressBar = document.getElementById('imageLoadProgress');
        const progressFill = document.getElementById('imageProgressFill');
        const statusDiv = document.getElementById('imageLoadStatus');
        
        progressBar.style.display = 'block';
        progressFill.style.width = '0%';
        statusDiv.textContent = 'Loading images...';
        
        this.images = [];
        
        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const img = new Image();
            const url = URL.createObjectURL(file);
            
            statusDiv.textContent = `Loading image ${i + 1}/${imageFiles.length}: ${file.name}`;
            
            await new Promise((resolve) => {
                img.onload = () => {
                    this.images.push({
                        img: img,
                        name: file.name,
                        url: url
                    });
                    
                    const progress = ((i + 1) / imageFiles.length) * 100;
                    progressFill.style.width = progress + '%';
                    resolve();
                };
                img.onerror = () => {
                    resolve();
                };
                img.src = url;
            });
            
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        
        progressBar.style.display = 'none';
        statusDiv.textContent = `✅ Loaded ${this.images.length} images`;
        
        this.images.sort((a, b) => a.name.localeCompare(b.name));
        this.currentIndex = 0;
        this.stats.total = this.images.length;
        this.projectId = this.computeProjectId();
        
        this.updateSessionWithImages();
        
        if (!this.tryRestoreFromLocalStorage()) {
            this.saveToLocalStorage();
        }
        
        this.showToast(`Loaded ${this.images.length} images`);
        this.updateUI();
        this.resizeCanvas();
        this.drawImage();
    }
    
    async loadMasks(files) {
        const maskFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!maskFiles.length) return;
        
        const progressBar = document.getElementById('maskLoadProgress');
        const progressFill = document.getElementById('maskProgressFill');
        const statusDiv = document.getElementById('maskLoadStatus');
        
        progressBar.style.display = 'block';
        progressFill.style.width = '0%';
        statusDiv.textContent = 'Loading masks...';
        
        this.masks = [];
        this.masksMap.clear();
        
        for (let i = 0; i < maskFiles.length; i++) {
            const file = maskFiles[i];
            const img = new Image();
            const url = URL.createObjectURL(file);
            
            statusDiv.textContent = `Loading mask ${i + 1}/${maskFiles.length}: ${file.name}`;
            
            await new Promise((resolve) => {
                img.onload = () => {
                    const maskObj = {
                        img: img,
                        name: file.name,
                        url: url
                    };
                    this.masks.push(maskObj);
                    this.masksMap.set(this.normalizeBase(file.name), maskObj);
                    
                    const progress = ((i + 1) / maskFiles.length) * 100;
                    progressFill.style.width = progress + '%';
                    resolve();
                };
                img.onerror = () => {
                    resolve();
                };
                img.src = url;
            });
            
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        
        progressBar.style.display = 'none';
        statusDiv.textContent = `✅ Loaded ${this.masks.length} masks`;
        
        this.masks.sort((a, b) => a.name.localeCompare(b.name));
        this.masksMap.clear();
        for (const m of this.masks) {
            this.masksMap.set(this.normalizeBase(m.name), m);
        }
        
        this.showToast(`Loaded ${this.masks.length} masks`);
        this.updateUI();
        this.drawImage();
    }
    
    findMaskForImage(imageName) {
        return this.masksMap.get(this.normalizeBase(imageName)) || null;
    }
    
    updateSessionWithImages() {
        this.images.forEach(image => {
            if (!this.sessionData.classifications[image.name]) {
                this.sessionData.classifications[image.name] = {
                    status: 'pending',
                    timestamp: null,
                    notes: ''
                };
            }
        });
        this.updateStats();
        this.updateSessionStatus();
    }
    
    newSession() {
        if (Object.keys(this.sessionData.classifications).length > 0) {
            if (!confirm('Are you sure you want to start a new session? All current progress will be lost.')) {
                return;
            }
        }
        
        this.sessionData = {
            sessionId: this.generateSessionId(),
            createdAt: new Date().toISOString(),
            classifications: {},
            settings: {}
        };
        
        this.stats = {
            approved: 0,
            rejected: 0,
            skipped: 0,
            pending: 0,
            total: this.images.length
        };
        
        this.currentIndex = 0;
        this.updateSessionWithImages();
        
        if (this.projectId) {
            localStorage.removeItem(this.projectId);
        }
        
        this.updateUI();
        this.showToast('New session started');
    }
    
    persistSettings() {
        this.sessionData.settings = {
            maskClasses: this.maskClasses,
            backgroundColor: this.backgroundColor,
            transparentBackground: this.transparentBackground,
            transparency: this.transparency,
            autoAdvance: this.autoAdvance,
            currentIndex: this.currentIndex,
            lastViewedFilename: this.images[this.currentIndex] ? this.images[this.currentIndex].name : null
        };
        this.saveToLocalStorage();
    }
    
    saveSession() {
        if (!this.images.length) {
            this.showToast('No data to save');
            return;
        }
        
        this.persistSettings();
        this.sessionData.lastSaved = new Date().toISOString();
        
        const dataStr = JSON.stringify(this.sessionData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `image_analysis_session_${this.sessionData.sessionId}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showToast('Session saved successfully');
        this.updateSessionStatus();
    }
    
    loadSession(file) {
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Normalise: handle both native session format and exported results format
                let sessionId, classifications, settings;
                
                if (data.sessionId && data.classifications) {
                    // Native session format
                    sessionId = data.sessionId;
                    classifications = data.classifications;
                    settings = data.settings || {};
                } else if (data.sessionInfo && data.details) {
                    // Exported results format
                    sessionId = data.sessionInfo.sessionId;
                    settings = data.sessionInfo.settings || {};
                    classifications = {};
                    (data.details || []).forEach(d => {
                        classifications[d.filename] = {
                            status: d.status,
                            timestamp: d.timestamp,
                            notes: d.notes || ''
                        };
                    });
                } else {
                    throw new Error('Unrecognised session file format');
                }
                
                this.sessionData = {
                    sessionId,
                    createdAt: data.createdAt || data.sessionInfo?.createdAt || new Date().toISOString(),
                    classifications,
                    settings
                };
                
                if (this.images.length) {
                    if (settings) this.applySettings(settings);
                    let restored = false;
                    
                    if (settings.lastViewedFilename) {
                        const idx = this.images.findIndex(im => im.name === settings.lastViewedFilename);
                        if (idx >= 0) {
                            this.currentIndex = idx;
                            restored = true;
                        }
                    }
                    
                    if (!restored && typeof settings.currentIndex === 'number') {
                        this.currentIndex = Math.min(Math.max(0, settings.currentIndex), Math.max(0, this.images.length - 1));
                    }
                    
                    this.updateStats();
                    this.updateUI();
                    this.updateSessionStatus();
                    this.drawImage();
                    this.saveToLocalStorage();
                    
                    this.showToast(`Session loaded (${Object.keys(classifications).length} images)`);
                } else {
                    this.deferredRestore = {
                        settings,
                        currentIndex: settings.currentIndex || 0,
                        lastViewedFilename: settings.lastViewedFilename || null
                    };
                    this.showToast('Session settings queued. Load images to apply.');
                }
                
            } catch (error) {
                console.error('Error loading session:', error);
                this.showToast('Error: ' + error.message);
            }
        };
        reader.readAsText(file);
    }
    
    setImageStatus(status) {
        if (!this.images.length || this.currentIndex >= this.images.length) return;
        
        const currentImage = this.images[this.currentIndex];
        this.sessionData.classifications[currentImage.name] = {
            status: status,
            timestamp: new Date().toISOString(),
            notes: ''
        };
        
        this.updateStats();
        this.updateCurrentImageStatus();
        this.updateUI();
        this.persistSettings();
        
        this.showToast(`Image ${status}`);
    }
    
    afterActionAdvance() {
        if (!this.autoAdvance) return;
        const nextPendingIdx = this.findNextPendingIndex(this.currentIndex + 1);
        if (nextPendingIdx !== -1) {
            this.currentIndex = nextPendingIdx;
        } else if (this.currentIndex < this.images.length - 1) {
            this.currentIndex++;
        }
        this.resetView();
        this.drawImage();
        this.updateUI();
    }
    
    clearImageStatus() {
        if (!this.images.length || this.currentIndex >= this.images.length) return;
        
        const currentImage = this.images[this.currentIndex];
        this.sessionData.classifications[currentImage.name] = {
            status: 'pending',
            timestamp: null,
            notes: ''
        };
        
        this.updateStats();
        this.updateCurrentImageStatus();
        this.updateUI();
        this.persistSettings();
        
        this.showToast('Status cleared');
    }
    
    updateStats() {
        this.stats = {
            approved: 0,
            rejected: 0,
            skipped: 0,
            pending: 0,
            total: this.images.length
        };
        
        Object.values(this.sessionData.classifications).forEach(classification => {
            if (classification && classification.status && this.stats[classification.status] !== undefined) {
                this.stats[classification.status]++;
            }
        });
    }
    
    updateCurrentImageStatus() {
        const statusDisplay = document.getElementById('statusDisplay');
        const statusActions = document.getElementById('statusActions');
        
        if (!this.images.length || this.currentIndex >= this.images.length) {
            statusDisplay.textContent = 'No image selected';
            statusActions.style.display = 'none';
            return;
        }
        
        const currentImage = this.images[this.currentIndex];
        const classification = this.sessionData.classifications[currentImage.name];
        
        if (classification) {
            const statusClass = `status-${classification.status}`;
            const statusText = classification.status.charAt(0).toUpperCase() + classification.status.slice(1);
            const timestamp = classification.timestamp ? new Date(classification.timestamp).toLocaleString() : '';
            
            statusDisplay.innerHTML = `
                <div>Status: <span class="status-indicator ${statusClass}">${statusText}</span></div>
                ${timestamp ? `<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">Updated: ${timestamp}</div>` : ''}
            `;
        } else {
            statusDisplay.innerHTML = '<div>Status: <span class="status-indicator status-pending">Pending</span></div>';
        }
        
        statusActions.style.display = 'grid';
    }
    
    updateSessionStatus() {
        const sessionStatus = document.getElementById('sessionStatus');
        const totalClassified = this.stats.approved + this.stats.rejected + this.stats.skipped;
        const totalImages = this.stats.total;
        
        if (totalImages > 0) {
            const progress = Math.round((totalClassified / totalImages) * 100);
            sessionStatus.textContent = `Progress: ${totalClassified}/${totalImages} (${progress}%)`;
        } else {
            sessionStatus.textContent = 'No images loaded';
        }
    }
    
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
    }
    
    resizeCanvas() {
        const container = document.getElementById('imageContainer');
        const rect = container.getBoundingClientRect();
        this.canvas.width = Math.max(60, rect.width - 24);
        this.canvas.height = Math.max(60, rect.height - 24);
        this.drawImage();
    }
    
    applyMaskToImageData(data, lookup) {
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i]; // assuming red channel is greyscale index
            const entry = lookup.get(gray);
            
            if (entry && entry.visible) {
                data[i] = entry.color.r;
                data[i + 1] = entry.color.g;
                data[i + 2] = entry.color.b;
                data[i + 3] = 255;
            } else if (entry && !entry.visible) {
                data[i + 3] = 0;
            } else {
                // Background fallback
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
    }
    
    drawImage() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!this.images.length || this.currentIndex >= this.images.length) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '15px var(--font-body), sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No images loaded. Drag files or fetch from Azure to begin.', this.canvas.width / 2, this.canvas.height / 2);
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
            img.onload = () => {
                currentImage.img = img;
                this.drawImage();
            };
            img.onerror = () => {
                ctx.fillText(`❌ Failed to load: ${currentImage.name}`, this.canvas.width / 2, this.canvas.height / 2);
            };
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
        
        // Draw main image
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        
        // On-demand mask fetch for Azure mode
        let maskObj = this.findMaskForImage(currentImage.name);
        
        if (this.isAzureMode && !maskObj && !this.pendingMaskLoads.has(currentImage.name)) {
            this.pendingMaskLoads.add(currentImage.name);
            const maskUrl = currentImage.url.replace('/img/', '/msk/');
            
            const maskImg = new Image();
            maskImg.crossOrigin = 'anonymous';
            maskImg.onload = () => {
                const loadedMask = {
                    img: maskImg,
                    name: currentImage.name,
                    url: maskUrl
                };
                this.masks.push(loadedMask);
                this.masksMap.set(this.normalizeBase(currentImage.name), loadedMask);
                this.drawImage();
            };
            maskImg.src = maskUrl;
        }
        
        // Draw mask overlay
        if (maskObj) {
            const lookup = this.buildClassLookup();
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
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.lastMousePos = {
            x: e.clientX,
            y: e.clientY
        };
        this.canvas.style.cursor = 'grabbing';
    }
    
    drag(e) {
        if (!this.isDragging) return;
        
        const deltaX = e.clientX - this.lastMousePos.x;
        const deltaY = e.clientY - this.lastMousePos.y;
        
        this.panX += deltaX;
        this.panY += deltaY;
        
        this.lastMousePos = {
            x: e.clientX,
            y: e.clientY
        };
        
        this.drawImage();
    }
    
    endDrag() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }
    
    handleZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom *= delta;
        this.zoom = Math.max(0.1, Math.min(5, this.zoom));
        
        document.getElementById('zoomSlider').value = this.zoom * 100;
        document.getElementById('zoomValue').textContent = Math.round(this.zoom * 100) + '%';
        
        this.drawImage();
    }
    
    handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch(e.key.toLowerCase()) {
            case 'arrowleft':
                e.preventDefault();
                this.previousImage();
                break;
            case 'arrowright':
                e.preventDefault();
                this.nextImage();
                break;
            case 'a':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('approved');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 'r':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('rejected');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 's':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('skipped');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 'z':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.resetView();
                    this.drawImage();
                }
                break;
        }
    }
    
    previousImage() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.resetView();
            this.drawImage();
            this.updateUI();
            this.updateCurrentImageStatus();
            this.persistSettings();
        }
    }
    
    nextImage() {
        if (this.currentIndex < this.images.length - 1) {
            this.currentIndex++;
            this.resetView();
            this.drawImage();
            this.updateUI();
            this.updateCurrentImageStatus();
            this.persistSettings();
        }
    }
    
    findNextPendingIndex(start) {
        const n = this.images.length;
        if (n === 0) return -1;
        for (let k = 0; k < n; k++) {
            const idx = (start + k) % n;
            const name = this.images[idx].name;
            const c = this.sessionData.classifications[name];
            if (!c || c.status === 'pending') return idx;
        }
        return -1;
    }
    
    jumpToNextPending() {
        const idx = this.findNextPendingIndex(this.currentIndex + 1);
        if (idx === -1) {
            this.showToast('No pending images left');
            return;
        }
        this.currentIndex = idx;
        this.resetView();
        this.drawImage();
        this.updateUI();
    }
    
    resetView() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        document.getElementById('zoomSlider').value = 100;
        document.getElementById('zoomValue').textContent = '100%';
    }
    
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
            if (!indices.includes(randomIndex)) {
                indices.push(randomIndex);
            }
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
                    if (allowed.has(name)) {
                        newClass[name] = this.sessionData.classifications[name];
                    }
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
            
            const index = indices[processIndex];
            newImages.push(this.images[index]);
            
            const progress = ((processIndex + 1) / indices.length) * 100;
            progressFill.style.width = progress + '%';
            
            processIndex++;
            setTimeout(processNext, 15);
        };
        
        processNext();
    }
    
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
            
            const lookup = this.buildClassLookup();
            this.applyMaskToImageData(imageData.data, lookup);
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
    }
    
    // --- JSZip Project Bundling ---
    async loadJSZip() {
        if (window.JSZip) return window.JSZip;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.onload = () => resolve(window.JSZip);
            s.onerror = (e) => reject(new Error('Failed to load JSZip from CDN'));
            document.body.appendChild(s);
        });
    }
    
    getImageBlob(img) {
        return new Promise((resolve) => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob(resolve, 'image/png');
        });
    }
    
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
                const lookup = this.buildClassLookup();
                this.applyMaskToImageData(imageData.data, lookup);
                tctx.putImageData(imageData, 0, 0);
                
                ctx.globalAlpha = this.transparency;
                ctx.drawImage(tc, 0, 0);
                ctx.globalAlpha = 1.0;
            }
            c.toBlob(resolve, 'image/png');
        });
    }
    
    generateReadmeContent() {
        const total = this.stats.total;
        const app = this.stats.approved;
        const rej = this.stats.rejected;
        const skp = this.stats.skipped;
        const pnd = this.stats.pending;
        
        return `# GeoAI Image Analysis Project Export

This archive contains the sorted results of your GeoAI image analysis session.

## Classification Summary
- **Total Images**: ${total}
- **Approved**: ${app} (${Math.round(app/Math.max(1,total)*100)}%)
- **Rejected**: ${rej} (${Math.round(rej/Math.max(1,total)*100)}%)
- **Skipped**: ${skp} (${Math.round(skp/Math.max(1,total)*100)}%)
- **Pending**: ${pnd} (${Math.round(pnd/Math.max(1,total)*100)}%)

## File Structure
- **01_approved/**: Images approved for training or production
- **02_rejected/**: Images flagged with quality or segmentation issues
- **03_skipped/**: Images skipped during classification
- **04_pending/**: Images that have not been classified yet
- **results.json**: Full machine-readable export metadata
- **results.csv**: Spreadsheet table containing filenames, statuses, and notes
`;
    }
    
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
    }
    
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
            
            // Build sub-directories
            const folders = {
                approved: zip.folder('01_approved'),
                rejected: zip.folder('02_rejected'),
                skipped: zip.folder('03_skipped'),
                pending: zip.folder('04_pending')
            };
            
            for (let i = 0; i < this.images.length; i++) {
                const item = this.images[i];
                statusText.textContent = `📦 Packing image ${i+1}/${this.images.length}: ${item.name}...`;
                
                // Lazily load dynamic image if it is missing
                if (!item.img) {
                    await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload = () => {
                            item.img = img;
                            resolve();
                        };
                        img.onerror = () => reject(new Error(`Failed to load ${item.name}`));
                        img.src = item.url;
                    });
                }
                
                const c = this.sessionData.classifications[item.name] || { status: 'pending' };
                const folder = folders[c.status] || folders.pending;
                
                // 1. Add raw image
                const imgBlob = await this.getImageBlob(item.img);
                folder.file(item.name, imgBlob);
                
                // 2. Add mask if toggled
                const maskObj = this.findMaskForImage(item.name);
                
                // Lazily fetch mask from Azure if not preloaded
                if (this.isAzureMode && !maskObj && incMasks) {
                    const maskUrl = item.url.replace('/img/', '/msk/');
                    await new Promise((resolve) => {
                        const maskImg = new Image();
                        maskImg.crossOrigin = 'anonymous';
                        maskImg.onload = () => {
                            const newMask = { img: maskImg, name: item.name, url: maskUrl };
                            this.masks.push(newMask);
                            this.masksMap.set(this.normalizeBase(item.name), newMask);
                            resolve();
                        };
                        maskImg.onerror = () => resolve(); // continue if mask fails
                        maskImg.src = maskUrl;
                    });
                }
                
                const resolvedMask = this.findMaskForImage(item.name);
                if (resolvedMask && incMasks) {
                    const maskBlob = await this.getImageBlob(resolvedMask.img);
                    folder.file(`mask_${item.name}`, maskBlob);
                }
                
                // 3. Add overlay preview if toggled
                if (incOverlays) {
                    const overlayBlob = await this.createOverlayBlob(item.img, resolvedMask);
                    folder.file(`preview_${item.name}`, overlayBlob);
                }
                
                progressFill.style.width = `${((i+1)/this.images.length)*80}%`;
                await new Promise(r => setTimeout(r, 10));
            }
            
            statusText.textContent = '📦 Formatting spreadsheets and readme...';
            
            // Add metadata reports
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
            a.download = `geoai_overlay_project_${this.sessionData.sessionId}.zip`;
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
    }
    
    updateUI() {
        const hasImages = this.images.length > 0;
        
        // Update navigation buttons
        document.getElementById('prevBtn').disabled = !hasImages || this.currentIndex <= 0;
        document.getElementById('nextBtn').disabled = !hasImages || this.currentIndex >= this.images.length - 1;
        document.getElementById('navPrevBtn').disabled = !hasImages || this.currentIndex <= 0;
        document.getElementById('navNextBtn').disabled = !hasImages || this.currentIndex >= this.images.length - 1;
        
        // Update action buttons
        document.getElementById('exportBtn').disabled = !hasImages;
        document.getElementById('exportResultsBtn').disabled = !hasImages;
        document.getElementById('createSubsetBtn').disabled = !hasImages;
        document.getElementById('downloadProjectBtn').disabled = !hasImages;
        
        // Update statistics
        document.getElementById('currentIndex').textContent = hasImages ? this.currentIndex + 1 : 0;
        document.getElementById('totalImages').textContent = this.images.length;
        document.getElementById('approvedCount').textContent = this.stats.approved;
        document.getElementById('rejectedCount').textContent = this.stats.rejected;
        document.getElementById('skippedCount').textContent = this.stats.skipped;
        document.getElementById('pendingCount').textContent = this.stats.pending;
        
        // Update image info
        const imageInfo = document.getElementById('imageInfo');
        if (hasImages) {
            const currentImage = this.images[this.currentIndex];
            imageInfo.textContent = `${currentImage.name} (${this.currentIndex + 1}/${this.images.length})`;
        } else {
            imageInfo.textContent = 'No images loaded';
        }
        
        this.updateCurrentImageStatus();
        this.updateSessionStatus();
    }
    
    showToast(message) {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.innerHTML = `<span class="toast-icon">✨</span> ${message}`;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }
    }
}
