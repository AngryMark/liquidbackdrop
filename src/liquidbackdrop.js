/**
 * LiquidBackdrop Engine v0.3.0
 * Render Upgrade: SDF-based generation, Spherical interpolation, UserSpace units.
 * 
 * @author AngryMark
 * @license MIT
 */

export default class LiquidBackdrop {
    static elements = new WeakMap();
    static filters = new Map();
    static running = false;
    
    static resizeObserver = null;
    static mutationObserver = null;
    static intersectionObserver = null;

    static CSS_PROP = '--liquid-backdrop';

    static start() {
        if (this.running) return;
        this.running = true;
        console.log('💧 LiquidBackdrop v0.3.0 (SDF Render) Started');

        if ('CSS' in window && 'registerProperty' in CSS) {
            try {
                CSS.registerProperty({
                    name: this.CSS_PROP,
                    syntax: '*',
                    inherits: false,
                    initialValue: ''
                });
            } catch (e) {}
        }

        this.#registerCore();
        this.#setupObservers();
        this.#scanInitialDOM();
    }

    static #setupObservers() {
        this.resizeObserver = new ResizeObserver((entries) => {
            requestAnimationFrame(() => {
                for (const entry of entries) {
                    const element = entry.target;
                    const state = this.elements.get(element);
                    if (state && state.isVisible) {
                        this.#updateContainer(element, state.currentVal);
                    }
                }
            });
        });

        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const element = entry.target;
                const state = this.elements.get(element);
                if (state) {
                    state.isVisible = entry.isIntersecting;
                    if (entry.isIntersecting) {
                        this.#updateContainer(element, state.currentVal);
                    }
                }
            });
        }, { rootMargin: '200px' });

        this.mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) this.#checkAndAttach(node);
                    });
                    mutation.removedNodes.forEach(node => {
                         if (node.nodeType === 1) this.#cleanupElement(node);
                    });
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    this.#checkAndAttach(mutation.target);
                }
            });
        });

        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });
    }

    static #scanInitialDOM() {
        document.querySelectorAll('*').forEach(el => this.#checkAndAttach(el));
    }

    static #checkAndAttach(element) {
        if (element.classList.contains('lb-container') || element.tagName === 'svg') return;

        const val = getComputedStyle(element).getPropertyValue(this.CSS_PROP).trim();
        const state = this.elements.get(element);

        if (val && val !== 'none') {
            if (!state || state.currentVal !== val) {
                if (!state) {
                    this.#initElement(element, val);
                } else {
                    this.#updateContainer(element, val);
                }
            }
        } else {
            if (state) {
                this.#cleanupElement(element);
            }
        }
    }

    static #initElement(element, val) {
        const computedStyle = getComputedStyle(element);
        if (computedStyle.position === 'static') {
            element.style.position = 'relative';
        }

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position: absolute; width: 0; height: 0; pointer-events: none;";
        svg.classList.add('lb-svg-root');
        
        const container = document.createElement('div');
        container.classList.add('lb-container');
        container.style.cssText = "position: absolute; inset: 0; background: transparent; pointer-events: none; z-index: -1; overflow: hidden; border-radius: inherit;";

        element.appendChild(svg);
        element.appendChild(container);

        this.elements.set(element, {
            currentVal: val,
            svg: svg,
            container: container,
            isVisible: true
        });

        this.resizeObserver.observe(element);
        this.intersectionObserver.observe(element);

        this.#updateContainer(element, val);
    }

    static #cleanupElement(element) {
        if (!this.elements.has(element)) return;
        const state = this.elements.get(element);
        
        this.resizeObserver.unobserve(element);
        this.intersectionObserver.unobserve(element);

        if (state.container) state.container.remove();
        if (state.svg) state.svg.remove();

        this.elements.delete(element);
    }

    static #updateContainer(element, val) {
        const state = this.elements.get(element);
        if (!state) return;

        state.currentVal = val;
        const parsed = this.#parse(val);
        
        let svgContent = '';
        const filterParts = [];

        parsed.forEach(item => {
            if (item.type === 'custom') {
                const fn = this.filters.get(item.name);
                if (fn) {
                    const id = `lb-${item.name}-${Math.random().toString(36).substr(2, 6)}`;
                    const content = fn(element, ...item.args);
                    if (content) {
                        svgContent += `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${content}</filter>`;
                        filterParts.push(`url(#${id})`);
                    }
                }
            } else {
                filterParts.push(item.raw);
            }
        });

        state.svg.innerHTML = svgContent;
        const backdropFilter = filterParts.join(' ');
        
        if (backdropFilter.trim()) {
            state.container.style.backdropFilter = backdropFilter;
            state.container.style.webkitBackdropFilter = backdropFilter;
        }
    }

    static #parse(str) {
        const tokens = [];
        const re = /(\w+(?:-\w+)*)\s*\(([^)]*)\)/g;
        let m;
        while ((m = re.exec(str)) !== null) {
            const name = m[1];
            const args = m[2] ? m[2].split(',').map(s => parseFloat(s.trim()) || s.trim()) : [];
            if (this.filters.has(name)) tokens.push({ type: 'custom', name, args });
            else tokens.push({ type: 'css', raw: m[0] });
        }
        return tokens;
    }

    static #registerCore() {
        this.filters.set('liquid-glass', (element, refraction = 1, bevel = 10, chromatic = 0) => {
            const width = Math.round(element.offsetWidth);
            const height = Math.round(element.offsetHeight);
            if (width === 0 || height === 0) return '';

            const refractionValue = parseFloat(refraction) || 0;
            const bevelValue = Math.max(1, parseFloat(bevel) || 0);
            const chromaticValue = parseFloat(chromatic) || 0;

            const maxDimension = Math.ceil(Math.max(width, height));

            function drawRoundedPath(ctx, x, y, w, h, r) {
                const radius = Math.min(r, Math.min(w / 2, h / 2));
                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.lineTo(x + w - radius, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
                ctx.lineTo(x + w, y + h - radius);
                ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
                ctx.lineTo(x + radius, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.closePath();
            }

            function circleMap(x) {
                if (x >= 1) return 1;
                if (x <= 0) return 0;
                return 1.0 - Math.sqrt(1.0 - x * x);
            }

            function createMap() {
                const canvas = document.createElement('canvas');
                canvas.width = maxDimension;
                canvas.height = maxDimension;
                const ctx = canvas.getContext('2d');
                
                const imageData = ctx.createImageData(maxDimension, maxDimension);
                const data = imageData.data;

                const startX = Math.floor((maxDimension - width) / 2);
                const startY = Math.floor((maxDimension - height) / 2);
                const endX = startX + width;
                const endY = startY + height;

                const limit = bevelValue;

                for (let y = 0; y < maxDimension; y++) {
                    for (let x = 0; x < maxDimension; x++) {
                        const idx = (y * maxDimension + x) * 4;

                        if (x < startX || x >= endX || y < startY || y >= endY) {
                            data[idx] = 127;     
                            data[idx + 1] = 0;   
                            data[idx + 2] = 127; 
                            data[idx + 3] = 255;
                            continue;
                        }

                        const lx = x - startX;
                        const ly = y - startY;

                        const dLeft = lx;
                        const dRight = width - 1 - lx;
                        const dTop = ly;
                        const dBottom = height - 1 - ly;
                        const minDist = Math.min(dLeft, dRight, dTop, dBottom);

                        if (minDist < limit) {
                            const progress = 1 - (minDist / limit); 
                            const intensity = circleMap(progress);  

                            let nx = 0, ny = 0;
                            if (minDist === dLeft) nx = -1;
                            else if (minDist === dRight) nx = 1;
                            
                            if (minDist === dTop) ny = -1;
                            else if (minDist === dBottom) ny = 1;

                            const dispX = 127 - (nx * intensity * 127);
                            const dispY = 127 - (ny * intensity * 127);

                            data[idx] = Math.max(0, Math.min(255, dispX));     // R
                            data[idx + 2] = Math.max(0, Math.min(255, dispY)); // B
                            data[idx + 1] = 0; // No highlight
                            data[idx + 3] = 255;
                        } else {
                            data[idx] = 127;
                            data[idx + 1] = 0;
                            data[idx + 2] = 127;
                            data[idx + 3] = 255;
                        }
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                return canvas;
            }

            function createFinalCanvas(sourceCanvas) {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = "rgb(127, 0, 127)";
                ctx.fillRect(0, 0, width, height);

                const offsetX = (maxDimension - width) / 2;
                const offsetY = (maxDimension - height) / 2;
                
                ctx.drawImage(sourceCanvas, -Math.round(offsetX), -Math.round(offsetY));
                
                const computed = getComputedStyle(element);
                let br = parseFloat(computed.borderRadius) || 0;
                if (computed.borderRadius.includes('%')) br = (parseFloat(computed.borderRadius)/100) * Math.min(width, height);

                const inset = bevelValue;
                
                if (width > inset * 2 && height > inset * 2) {
                     ctx.fillStyle = "rgb(127, 0, 127)";
                     if (bevelValue > 2) ctx.filter = `blur(${bevelValue/3}px)`;
                     drawRoundedPath(ctx, inset, inset, width - (inset * 2), height - (inset * 2), Math.max(0, br - inset/2));
                     ctx.fill();
                }

                return canvas.toDataURL();
            }

            const mapCanvas = createMap();
            const mainDataURL = createFinalCanvas(mapCanvas);

            const baseScale = refractionValue * 2;

            if (chromaticValue === 0) {
                return `
                    <feImage result="MAP" href="${mainDataURL}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${baseScale}" xChannelSelector="R" yChannelSelector="B"/>
                `;
            } else {
                 const rScale = baseScale + (chromaticValue * 2);
                 const bScale = Math.max(0, baseScale - (chromaticValue * 2));
                 
                 return `
                    <feImage result="MAP" href="${mainDataURL}" color-interpolation-filters="sRGB"/>
                    
                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${rScale}" xChannelSelector="R" yChannelSelector="B" result="R_DISP"/>
                    <feComponentTransfer in="R_DISP" result="R_LAYER"><feFuncR type="identity"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>

                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${baseScale}" xChannelSelector="R" yChannelSelector="B" result="G_DISP"/>
                    <feComponentTransfer in="G_DISP" result="G_LAYER"><feFuncR type="discrete" tableValues="0"/><feFuncG type="identity"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>

                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${bScale}" xChannelSelector="R" yChannelSelector="B" result="B_DISP"/>
                    <feComponentTransfer in="B_DISP" result="B_LAYER"><feFuncR type="discrete" tableValues="0"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="identity"/><feFuncA type="identity"/></feComponentTransfer>

                    <feComposite in="R_LAYER" in2="G_LAYER" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="RG"/>
                    <feComposite in="RG" in2="B_LAYER" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
                 `;
            }
        });
    }
}