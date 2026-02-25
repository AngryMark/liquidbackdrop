/**
 * LiquidBackdrop Engine v0.2.0
 * Major performance upgrade: Switched from RAF loop to Observer API.
 * Improved displacement masking logic.
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
        console.log('💧 LiquidBackdrop v0.2.0 (Observer Upgrade) Started');

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
                        svgContent += `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${content}</filter>`;
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
        this.filters.set('liquid-glass', (element, refraction = 1, offset = 10, chromatic = 0) => {
            const width = Math.round(element.offsetWidth);
            const height = Math.round(element.offsetHeight);
            if (width === 0 || height === 0) return '';

            const refractionValue = parseFloat(refraction) / 2 || 0;
            const offsetValue = (parseFloat(offset) || 0) / 2;
            const chromaticValue = parseFloat(chromatic) || 0;
            
            const computed = getComputedStyle(element);
            let borderRadius = 0;
            if (computed.borderRadius.includes('%')) {
                borderRadius = (parseFloat(computed.borderRadius) / 100) * Math.min(width, height);
            } else {
                borderRadius = parseFloat(computed.borderRadius) || 0;
            }

            const maxDimension = Math.ceil(Math.max(width, height));

            function createDisplacementMap(refractionMod) {
                const adjustedRefraction = refractionValue + refractionMod;
                const canvas = document.createElement('canvas');
                canvas.width = maxDimension;
                canvas.height = maxDimension;
                const ctx = canvas.getContext('2d');
                
                const imageData = ctx.createImageData(maxDimension, maxDimension);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    data[i] = 127;     
                    data[i + 1] = 127; 
                    data[i + 2] = 127; 
                    data[i + 3] = 255; 
                }

                const topOffset = Math.floor(maxDimension / 2);
                
                for (let y = 0; y < topOffset; y++) {
                    for (let x = 0; x < maxDimension; x++) {
                        const gradientSegment = (topOffset - y) / topOffset; 
                        const idx = (y * maxDimension + x) * 4;
                        const v = 1 * adjustedRefraction;
                        data[idx + 2] = Math.max(0, Math.min(255, Math.round(127 + 127 * v * Math.pow(gradientSegment, 1))));
                    }
                }
                for (let y = maxDimension - topOffset; y < maxDimension; y++) {
                    for (let x = 0; x < maxDimension; x++) {
                        const gradientSegment = (y - (maxDimension - topOffset)) / topOffset; 
                        const idx = (y * maxDimension + x) * 4;
                        const v = -1 * adjustedRefraction;
                        data[idx + 2] = Math.max(0, Math.min(255, Math.round(127 + 127 * v * Math.pow(gradientSegment, 1))));
                    }
                }
                const leftOffset = Math.floor(maxDimension / 2);
                for (let y = 0; y < maxDimension; y++) {
                    for (let x = 0; x < leftOffset; x++) {
                        const gradientSegment = (leftOffset - x) / leftOffset; 
                        const idx = (y * maxDimension + x) * 4;
                        const v = 1 * adjustedRefraction;
                        data[idx] = Math.max(0, Math.min(255, Math.round(127 + 127 * v * Math.pow(gradientSegment, 1))));
                    }
                }
                for (let y = 0; y < maxDimension; y++) {
                    for (let x = maxDimension - leftOffset; x < maxDimension; x++) {
                        const gradientSegment = (x - (maxDimension - leftOffset)) / leftOffset; 
                        const idx = (y * maxDimension + x) * 4;
                        const v = -1 * adjustedRefraction;
                        data[idx] = Math.max(0, Math.min(255, Math.round(127 + 127 * v * Math.pow(gradientSegment, 1))));
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

                ctx.fillStyle = "rgb(127, 127, 127)";
                ctx.fillRect(0, 0, width, height);

                const offsetX = (maxDimension - width) / 2;
                const offsetY = (maxDimension - height) / 2;
                
                ctx.drawImage(sourceCanvas, -Math.round(offsetX), -Math.round(offsetY));
                
                if (borderRadius > 0) {
                     const inset = offsetValue * 1;
                     ctx.fillStyle = "rgb(127, 127, 127)";
                     
                     ctx.filter = `blur(${offsetValue}px)`;
                     
                     ctx.beginPath();
                     ctx.roundRect(inset, inset, width - (inset * 2), height - (inset * 2), Math.max(0, borderRadius - inset));
                     ctx.fill();
                } else if (offsetValue > 0) {
                    ctx.filter = `blur(${offsetValue}px)`;
                    ctx.drawImage(canvas, 0, 0);
                }

                return canvas.toDataURL();
            }

            if (chromaticValue === 0) {
                const mapCanvas = createDisplacementMap(0);
                const dataURL = createFinalCanvas(mapCanvas);
                return `
                    <feImage result="FEIMG" href="${dataURL}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="FEIMG" scale="127" yChannelSelector="B" xChannelSelector="R" color-interpolation-filters="sRGB"/>
                `;
            } else {
                const chromaticOffset = chromaticValue * 0.25;
                const redDataURL = createFinalCanvas(createDisplacementMap(chromaticOffset));
                const greenDataURL = createFinalCanvas(createDisplacementMap(0));
                const blueDataURL = createFinalCanvas(createDisplacementMap(-chromaticOffset));

                return `
                    <feImage result="redImg" href="${redDataURL}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="redImg" scale="127" yChannelSelector="B" xChannelSelector="R" result="redDisplaced"/>
                    <feComponentTransfer in="redDisplaced" result="redChannel">
                        <feFuncR type="identity"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/>
                    </feComponentTransfer>

                    <feImage result="greenImg" href="${greenDataURL}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="greenImg" scale="127" yChannelSelector="B" xChannelSelector="R" result="greenDisplaced"/>
                    <feComponentTransfer in="greenDisplaced" result="greenChannel">
                        <feFuncR type="discrete" tableValues="0"/><feFuncG type="identity"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/>
                    </feComponentTransfer>

                    <feImage result="blueImg" href="${blueDataURL}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="blueImg" scale="127" yChannelSelector="B" xChannelSelector="R" result="blueDisplaced"/>
                    <feComponentTransfer in="blueDisplaced" result="blueChannel">
                        <feFuncR type="discrete" tableValues="0"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="identity"/><feFuncA type="identity"/>
                    </feComponentTransfer>

                    <feComposite in="redChannel" in2="greenChannel" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="redGreen"/>
                    <feComposite in="redGreen" in2="blueChannel" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="final"/>
                `;
            }
        });
    }
}