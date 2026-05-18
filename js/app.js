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
        const host = u.hostname;
        if (!host.includes('vk.com') && !host.includes('vk.ru') && !host.includes('vkvideo.ru')) return null;

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

function parseRutube(url) {
    try {
        const u = new URL(url);
        if (!u.hostname.includes('rutube.ru')) return null;
        const match = u.pathname.match(/\/video\/([a-f0-9]{32})/);
        if (match) return `https://rutube.ru/play/embed/${match[1]}`;
    } catch (_) {}
    return null;
}

function toEmbedUrl(url) {
    return parseYouTube(url) || parseVK(url) || parseRutube(url) || null;
}

// ── Suggestions ────────────────────────────────────────────────────────────

const CF_WORKER      = 'https://gentle-fire-7fad.hi-itsleha.workers.dev';
const RUTUBE_CHANNEL = '35504962';

let _suggData    = null;
let _suggFetched = false;

async function fetchSuggestions() {
    if (_suggFetched) return _suggData;
    _suggFetched = true;
    try {
        const r = await fetch(`${CF_WORKER}/rutube/video/person/${RUTUBE_CHANNEL}/?ordering=-created_at&page_size=8`);
        if (!r.ok) throw new Error(r.status);
        const json = await r.json();
        _suggData = json.results ?? null;
    } catch (_) { _suggData = null; }
    return _suggData;
}

function formatDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
        : `${m}:${String(s).padStart(2,'0')}`;
}

function rutubeVideoUrl(v) {
    if (v.video_url) return v.video_url;
    if (typeof v.id === 'string' && /^[a-f0-9]{32}$/.test(v.id))
        return `https://rutube.ru/video/${v.id}/`;
    return null;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderSuggestions(el, id) {
    el.innerHTML = `
        <div class="panel-placeholder panel-suggestions">
            <div class="sugg-topbar">
                <button class="sugg-back">←</button>
                <span class="panel-label">Предложения</span>
            </div>
            <div class="sugg-grid">
                <div class="sugg-msg">Загрузка…</div>
            </div>
        </div>`;

    el.querySelector('.sugg-back').addEventListener('click', () => renderPlaceholder(el, id));
    const grid = el.querySelector('.sugg-grid');

    fetchSuggestions().then(videos => {
        if (!videos?.length) {
            grid.innerHTML = '<div class="sugg-msg">Видео недоступны</div>';
            return;
        }

        const sorted = [...videos].sort((a, b) => (b.is_on_air ? 1 : 0) - (a.is_on_air ? 1 : 0));

        grid.innerHTML = sorted.map(v => {
            const videoUrl = rutubeVideoUrl(v);
            if (!videoUrl) return '';
            const isLive = !!v.is_on_air;
            const dur    = isLive ? '' : formatDuration(v.duration);
            return `
            <div class="sugg-card" data-url="${escHtml(videoUrl)}">
                <div class="sugg-thumb">
                    <img src="${escHtml(v.thumbnail_url || '')}" alt="" loading="lazy">
                    ${isLive ? '<span class="sugg-live-badge">LIVE</span>' : ''}
                </div>
                <div class="sugg-info">
                    <span class="sugg-card-title">${escHtml(v.title || 'Без названия')}</span>
                    ${dur ? `<span class="sugg-duration">${dur}</span>` : ''}
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('.sugg-card').forEach(card => {
            card.addEventListener('click', () => {
                const url = card.dataset.url;
                if (!toEmbedUrl(url)) return;
                state.videos[id] = url;
                persist();
                renderVideo(el, id, url);
                updateViewerClass();
            });
        });
    });
}

// ── Panel factory ──────────────────────────────────────────────────────────

const TELEMETRY_MARKER = '__telemetry__';
const RACEPULSE_URL    = 'https://its-leha.github.io/RacePulse';

function makePanel(id) {
    const el = document.createElement('div');
    el.className = 'panel';
    el.dataset.id = id;

    if (state.videos[id] === TELEMETRY_MARKER) {
        renderTelemetry(el, id);
    } else if (state.videos[id]) {
        renderVideo(el, id, state.videos[id]);
    } else {
        renderPlaceholder(el, id);
    }
    return el;
}

function renderTelemetry(el, id) {
    el.innerHTML = `
        <iframe class="panel-video" src="${RACEPULSE_URL}"
            allow="autoplay; fullscreen"
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
            <span class="url-hint">youtube.com · youtu.be · vk.com/video · rutube.ru</span>
            <span class="or-sep">или</span>
            <div class="alt-btns">
                <button class="telemetry-btn">
                    <img src="src/icon/RacePulse.svg" alt="">
                    RacePulse телеметрия
                </button>
                <button class="suggest-btn">
                    <img src="src/icon/star1.svg" alt="">
                    Предложить гонку
                </button>
            </div>
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

    el.querySelector('.telemetry-btn').addEventListener('click', () => {
        state.videos[id] = TELEMETRY_MARKER;
        persist();
        renderTelemetry(el, id);
    });

    el.querySelector('.suggest-btn').addEventListener('click', () => {
        renderSuggestions(el, id);
    });
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

// ── Dimming ────────────────────────────────────────────────────────────────

function updateViewerClass() {
    const hasVideo = Object.keys(state.videos).length > 0;
    document.getElementById('viewer').classList.toggle('has-video', hasVideo);
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

// ── Calendar ───────────────────────────────────────────────────────────────

const COUNTRY_ISO = {
    'Bahrain': 'bh', 'Saudi Arabia': 'sa', 'Australia': 'au',
    'Japan': 'jp', 'China': 'cn', 'USA': 'us', 'United States': 'us',
    'Italy': 'it', 'Monaco': 'mc', 'Canada': 'ca', 'Spain': 'es',
    'Austria': 'at', 'UK': 'gb', 'United Kingdom': 'gb', 'Great Britain': 'gb',
    'Hungary': 'hu', 'Belgium': 'be', 'Netherlands': 'nl', 'Azerbaijan': 'az',
    'Singapore': 'sg', 'Mexico': 'mx', 'Brazil': 'br', 'Qatar': 'qa',
    'UAE': 'ae', 'United Arab Emirates': 'ae', 'Portugal': 'pt',
    'France': 'fr', 'Germany': 'de', 'Russia': 'ru', 'Turkey': 'tr',
    'Vietnam': 'vn', 'Indonesia': 'id', 'South Africa': 'za',
};

function countryFlag(country) {
    const iso = COUNTRY_ISO[country];
    if (!iso) return '';
    return `<img class="cal-flag-img" src="https://flagcdn.com/20x15/${iso}.png" alt="${escHtml(country)}">`;
}

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';

let _calData = null;
let _calFetched = false;

async function fetchCalendar() {
    if (_calFetched) return _calData;
    _calFetched = true;
    try {
        const year = new Date().getFullYear();
        const r = await fetch(`${JOLPICA}/${year}.json?limit=100`);
        if (!r.ok) throw new Error(r.status);
        const json = await r.json();
        _calData = json.MRData?.RaceTable?.Races ?? null;
    } catch (_) { _calData = null; }
    return _calData;
}

function calSessionDateTime(dateStr, timeStr) {
    if (!dateStr) return null;
    return new Date(dateStr + 'T' + (timeStr || '00:00:00Z'));
}

function buildCalSessions(race) {
    const rows = [];
    function add(label, dateStr, timeStr) {
        const d = calSessionDateTime(dateStr, timeStr);
        if (!d || isNaN(d)) return;
        rows.push({ label, d });
    }
    add('Свободная практика 1',  race.FirstPractice?.date,      race.FirstPractice?.time);
    add('Свободная практика 2',  race.SecondPractice?.date,     race.SecondPractice?.time);
    add('Свободная практика 3',  race.ThirdPractice?.date,      race.ThirdPractice?.time);
    add('Квалификация спринта',  race.SprintQualifying?.date,   race.SprintQualifying?.time);
    add('Спринт',                race.Sprint?.date,             race.Sprint?.time);
    add('Квалификация',          race.Qualifying?.date,         race.Qualifying?.time);
    add('Гонка',                 race.date,                     race.time);
    rows.sort((a, b) => a.d - b.d);
    return rows.map(({ label, d }) => ({
        label,
        date: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }),
        time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow', hour12: false })
    }));
}

function renderCalendar(races) {
    const grid = document.getElementById('cal-grid');
    if (!races?.length) {
        grid.innerHTML = '<div style="padding:16px 20px;color:#404040;font-size:12px;">Расписание недоступно</div>';
        return;
    }
    const now = new Date();
    let nextIndex = -1;

    const html = races.map((race, i) => {
        const raceDate = calSessionDateTime(race.date, race.time);
        const isPast = raceDate && raceDate < now;
        if (!isPast && nextIndex === -1) nextIndex = i;

        const sessions = buildCalSessions(race);
        const flag = countryFlag(race.Circuit.Location.country);
        return `
        <div class="cal-round${isPast ? ' cal-past' : ''}${i === nextIndex ? ' cal-next' : ''}">
            <div class="cal-round-header">
                <div>
                    <div class="cal-location">${flag}${escHtml(race.Circuit.Location.locality)}</div>
                    <div class="cal-name">${race.raceName}</div>
                </div>
                <span class="cal-round-num">R${race.round}</span>
            </div>
            <div class="cal-sessions">
                ${sessions.map(s => `
                <div class="cal-session">
                    <span class="cal-sess-name">${s.label}</span>
                    <span class="cal-sess-dt"><span class="cal-sess-date">${s.date}</span><span class="cal-sess-time">${s.time}</span></span>
                </div>`).join('')}
            </div>
        </div>`;
    }).join('');

    grid.innerHTML = html;

    if (nextIndex >= 0) {
        const nextEl = grid.querySelector('.cal-next');
        if (nextEl) setTimeout(() => nextEl.scrollIntoView({ block: 'start', behavior: 'instant' }), 0);
    }
}

// ── Sidebar (calendar + about) ────────────────────────────────────────────

function initCalHeader() {
    const calBtn   = document.getElementById('cal-btn');
    const aboutBtn = document.getElementById('about-btn');
    const panel    = document.getElementById('dock');
    const panelRes = document.getElementById('dock-resizer');
    const calSec   = document.getElementById('cal-section');
    const aboutSec = document.getElementById('about-section');
    let calLoaded  = false;
    let activeSection = null;

    function openSection(name) {
        const same = activeSection === name;
        activeSection = same ? null : name;

        const open = !!activeSection;
        panel.classList.toggle('active', open);
        panelRes.classList.toggle('active', open);

        calSec.classList.toggle('active', activeSection === 'cal');
        aboutSec.classList.toggle('active', activeSection === 'about');
        calBtn.classList.toggle('active', activeSection === 'cal');
        aboutBtn.classList.toggle('active', activeSection === 'about');
    }

    document.querySelectorAll('.sidebar-close').forEach(btn => {
        btn.addEventListener('click', () => openSection(activeSection));
    });

    calBtn.addEventListener('click', async () => {
        openSection('cal');
        if (activeSection === 'cal' && !calLoaded) {
            document.getElementById('cal-grid').innerHTML =
                '<div style="padding:16px 12px;color:#404040;font-size:12px;">Загрузка...</div>';
            const races = await fetchCalendar();
            renderCalendar(races);
            calLoaded = true;
        }
    });

    aboutBtn.addEventListener('click', () => openSection('about'));

    // Resizer — drag left edge to resize panel width
    let startX, startW;
    panelRes.addEventListener('mousedown', e => {
        startX = e.clientX;
        startW = panel.offsetWidth;
        panelRes.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

        function onMove(e) {
            const delta = startX - e.clientX;
            panel.style.width = Math.max(220, Math.min(700, startW + delta)) + 'px';
        }
        function onEnd() {
            panelRes.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    });
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

    buildLayout(window.innerWidth <= 700 ? Math.min(state.layout, 2) : state.layout);
    updateViewerClass();
    initCalHeader();
});
