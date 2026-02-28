/**
 * LiquidBackdrop Engine v0.4.0
 * Feature Update: Added Gyroscopic Shine with CSS Masking & Render Fixes.
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
    static ANGLE_PROP = '--lb-angle';

    static motionActive = false;
    static targetBeta = 0;
    static targetGamma = 0;
    static currentBeta = 0;
    static currentGamma = 0;

    static start() {
        if (this.running) return;
        this.running = true;
        console.log('💧 LiquidBackdrop v0.4.0 Started');

        if ('CSS' in window && 'registerProperty' in CSS) {
            try {
                CSS.registerProperty({ name: this.CSS_PROP, syntax: '*', inherits: false, initialValue: '' });
                CSS.registerProperty({ name: this.ANGLE_PROP, syntax: '<angle>', inherits: true, initialValue: '40deg' });
            } catch (e) {}
        }

        this.#registerCore();
        this.#setupObservers();
        this.#scanInitialDOM();
    }

    static #enableMotion() {
        if (this.motionActive) return;
        
        const handler = (e) => {
            if (e.beta === null) return;
            this.targetBeta = e.beta;
            this.targetGamma = e.gamma;
        };

        const loop = () => {
            const k = 0.08;
            this.currentBeta += (this.targetBeta - this.currentBeta) * k;
            this.currentGamma += (this.targetGamma - this.currentGamma) * k;

            const mag = Math.sqrt(this.currentBeta**2 + this.currentGamma**2);
            if (mag > 2.0) {
                const rad = Math.atan2(this.currentGamma, this.currentBeta);
                const deg = -(rad * (180 / Math.PI)) + 180;
                document.documentElement.style.setProperty(this.ANGLE_PROP, `${deg}deg`);
            }
            requestAnimationFrame(loop);
        };

        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const req = () => {
                DeviceOrientationEvent.requestPermission()
                    .then(r => {
                        if (r === 'granted') {
                            window.addEventListener('deviceorientation', handler);
                            this.motionActive = true;
                            loop();
                        }
                    }).catch(console.error);
                document.body.removeEventListener('click', req);
            };
            document.body.addEventListener('click', req, { capture: true, once: true });
        } else {
            window.addEventListener('deviceorientation', handler);
            this.motionActive = true;
            loop();
        }
    }

    static #setupObservers() {
        this.resizeObserver = new ResizeObserver(entries => {
            requestAnimationFrame(() => {
                for (const entry of entries) {
                    const el = entry.target;
                    const st = this.elements.get(el);
                    if (st && st.isVisible) this.#updateContainer(el, st.currentVal);
                }
            });
        });

        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const el = entry.target;
                const st = this.elements.get(el);
                if (st) {
                    st.isVisible = entry.isIntersecting;
                    if (st.isVisible) this.#updateContainer(el, st.currentVal);
                }
            });
        }, { rootMargin: '200px' });

        this.mutationObserver = new MutationObserver(list => {
            list.forEach(m => {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(n => n.nodeType === 1 && this.#checkAndAttach(n));
                    m.removedNodes.forEach(n => n.nodeType === 1 && this.#cleanupElement(n));
                } else if (m.type === 'attributes' && m.attributeName === 'style') {
                    this.#checkAndAttach(m.target);
                }
            });
        });
        this.mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    static #scanInitialDOM() {
        document.querySelectorAll('*').forEach(el => this.#checkAndAttach(el));
    }

    static #checkAndAttach(el) {
        if (el.classList.contains('lb-container') || el.tagName === 'svg') return;
        const val = getComputedStyle(el).getPropertyValue(this.CSS_PROP).trim();
        const st = this.elements.get(el);

        if (val && val !== 'none') {
            if (!st || st.currentVal !== val) {
                if (!st) this.#initElement(el, val);
                else this.#updateContainer(el, val);
            }
        } else if (st) this.#cleanupElement(el);
    }

    static #initElement(el, val) {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position: absolute; width: 0; height: 0; pointer-events: none;";
        
        const container = document.createElement('div');
        container.className = 'lb-container';
        container.style.cssText = "position: absolute; inset: 0; background: transparent; pointer-events: none; z-index: -1; overflow: hidden; border-radius: inherit;";

        const shine = document.createElement('div');
        shine.className = 'lb-shine';
        shine.style.cssText = "position: absolute; inset: 0; pointer-events: none; z-index: 2; border-radius: inherit; overflow: hidden;";

        el.appendChild(svg);
        el.appendChild(container);
        el.appendChild(shine);

        this.elements.set(el, { currentVal: val, svg, container, shine, isVisible: true });

        this.resizeObserver.observe(el);
        this.intersectionObserver.observe(el);
        this.#updateContainer(el, val);
    }

    static #cleanupElement(el) {
        if (!this.elements.has(el)) return;
        const st = this.elements.get(el);
        this.resizeObserver.unobserve(el);
        this.intersectionObserver.unobserve(el);
        st.container.remove(); st.svg.remove(); st.shine.remove();
        this.elements.delete(el);
    }

    static #updateContainer(el, val) {
        const st = this.elements.get(el);
        if (!st) return;

        st.currentVal = val;
        const parsed = this.#parse(val);
        
        let svgHTML = '';
        const filters = [];
        
        st.shine.style.background = 'none';
        st.shine.style.boxShadow = 'none';
        st.shine.style.webkitMask = 'none';

        parsed.forEach(item => {
            if (item.name === 'shine') {
                const [intensity = 0.1, angle = 40, motion = 0, edgeOp = 0.1] = item.args;
                
                if (motion === 1) this.#enableMotion();

                if (edgeOp > 0) st.shine.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, ${edgeOp})`;

                st.shine.style.webkitMask = `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`;
                st.shine.style.webkitMaskComposite = 'xor';
                st.shine.style.maskComposite = 'exclude';
                st.shine.style.padding = '1px';

                const angStr = (motion === 1) ? `var(${this.ANGLE_PROP})` : `${angle}deg`;
                
                const g1 = `linear-gradient(${angStr}, transparent 40%, rgba(255,255,255,${intensity}) 50%, transparent 60%)`;
                const g2 = `linear-gradient(calc(${angStr} + 180deg), transparent 30%, rgba(255,255,255,${intensity * 0.4}) 50%, transparent 70%)`;
                
                st.shine.style.background = `${g1}, ${g2}`;
                st.shine.style.backgroundBlendMode = 'screen';
                return;
            }

            if (item.type === 'custom') {
                const fn = this.filters.get(item.name);
                if (fn) {
                    const id = `lb-${item.name}-${Math.random().toString(36).substr(2, 6)}`;
                    const content = fn(el, ...item.args);
                    if (content) {
                        svgHTML += `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${content}</filter>`;
                        filters.push(`url(#${id})`);
                    }
                }
            } else {
                filters.push(item.raw);
            }
        });

        st.svg.innerHTML = svgHTML;
        const finalFilter = filters.join(' ');
        if (finalFilter.trim()) {
            st.container.style.backdropFilter = finalFilter;
            st.container.style.webkitBackdropFilter = finalFilter;
        }
    }

    static #parse(str) {
        const tokens = [];
        const re = /(\w+(?:-\w+)*)\s*\(([^)]*)\)/g;
        let m;
        while ((m = re.exec(str)) !== null) {
            const name = m[1];
            if (this.filters.has(name) || name === 'shine') {
                const args = m[2] ? m[2].split(',').map(s => parseFloat(s.trim()) || s.trim()) : [];
                tokens.push({ type: 'custom', name, args });
            } else {
                tokens.push({ type: 'css', raw: m[0] });
            }
        }
        return tokens;
    }

    static #registerCore() {
        this.filters.set('liquid-glass', (element, refraction = 1, bevel = 10, chromatic = 0) => {
            const width = Math.round(element.offsetWidth);
            const height = Math.round(element.offsetHeight);
            if (width < 1 || height < 1) return '';

            const refVal = parseFloat(refraction) || 0;
            const bevVal = Math.max(1, parseFloat(bevel) || 0);
            const chrVal = parseFloat(chromatic) || 0;

            const maxDim = Math.ceil(Math.max(width, height));

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
            function circleMap(x) { return (x >= 1) ? 1 : (x <= 0) ? 0 : 1.0 - Math.sqrt(1.0 - x * x); }

            function createMap() {
                const canvas = document.createElement('canvas');
                canvas.width = maxDim; canvas.height = maxDim;
                const ctx = canvas.getContext('2d');
                const d = ctx.createImageData(maxDim, maxDim);
                const data = d.data;

                const sx = Math.floor((maxDim - width) / 2);
                const sy = Math.floor((maxDim - height) / 2);
                const ex = sx + width;
                const ey = sy + height;
                const limit = bevVal;

                const comp = getComputedStyle(element);
                let br = parseFloat(comp.borderRadius) || 0;
                if (comp.borderRadius.includes('%')) br = (parseFloat(comp.borderRadius)/100) * Math.min(width, height);

                const cL = br, cR = width - br, cT = br, cB = height - br;

                for (let y = 0; y < maxDim; y++) {
                    for (let x = 0; x < maxDim; x++) {
                        const idx = (y * maxDim + x) * 4;
                        if (x < sx || x >= ex || y < sy || y >= ey) {
                            data[idx]=127; data[idx+1]=0; data[idx+2]=127; data[idx+3]=255; continue;
                        }

                        const lx = x - sx, ly = y - sy;
                        let dist = 0, nx = 0, ny = 0;
                        let inCorner = false, cx = 0, cy = 0;

                        if (br > 0) {
                            if (lx < cL && ly < cT) { inCorner=true; cx=cL; cy=cT; } 
                            else if (lx > cR && ly < cT) { inCorner=true; cx=cR; cy=cT; } 
                            else if (lx < cL && ly > cB) { inCorner=true; cx=cL; cy=cB; } 
                            else if (lx > cR && ly > cB) { inCorner=true; cx=cR; cy=cB; } 
                        }

                        if (inCorner) {
                            const dx = lx - cx, dy = ly - cy;
                            const len = Math.sqrt(dx*dx + dy*dy);
                            dist = br - len; 
                            if (dist < limit && dist >= 0) { nx = dx/len; ny = dy/len; } else dist = 10000;
                        } else {
                            const dL = lx, dR = width - 1 - lx, dT = ly, dB = height - 1 - ly;
                            dist = Math.min(dL, dR, dT, dB);
                            if (dist < limit) {
                                if (dist === dL) nx = -1; else if (dist === dR) nx = 1;
                                else if (dist === dT) ny = -1; else if (dist === dB) ny = 1;
                            }
                        }

                        if (dist < limit) {
                            const prog = 1 - (dist / limit);
                            const int = circleMap(prog);
                            data[idx] = Math.max(0, Math.min(255, 127 - (nx * int * 127)));     
                            data[idx+2] = Math.max(0, Math.min(255, 127 - (ny * int * 127))); 
                            data[idx+3] = 255; 
                        } else {
                            data[idx]=127; data[idx+1]=0; data[idx+2]=127; data[idx+3]=255;
                        }
                    }
                }
                ctx.putImageData(d, 0, 0);
                return canvas;
            }

            function createFinalCanvas(source) {
                const cvs = document.createElement('canvas');
                cvs.width = width; cvs.height = height;
                const ctx = cvs.getContext('2d');
                ctx.fillStyle = "rgb(127, 0, 127)"; ctx.fillRect(0, 0, width, height);
                const ox = (maxDim - width) / 2;
                const oy = (maxDim - height) / 2;
                ctx.drawImage(source, -Math.round(ox), -Math.round(oy));

                const inset = bevVal;
                const comp = getComputedStyle(element);
                let br = parseFloat(comp.borderRadius) || 0;
                if (comp.borderRadius.includes('%')) br = (parseFloat(comp.borderRadius)/100) * Math.min(width, height);

                if (width > inset * 2 && height > inset * 2) {
                    ctx.fillStyle = "rgb(127, 0, 127)";
                    if (bevVal > 2) ctx.filter = `blur(${bevVal/3}px)`;
                    drawRoundedPath(ctx, inset, inset, width - inset*2, height - inset*2, Math.max(0, br - inset/2));
                    ctx.fill();
                }
                return cvs.toDataURL();
            }

            const map = createMap();
            const url = createFinalCanvas(map);
            const scale = refVal * 2;

            if (chrVal === 0) {
                return `<feImage result="MAP" href="${url}" color-interpolation-filters="sRGB"/>
                        <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${scale}" xChannelSelector="R" yChannelSelector="B"/>`;
            } else {
                const rS = scale + (chrVal * 2), bS = Math.max(0, scale - (chrVal * 2));
                return `<feImage result="MAP" href="${url}" color-interpolation-filters="sRGB"/>
                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${rS}" xChannelSelector="R" yChannelSelector="B" result="RD"/>
                    <feComponentTransfer in="RD" result="RL"><feFuncR type="identity"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>
                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${scale}" xChannelSelector="R" yChannelSelector="B" result="GD"/>
                    <feComponentTransfer in="GD" result="GL"><feFuncR type="discrete" tableValues="0"/><feFuncG type="identity"/><feFuncB type="discrete" tableValues="0"/><feFuncA type="identity"/></feComponentTransfer>
                    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${bS}" xChannelSelector="R" yChannelSelector="B" result="BD"/>
                    <feComponentTransfer in="BD" result="BL"><feFuncR type="discrete" tableValues="0"/><feFuncG type="discrete" tableValues="0"/><feFuncB type="identity"/><feFuncA type="identity"/></feComponentTransfer>
                    <feComposite in="RL" in2="GL" operator="arithmetic" k2="1" k3="1" result="RG"/><feComposite in="RG" in2="BL" operator="arithmetic" k2="1" k3="1"/>`;
            }
        });
    }
}