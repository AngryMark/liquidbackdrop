/**
 * LiquidBackdrop Engine v0.1
 * 
 * @author AngryMark
 * @license MIT
 */

export default class LiquidBackdrop {
    static elements = new WeakMap();
    static filters = new Map();
    static running = false;
    static CSS_PROP = '--liquid-backdrop';

    static start() {
        if (this.running) return;
        console.log('💧 LiquidBackdrop v0.1.0 Started');

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
        this.running = true;
        this.#tick();
    }

    static #tick() {
        this.#scan();
        requestAnimationFrame(() => this.#tick());
    }

    static #scan() {
        document.querySelectorAll(`*:not(.lb-container):not(svg)`).forEach(el => {
            const rawVal = getComputedStyle(el).getPropertyValue(this.CSS_PROP).trim();
            const stored = this.elements.get(el);
            const rect = el.getBoundingClientRect();

            if (rawVal && rawVal !== 'none') {
                const dimsChanged = stored && (stored.w !== rect.width || stored.h !== rect.height);
                if (!stored || stored.val !== rawVal || dimsChanged) {
                    this.#apply(el, rawVal);
                }
            } else if (stored) {
                this.#remove(el);
            }
        });
    }

    static #apply(el, val) {
        const parsed = this.#parse(val);
        let svgContent = '';
        const filterStack = [];

        parsed.forEach(item => {
            if (item.type === 'custom') {
                const fn = this.filters.get(item.name);
                if (fn) {
                    const id = `lb-${item.name}-${Math.random().toString(36).substr(2,6)}`;
                    const filterDef = fn(el, ...item.args);
                    if (filterDef) {
                        svgContent += `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${filterDef}</filter>`;
                        filterStack.push(`url(#${id})`);
                    }
                }
            } else {
                filterStack.push(item.raw);
            }
        });

        this.#removeDOM(el);
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

        const finalFilter = filterStack.join(' ');
        const html = `
            <svg style="position:absolute; width:0; height:0; pointer-events:none;">${svgContent}</svg>
            <div class="lb-container" style="
                position:absolute; inset:0; z-index:-1;
                background:transparent; pointer-events:none; overflow:hidden; border-radius:inherit;
                backdrop-filter: ${finalFilter}; -webkit-backdrop-filter: ${finalFilter};
            "></div>
        `;
        
        el.insertAdjacentHTML('beforeend', html);
        this.elements.set(el, { val: val, w: el.offsetWidth, h: el.offsetHeight });
    }

    static #remove(el) {
        this.#removeDOM(el);
        this.elements.delete(el);
    }

    static #removeDOM(el) {
        const c = el.querySelector('.lb-container');
        const s = el.querySelector('svg');
        if (c) c.remove();
        if (s && s.parentNode === el) s.remove();
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
            const w = Math.round(element.offsetWidth);
            const h = Math.round(element.offsetHeight);
            const refVal = parseFloat(refraction) / 2 || 0;
            const offVal = (parseFloat(offset) || 0) / 2;
            const chrVal = parseFloat(chromatic) || 0;

            let br = 0;
            const style = getComputedStyle(element);
            if (style.borderRadius.includes('%')) {
                br = (parseFloat(style.borderRadius) / 100) * Math.min(w, h);
            } else {
                br = parseFloat(style.borderRadius) || 0;
            }

            const maxDim = Math.ceil(Math.max(w, h));

            const createMap = (mod) => {
                const adjRef = refVal + mod;
                const img = new ImageData(maxDim, maxDim);
                const d = img.data;

                for (let i=0; i<d.length; i+=4) { d[i]=127; d[i+1]=127; d[i+2]=127; d[i+3]=255; }

                const edge = Math.floor(maxDim / 2);

                for (let y=0; y<edge; y++) {
                    for (let x=0; x<maxDim; x++) {
                        const grad = (edge - y) / edge;
                        const idx = (y * maxDim + x) * 4;
                        d[idx+2] = Math.max(0, Math.min(255, Math.round(127 + 127 * (1 * adjRef) * grad)));
                    }
                }
                for (let y=maxDim-edge; y<maxDim; y++) {
                    for (let x=0; x<maxDim; x++) {
                        const grad = (y - (maxDim - edge)) / edge;
                        const idx = (y * maxDim + x) * 4;
                        d[idx+2] = Math.max(0, Math.min(255, Math.round(127 + 127 * (-1 * adjRef) * grad)));
                    }
                }
                for (let y=0; y<maxDim; y++) {
                    for (let x=0; x<edge; x++) {
                        const grad = (edge - x) / edge;
                        const idx = (y * maxDim + x) * 4;
                        d[idx] = Math.max(0, Math.min(255, Math.round(127 + 127 * (1 * adjRef) * grad)));
                    }
                }
                for (let y=0; y<maxDim; y++) {
                    for (let x=maxDim-edge; x<maxDim; x++) {
                        const grad = (x - (maxDim - edge)) / edge;
                        const idx = (y * maxDim + x) * 4;
                        d[idx] = Math.max(0, Math.min(255, Math.round(127 + 127 * (-1 * adjRef) * grad)));
                    }
                }
                return img;
            };

            const imgToUrl = (imgData) => {
                const cvs = document.createElement('canvas');
                cvs.width = w; cvs.height = h;
                const ctx = cvs.getContext('2d');
                
                const tCvs = document.createElement('canvas');
                tCvs.width = maxDim; tCvs.height = maxDim;
                tCvs.getContext('2d').putImageData(imgData, 0, 0);

                const ox = (maxDim - w) / 2;
                const oy = (maxDim - h) / 2;
                ctx.drawImage(tCvs, -ox, -oy);

                if (br > 0) {
                    const mCvs = document.createElement('canvas');
                    mCvs.width = w; mCvs.height = h;
                    const mCtx = mCvs.getContext('2d');
                    mCtx.fillStyle = "rgb(127, 127, 127)"; 
                    mCtx.beginPath();
                    const inset = offVal * 1; 
                    mCtx.roundRect(inset, inset, w - inset*2, h - inset*2, Math.max(0, br - inset));
                    mCtx.fill();

                    if (offVal > 0) ctx.filter = `blur(${offVal}px)`;
                    ctx.drawImage(mCvs, 0, 0);
                } else if (offVal > 0) {
                    const temp = ctx.getImageData(0,0,w,h);
                    ctx.clearRect(0,0,w,h);
                    ctx.filter = `blur(${offVal}px)`;
                    const tempCvs = document.createElement('canvas');
                    tempCvs.width = w; tempCvs.height = h;
                    tempCvs.getContext('2d').putImageData(temp, 0, 0);
                    ctx.drawImage(tempCvs, 0, 0);
                }
                
                return cvs.toDataURL();
            };

            if (chrVal === 0) {
                const url = imgToUrl(createMap(0));
                return `<feImage result="MAP" href="${url}" color-interpolation-filters="sRGB"/>
                        <feDisplacementMap in="SourceGraphic" in2="MAP" scale="127" xChannelSelector="R" yChannelSelector="B"/>`;
            } else {
                const offsetC = chrVal * 0.25;
                const urlR = imgToUrl(createMap(offsetC));
                const urlG = imgToUrl(createMap(0));
                const urlB = imgToUrl(createMap(-offsetC));

                return `
                    <feImage result="IR" href="${urlR}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="IR" scale="127" xChannelSelector="R" yChannelSelector="B" result="DR"/>
                    <feComponentTransfer in="DR" result="CR"><feFuncR type="identity"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>

                    <feImage result="IG" href="${urlG}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="IG" scale="127" xChannelSelector="R" yChannelSelector="B" result="DG"/>
                    <feComponentTransfer in="DG" result="CG"><feFuncR type="discrete" tableValues="0"/><feFuncG type="identity"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>

                    <feImage result="IB" href="${urlB}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="IB" scale="127" xChannelSelector="R" yChannelSelector="B" result="DB"/>
                    <feComponentTransfer in="DB" result="CB"><feFuncR type="discrete" tableValues="0"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="identity"/><feFuncA type="identity"/></feComponentTransfer>

                    <feComposite in="CR" in2="CG" operator="arithmetic" k2="1" k3="1" result="RG"/>
                    <feComposite in="RG" in2="CB" operator="arithmetic" k2="1" k3="1"/>
                `;
            }
        });
    }
}