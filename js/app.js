'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
    layout: 2,
    videos: {}   // panelId (number) → original url string
};

function persist() {
    try { localStorage.setItem('rv_state', JSON.stringify(state)); } catch (_) {}
}

function restoreState() {
    try {
        const raw = localStorage.getItem('rv_state');
        if (!raw) return;
        const s = JSON.parse(raw);
        if ([2, 3, 4].includes(s.layout)) state.layout = s.layout;
        if (s.videos && typeof s.videos === 'object') state.videos = s.videos;
    } catch (_) {}
}

// ── URL Parsers ────────────────────────────────────────────────────────────

function parseYouTube(url) {
    try {
        const u = new URL(url);
        let id = null;

        if (u.hostname === 'youtu.be') {
            id = u.pathname.slice(1).split('?')[0];
        } else if (u.hostname.includes('youtube.com')) {
            const seg = u.pathname.split('/').filter(Boolean);
            if (seg[0] === 'watch')         id = u.searchParams.get('v');
            else if (seg[0] === 'live')     id = seg[1];
            else if (seg[0] === 'embed')    id = seg[1];
            else if (seg[0] === 'shorts')   id = seg[1];
        }

        if (id && /^[\w-]{11}$/.test(id)) {
            return `https://www.youtube.com/embed/${id}?rel=0`;
        }
    } catch (_) {}
    return null;
}

function parseVK(url) {
    try {
        const u = new URL(url);
        if (!u.hostname.includes('vk.com') && !u.hostname.includes('vk.ru')) return null;

        let raw = null;

        // /video-123456_789 or /video123456_789
        const pathMatch = u.pathname.match(/\/video(-?\d+)_(\d+)/);
        if (pathMatch) { raw = [pathMatch[1], pathMatch[2]]; }

        // ?z=video-123456_789
        if (!raw) {
            const z = u.searchParams.get('z') || '';
            const zMatch = z.match(/video(-?\d+)_(\d+)/);
            if (zMatch) raw = [zMatch[1], zMatch[2]];
        }

        if (raw) {
            return `https://vk.com/video_ext.php?oid=${raw[0]}&id=${raw[1]}&hd=2`;
        }
    } catch (_) {}
    return null;
}

function toEmbedUrl(url) {
    return parseYouTube(url) || parseVK(url) || null;
}

// ── Panel factory ──────────────────────────────────────────────────────────

function makePanel(id) {
    const el = document.createElement('div');
    el.className = 'panel';
    el.dataset.id = id;

    if (state.videos[id]) {
        renderVideo(el, id, state.videos[id]);
    } else {
        renderPlaceholder(el, id);
    }
    return el;
}

function renderPlaceholder(el, id) {
    el.innerHTML = `
        <div class="panel-placeholder">
            <span class="panel-label">Экран ${id}</span>
            <div class="url-row">
                <input class="url-input" type="text"
                    placeholder="Вставьте ссылку YouTube или VK Video"
                    autocomplete="off" spellcheck="false">
                <button class="load-btn">Загрузить</button>
            </div>
            <span class="url-hint">youtube.com · youtu.be · vk.com/video</span>
        </div>`;

    const input = el.querySelector('.url-input');
    const btn   = el.querySelector('.load-btn');

    function tryLoad() {
        const url = input.value.trim();
        if (!url) return;
        const embed = toEmbedUrl(url);
        if (!embed) {
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 1400);
            return;
        }
        state.videos[id] = url;
        persist();
        renderVideo(el, id, url);
        updateViewerClass();
    }

    btn.addEventListener('click', tryLoad);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLoad(); });
    input.addEventListener('paste', () => setTimeout(() => {
        if (toEmbedUrl(input.value.trim())) tryLoad();
    }, 40));
}

function renderVideo(el, id, url) {
    const embed = toEmbedUrl(url);
    el.innerHTML = `
        <iframe class="panel-video" src="${embed}"
            allow="autoplay; fullscreen; picture-in-picture"
            allowfullscreen
            referrerpolicy="no-referrer-when-downgrade">
        </iframe>
        <div class="panel-overlay">
            <button class="overlay-btn" data-action="clear">Изменить</button>
        </div>`;

    el.querySelector('[data-action="clear"]').addEventListener('click', () => {
        delete state.videos[id];
        persist();
        renderPlaceholder(el, id);
        updateViewerClass();
    });

    updateViewerClass();
}

// ── Dimming & proximity ────────────────────────────────────────────────────

function updateViewerClass() {
    const hasVideo = Object.keys(state.videos).length > 0;
    document.getElementById('viewer').classList.toggle('has-video', hasVideo);
    if (!hasVideo) {
        document.querySelectorAll('.panel-placeholder').forEach(ph => {
            ph.style.opacity = '';
            ph.classList.remove('lit');
        });
    }
}

const PROXIMITY_RADIUS = 140;
const DIM_OPACITY      = 0.07;
const BRIGHT_OPACITY   = 1.0;

let mouseX = -9999, mouseY = -9999, rafId = null;

function applyProximity() {
    rafId = null;
    const viewer = document.getElementById('viewer');
    if (!viewer.classList.contains('has-video')) return;

    viewer.querySelectorAll('.panel-placeholder').forEach(ph => {
        const rect = ph.getBoundingClientRect();
        const dx   = Math.max(rect.left - mouseX, 0, mouseX - rect.right);
        const dy   = Math.max(rect.top  - mouseY, 0, mouseY - rect.bottom);
        const dist = Math.sqrt(dx * dx + dy * dy);

        const t   = Math.max(0, 1 - dist / PROXIMITY_RADIUS);
        const opacity = DIM_OPACITY + (BRIGHT_OPACITY - DIM_OPACITY) * t;

        ph.style.opacity = opacity;
        ph.classList.toggle('lit', t > 0.05);
    });
}

function scheduleProximity() {
    if (!rafId) rafId = requestAnimationFrame(applyProximity);
}

// ── Resizer ────────────────────────────────────────────────────────────────

function makeResizer(cls) {
    const el = document.createElement('div');
    el.className = `resizer ${cls}`;
    return el;
}

function attachResizer(resizerEl, prevEl, nextEl, logicalDir) {
    let origin, prevStart, nextStart;

    function isMobileLayout() {
        return window.innerWidth <= 700;
    }

    function actualDir() {
        return (logicalDir === 'h-res' && isMobileLayout()) ? 'v-res' : logicalDir;
    }

    function clientPos(e) {
        const src = e.touches ? e.touches[0] : e;
        return actualDir() === 'h-res' ? src.clientX : src.clientY;
    }

    function elSize(el) {
        return actualDir() === 'h-res' ? el.offsetWidth : el.offsetHeight;
    }

    function onStart(e) {
        e.preventDefault();
        origin    = clientPos(e);
        prevStart = elSize(prevEl);
        nextStart = elSize(nextEl);

        resizerEl.classList.add('dragging');
        document.body.style.cursor     = actualDir() === 'h-res' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';

        // Prevent iframes from swallowing mouse events
        document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend',  onEnd);
    }

    function onMove(e) {
        if (e.cancelable) e.preventDefault();
        const delta  = clientPos(e) - origin;
        const total  = prevStart + nextStart;
        const minPx  = 120;
        const newPrev = Math.max(minPx, Math.min(total - minPx, prevStart + delta));
        const newNext = total - newPrev;

        prevEl.style.flex = `0 0 ${newPrev}px`;
        nextEl.style.flex = `0 0 ${newNext}px`;
    }

    function onEnd() {
        resizerEl.classList.remove('dragging');
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');

        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onEnd);
    }

    resizerEl.addEventListener('mousedown',  onStart);
    resizerEl.addEventListener('touchstart', onStart, { passive: false });
}

// ── Layout builders ────────────────────────────────────────────────────────

function buildLayout(n) {
    const viewer = document.getElementById('viewer');
    viewer.innerHTML = '';

    if (n === 2) {
        const p1 = makePanel(1), r = makeResizer('h-res'), p2 = makePanel(2);
        viewer.append(p1, r, p2);
        attachResizer(r, p1, p2, 'h-res');
    }

    else if (n === 3) {
        // Left panel | right column (top + bottom)
        const p1  = makePanel(1);
        const rH  = makeResizer('h-res');
        const col = document.createElement('div');
        col.className = 'panel-col';
        const p2 = makePanel(2), rV = makeResizer('v-res'), p3 = makePanel(3);
        col.append(p2, rV, p3);

        viewer.append(p1, rH, col);
        attachResizer(rH, p1, col, 'h-res');
        attachResizer(rV, p2, p3, 'v-res');
    }

    else if (n === 4) {
        // Two columns, each with two stacked panels
        const col1 = document.createElement('div');
        col1.className = 'panel-col';
        const p1 = makePanel(1), rV1 = makeResizer('v-res'), p3 = makePanel(3);
        col1.append(p1, rV1, p3);

        const rH = makeResizer('h-res');

        const col2 = document.createElement('div');
        col2.className = 'panel-col';
        const p2 = makePanel(2), rV2 = makeResizer('v-res'), p4 = makePanel(4);
        col2.append(p2, rV2, p4);

        viewer.append(col1, rH, col2);
        attachResizer(rH,  col1, col2, 'h-res');
        attachResizer(rV1, p1,   p3,   'v-res');
        attachResizer(rV2, p2,   p4,   'v-res');
    }
}

// ── UI controls ───────────────────────────────────────────────────────────

function setLayout(n) {
    state.layout = n;
    persist();
    document.querySelectorAll('.layout-btn').forEach(b => {
        b.classList.toggle('active', +b.dataset.layout === n);
    });
    buildLayout(n);
}

let headerVisible = true;
function toggleHeader() {
    headerVisible = !headerVisible;
    document.getElementById('header').style.display = headerVisible ? '' : 'none';
}

// ── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    restoreState();

    document.querySelectorAll('.layout-btn').forEach(b => {
        b.classList.toggle('active', +b.dataset.layout === state.layout);
        b.addEventListener('click', () => setLayout(+b.dataset.layout));
    });

    document.getElementById('hide-btn').addEventListener('click', toggleHeader);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !headerVisible) toggleHeader();
        if (e.ctrlKey && e.key === 'h') { e.preventDefault(); toggleHeader(); }
    });

    document.addEventListener('mousemove', e => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        scheduleProximity();
    });

    document.addEventListener('mouseleave', () => {
        mouseX = -9999;
        mouseY = -9999;
        scheduleProximity();
    });

    buildLayout(state.layout);
    updateViewerClass();
});
