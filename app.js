(function () {
    'use strict';

    const API_BASE = 'https://api.fleetyards.net/v1';
    const SHIPS_PER_PAGE = 240;

    let allShips = [];
    let filteredShips = [];
    let fleet = [];
    let users = [];
    let holoScene = null;
    let holoRenderer = null;
    let holoCamera = null;
    let holoControls = null;
    let holoAnimationId = null;
    let holoDracoLoader = null;

    // ── Persistence ──

    function saveFleet() {
        localStorage.setItem('sc-fleet', JSON.stringify(fleet));
        updateStats();
    }

    function loadFleet() {
        try {
            fleet = JSON.parse(localStorage.getItem('sc-fleet')) || [];
        } catch { fleet = []; }
    }

    function saveUsers() {
        localStorage.setItem('sc-users', JSON.stringify(users));
        updateStats();
    }

    function loadUsers() {
        try {
            users = JSON.parse(localStorage.getItem('sc-users')) || [];
        } catch { users = []; }
    }

    // ── Toast ──

    function toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => { el.remove(); }, 3000);
    }

    // ── Stats ──

    function updateStats() {
        document.getElementById('stat-fleet').textContent = fleet.length;
        document.getElementById('stat-crew').textContent = users.length;
        document.getElementById('fleet-badge').textContent = fleet.length;

        let totalValue = 0;
        for (const f of fleet) {
            if (f.pledgePrice) totalValue += f.pledgePrice;
        }
        if (totalValue >= 1000) {
            document.getElementById('stat-value').textContent = '$' + (totalValue / 1000).toFixed(1) + 'k';
        } else {
            document.getElementById('stat-value').textContent = '$' + totalValue.toFixed(0);
        }
    }

    // ── Fetch Ships ──

    async function fetchShips() {
        const container = document.getElementById('ships-container');
        try {
            const cached = sessionStorage.getItem('sc-ships-cache');
            if (cached) {
                allShips = JSON.parse(cached);
            } else {
                const res = await fetch(`${API_BASE}/models?perPage=${SHIPS_PER_PAGE}`);
                if (!res.ok) throw new Error(`API returned ${res.status}`);
                const data = await res.json();

                const pagination = data.meta?.pagination || {};
                const totalPages = pagination.totalPages || 1;

                allShips = data.items || [];

                if (totalPages > 1) {
                    const fetches = [];
                    for (let page = 2; page <= totalPages; page++) {
                        fetches.push(
                            fetch(`${API_BASE}/models?perPage=${SHIPS_PER_PAGE}&page=${page}`)
                                .then(r => r.json())
                                .then(d => d.items || [])
                        );
                    }
                    const pages = await Promise.all(fetches);
                    for (const page of pages) {
                        allShips = allShips.concat(page);
                    }
                }

                sessionStorage.setItem('sc-ships-cache', JSON.stringify(allShips));
            }

            allShips.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            document.getElementById('stat-ships').textContent = allShips.length;
            populateFilters();
            filteredShips = allShips;
            renderShips();
        } catch (err) {
            container.innerHTML = `
                <div class="no-results">
                    <p>Failed to load ship database</p>
                    <p style="font-size:0.85rem; color:var(--text-muted)">${err.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()" style="margin-top:1rem">Retry</button>
                </div>`;
        }
    }

    // ── Filters ──

    function populateFilters() {
        const manufacturers = new Set();
        const sizes = new Set();
        const classifications = new Set();

        for (const ship of allShips) {
            if (ship.manufacturer && ship.manufacturer.name) manufacturers.add(ship.manufacturer.name);
            if (ship.metrics && ship.metrics.size) sizes.add(ship.metrics.size);
            if (ship.classificationLabel) classifications.add(ship.classificationLabel);
        }

        const mfrSelect = document.getElementById('filter-manufacturer');
        [...manufacturers].sort().forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            mfrSelect.appendChild(opt);
        });

        const sizeSelect = document.getElementById('filter-size');
        const sizeOrder = ['vehicle', 'snub', 'small', 'medium', 'large', 'capital'];
        [...sizes].sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b)).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
            sizeSelect.appendChild(opt);
        });

        const classSelect = document.getElementById('filter-classification');
        [...classifications].sort().forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            classSelect.appendChild(opt);
        });
    }

    function applyFilters() {
        const search = document.getElementById('ship-search').value.toLowerCase().trim();
        const mfr = document.getElementById('filter-manufacturer').value;
        const size = document.getElementById('filter-size').value;
        const classification = document.getElementById('filter-classification').value;
        const status = document.getElementById('filter-status').value;

        filteredShips = allShips.filter(ship => {
            if (search) {
                const haystack = [
                    ship.name,
                    ship.manufacturer?.name,
                    ship.focus,
                    ship.classificationLabel,
                    ship.description
                ].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            if (mfr && ship.manufacturer?.name !== mfr) return false;
            if (size && ship.metrics?.size !== size) return false;
            if (classification && ship.classificationLabel !== classification) return false;
            if (status === 'flight-ready' && ship.productionStatus !== 'flight-ready') return false;
            if (status === 'not-ready' && ship.productionStatus === 'flight-ready') return false;
            return true;
        });

        renderShips();
    }

    // ── Render Ships ──

    function getShipImage(ship, size) {
        size = size || 'smallUrl';
        const media = ship.media || {};
        const sources = ['storeImage', 'angledView', 'angledViewColored', 'frontView', 'sideView', 'topView'];
        for (const src of sources) {
            const entry = media[src];
            if (entry && typeof entry === 'object' && entry[size]) return entry[size];
        }
        if (media.fleetchartImage) return media.fleetchartImage;
        return null;
    }

    function getTopViewImage(ship, size) {
        size = size || 'smallUrl';
        const media = ship.media || {};
        if (media.topView && typeof media.topView === 'object' && media.topView[size]) return media.topView[size];
        if (media.fleetchartImage) return media.fleetchartImage;
        return getShipImage(ship, size);
    }

    function getHoloUrl(ship) {
        const holo = ship.media?.holo;
        if (!holo) return null;
        if (typeof holo === 'string') return holo;
        if (typeof holo === 'object' && holo.url) return holo.url;
        return null;
    }

    function renderShips() {
        const container = document.getElementById('ships-container');

        if (filteredShips.length === 0) {
            container.innerHTML = `<div class="no-results"><p>No ships match your filters</p></div>`;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'ship-grid';

        for (const ship of filteredShips) {
            const card = document.createElement('div');
            card.className = 'ship-card';

            const imgUrl = getShipImage(ship, 'smallUrl');
            const isFlightReady = ship.productionStatus === 'flight-ready';
            const mfrName = ship.manufacturer?.name || 'Unknown';
            const sizeName = ship.metrics?.size || '';
            const crewMin = ship.crew?.min || '?';
            const crewMax = ship.crew?.max || '?';
            const price = ship.pledgePrice ? '$' + ship.pledgePrice : '';
            const hasHolo = !!getHoloUrl(ship);

            card.innerHTML = `
                ${imgUrl
                    ? `<img class="ship-card-image" src="${imgUrl}" alt="${ship.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="ship-card-image-placeholder" style="display:none">&#128640;</div>`
                    : `<div class="ship-card-image-placeholder">&#128640;</div>`}
                <div class="ship-card-body">
                    <div class="ship-card-name" title="${ship.name}">${ship.name}</div>
                    <div class="ship-card-manufacturer">${mfrName}</div>
                    <div class="ship-card-tags">
                        ${sizeName ? `<span class="tag tag-size">${sizeName}</span>` : ''}
                        ${ship.focus ? `<span class="tag tag-focus">${ship.focus}</span>` : ''}
                        <span class="tag tag-status ${isFlightReady ? '' : 'not-ready'}">${isFlightReady ? 'Flight Ready' : ship.productionStatus || 'In Development'}</span>
                    </div>
                    <div class="ship-card-stats">
                        <span>&#128101; ${crewMin}-${crewMax}</span>
                        ${ship.metrics?.cargo ? `<span>&#128230; ${ship.metrics.cargo}SCU</span>` : ''}
                        ${price ? `<span class="ship-card-price">${price}</span>` : ''}
                    </div>
                    <div class="ship-card-actions">
                        <button class="btn btn-primary btn-sm add-to-fleet-btn" data-slug="${ship.slug}">+ Add to Fleet</button>
                        ${hasHolo ? `<button class="btn btn-secondary btn-sm view-holo-btn" data-slug="${ship.slug}">3D View</button>` : ''}
                    </div>
                </div>`;

            grid.appendChild(card);
        }

        container.innerHTML = '';
        container.appendChild(grid);
    }

    // ── Fleet ──

    function addToFleet(slug) {
        const ship = allShips.find(s => s.slug === slug);
        if (!ship) return;

        fleet.push({
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
            slug: ship.slug,
            name: ship.name,
            manufacturer: ship.manufacturer?.name || 'Unknown',
            size: ship.metrics?.size || '',
            length: ship.metrics?.length || 0,
            beam: ship.metrics?.beam || 0,
            focus: ship.focus || '',
            pledgePrice: ship.pledgePrice || 0,
            crew: ship.crew || {},
            image: getShipImage(ship, 'smallUrl'),
            imageMed: getShipImage(ship, 'mediumUrl'),
            topView: getTopViewImage(ship, 'mediumUrl'),
            holo: getHoloUrl(ship),
            assignedCrew: []
        });

        saveFleet();
        renderFleet();
        toast(`${ship.name} added to fleet`, 'success');
    }

    function removeFromFleet(id) {
        const idx = fleet.findIndex(f => f.id === id);
        if (idx === -1) return;
        const name = fleet[idx].name;
        fleet.splice(idx, 1);
        saveFleet();
        renderFleet();
        renderUsersTab();
        toast(`${name} removed from fleet`, 'info');
    }

    function renderFleet() {
        const container = document.getElementById('fleet-container');
        const search = document.getElementById('fleet-search').value.toLowerCase().trim();

        let displayFleet = fleet;
        if (search) {
            displayFleet = fleet.filter(f => {
                const haystack = [f.name, f.manufacturer, f.focus].join(' ').toLowerCase();
                return haystack.includes(search);
            });
        }

        if (displayFleet.length === 0) {
            container.innerHTML = fleet.length === 0
                ? `<div class="fleet-empty"><p>Your fleet is empty</p><p class="hint">Go to Ships Database and add ships to your fleet</p></div>`
                : `<div class="no-results"><p>No fleet ships match your search</p></div>`;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'fleet-grid';

        for (const item of displayFleet) {
            const card = document.createElement('div');
            card.className = 'fleet-card';

            const crewOptions = users
                .filter(u => !item.assignedCrew.includes(u.name))
                .map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`)
                .join('');

            card.innerHTML = `
                <div class="fleet-card-header">
                    <div class="fleet-card-image-wrap" ${item.holo ? `onclick="openHoloViewer('${item.slug}')" title="Click for 3D view"` : ''}>
                        ${item.image
                            ? `<img src="${item.image}" alt="${item.name}">`
                            : `<div class="ship-card-image-placeholder" style="height:100%">&#128640;</div>`}
                        ${item.holo ? '<span class="holo-badge">3D</span>' : ''}
                    </div>
                    <div class="fleet-card-info">
                        <div>
                            <div class="fleet-card-name">${escapeHtml(item.name)}</div>
                            <div class="fleet-card-mfr">${escapeHtml(item.manufacturer)}</div>
                            <div class="fleet-card-meta">
                                ${item.size ? `<span class="tag tag-size">${item.size}</span>` : ''}
                                ${item.focus ? `<span class="tag tag-focus">${item.focus}</span>` : ''}
                                ${item.pledgePrice ? `<span class="ship-card-price">$${item.pledgePrice}</span>` : ''}
                            </div>
                        </div>
                        <div class="fleet-card-actions-row">
                            ${item.holo ? `<button class="btn btn-secondary btn-sm" onclick="openHoloViewer('${item.slug}')">&#127760; Holo</button>` : ''}
                            <button class="btn btn-danger btn-sm" onclick="removeFromFleet('${item.id}')">Remove</button>
                        </div>
                    </div>
                </div>
                <div class="fleet-card-body">
                    <div class="crew-section">
                        <div class="crew-section-label">
                            <span>Assigned Crew (${item.assignedCrew.length}/${item.crew.max || '?'})</span>
                        </div>
                        <div class="crew-list">
                            ${item.assignedCrew.length > 0
                                ? item.assignedCrew.map(c => `
                                    <span class="crew-chip">
                                        ${escapeHtml(c)}
                                        <span class="remove-crew" onclick="unassignCrew('${item.id}', '${escapeAttr(c)}')">&times;</span>
                                    </span>`).join('')
                                : '<span class="crew-empty">No crew assigned</span>'}
                        </div>
                        ${users.length > 0 ? `
                        <div class="assign-crew-row">
                            <select class="assign-crew-select" data-fleet-id="${item.id}">
                                <option value="">Assign crew...</option>
                                ${crewOptions}
                            </select>
                            <button class="btn btn-primary btn-sm assign-crew-btn" data-fleet-id="${item.id}">Assign</button>
                        </div>` : ''}
                    </div>
                </div>`;

            grid.appendChild(card);
        }

        container.innerHTML = '';
        container.appendChild(grid);
    }

    function assignCrew(fleetId, userName) {
        const item = fleet.find(f => f.id === fleetId);
        if (!item || !userName) return;
        if (item.assignedCrew.includes(userName)) {
            toast(`${userName} is already assigned to ${item.name}`, 'error');
            return;
        }
        item.assignedCrew.push(userName);
        saveFleet();
        renderFleet();
        renderUsersTab();
        toast(`${userName} assigned to ${item.name}`, 'success');
    }

    function unassignCrew(fleetId, userName) {
        const item = fleet.find(f => f.id === fleetId);
        if (!item) return;
        item.assignedCrew = item.assignedCrew.filter(c => c !== userName);
        saveFleet();
        renderFleet();
        renderUsersTab();
        toast(`${userName} unassigned`, 'info');
    }

    // ── Users ──

    function addUser(name) {
        name = name.trim();
        if (!name) return;
        if (users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
            toast('Crew member already exists', 'error');
            return;
        }
        users.push({ name });
        saveUsers();
        renderUsersTab();
        renderFleet();
        toast(`${name} joined the crew`, 'success');
    }

    function removeUser(name) {
        users = users.filter(u => u.name !== name);
        for (const item of fleet) {
            item.assignedCrew = item.assignedCrew.filter(c => c !== name);
        }
        saveUsers();
        saveFleet();
        renderUsersTab();
        renderFleet();
        toast(`${name} removed from crew`, 'info');
    }

    function renderUsersTab() {
        const listEl = document.getElementById('users-list');
        const assignEl = document.getElementById('users-assignments');

        if (users.length === 0) {
            listEl.innerHTML = '<div class="crew-empty" style="padding:1rem">No crew members yet. Add someone above.</div>';
        } else {
            listEl.innerHTML = users.map(u => {
                const shipCount = fleet.filter(f => f.assignedCrew.includes(u.name)).length;
                const initials = u.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
                return `
                    <div class="user-row">
                        <div class="user-row-info">
                            <div class="user-avatar">${initials}</div>
                            <div>
                                <div class="user-row-name">${escapeHtml(u.name)}</div>
                                <div class="user-row-ships">${shipCount} ship${shipCount !== 1 ? 's' : ''} assigned</div>
                            </div>
                        </div>
                        <button class="btn btn-danger btn-sm" onclick="removeUser('${escapeAttr(u.name)}')">Remove</button>
                    </div>`;
            }).join('');
        }

        const userAssignments = users.map(u => {
            const assignedShips = fleet.filter(f => f.assignedCrew.includes(u.name));
            if (assignedShips.length === 0) return null;
            const initials = u.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            return `
                <div class="user-assignment-card">
                    <h3><div class="user-avatar" style="width:28px;height:28px;font-size:0.6rem">${initials}</div> ${escapeHtml(u.name)}</h3>
                    <div class="user-ship-list">
                        ${assignedShips.map(s => `
                            <div class="user-ship-chip">
                                ${s.image ? `<img src="${s.image}" alt="${s.name}">` : ''}
                                <span>${escapeHtml(s.name)}</span>
                            </div>`).join('')}
                    </div>
                </div>`;
        }).filter(Boolean);

        if (userAssignments.length === 0) {
            assignEl.innerHTML = '<div class="crew-empty" style="padding:1rem">No ship assignments yet. Add ships to your fleet and assign crew members.</div>';
        } else {
            assignEl.innerHTML = userAssignments.join('');
        }
    }

    // ── Holo Viewer (Three.js + GLTF) ──

    function openHoloViewer(slug) {
        const ship = allShips.find(s => s.slug === slug) || fleet.find(f => f.slug === slug);
        if (!ship) return;

        const holoUrl = getHoloUrl(ship) || ship.holo;
        const modal = document.getElementById('holo-modal');
        const titleEl = document.getElementById('holo-modal-title');
        const loadingEl = document.getElementById('holo-loading');
        const errorEl = document.getElementById('holo-error');
        const detailsEl = document.getElementById('holo-ship-details');

        titleEl.textContent = (ship.name || 'Unknown') + ' - Holographic View';
        loadingEl.style.display = 'block';
        errorEl.style.display = 'none';
        modal.classList.add('open');

        const mfr = ship.manufacturer?.name || ship.manufacturer || 'Unknown';
        const size = ship.metrics?.size || ship.size || '';
        const crew = ship.crew || {};
        const price = ship.pledgePrice || 0;

        detailsEl.innerHTML = `
            <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.85rem;color:var(--text-secondary)">
                <div><strong style="color:var(--accent)">Manufacturer:</strong> ${escapeHtml(String(mfr))}</div>
                <div><strong style="color:var(--accent)">Size:</strong> ${size || 'N/A'}</div>
                <div><strong style="color:var(--accent)">Crew:</strong> ${crew.min || '?'} - ${crew.max || '?'}</div>
                ${price ? `<div><strong style="color:var(--accent)">Pledge:</strong> $${price}</div>` : ''}
                ${ship.focus ? `<div><strong style="color:var(--accent)">Focus:</strong> ${escapeHtml(ship.focus)}</div>` : ''}
            </div>`;

        cleanupHolo();

        if (!holoUrl) {
            loadingEl.style.display = 'none';
            errorEl.style.display = 'block';
            return;
        }

        initHoloViewer(holoUrl);
    }

    async function initHoloViewer(url) {
        const container = document.getElementById('holo-viewer');
        const loadingEl = document.getElementById('holo-loading');
        const errorEl = document.getElementById('holo-error');

        const width = container.clientWidth;
        const height = 350;

        holoScene = new THREE.Scene();
        holoScene.background = new THREE.Color(0x050a12);

        holoCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
        holoCamera.position.set(0, 10, 40);

        holoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        holoRenderer.setSize(width, height);
        holoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        holoRenderer.outputEncoding = THREE.sRGBEncoding;
        container.appendChild(holoRenderer.domElement);

        holoControls = new THREE.OrbitControls(holoCamera, holoRenderer.domElement);
        holoControls.enableDamping = true;
        holoControls.dampingFactor = 0.05;
        holoControls.autoRotate = true;
        holoControls.autoRotateSpeed = 1.5;

        const ambientLight = new THREE.AmbientLight(0x404060, 0.8);
        holoScene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0x00d4ff, 1.2);
        dirLight1.position.set(5, 10, 7);
        holoScene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0x7dd3fc, 0.6);
        dirLight2.position.set(-5, -3, -5);
        holoScene.add(dirLight2);

        const pointLight = new THREE.PointLight(0x00d4ff, 0.5, 100);
        pointLight.position.set(0, 20, 0);
        holoScene.add(pointLight);

        const gridHelper = new THREE.GridHelper(80, 40, 0x112244, 0x0a1a33);
        gridHelper.position.y = -0.1;
        holoScene.add(gridHelper);

        function onModelLoaded(gltf) {
            if (!holoScene) return;
            const model = gltf.scene;

            const box = new THREE.Box3().setFromObject(model);
            const bSize = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
            const scale = 20 / maxDim;

            var pivot = new THREE.Group();
            pivot.add(model);
            model.scale.setScalar(scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

            const holoMaterial = new THREE.MeshPhongMaterial({
                color: 0x00aacc,
                emissive: 0x003344,
                specular: 0x00d4ff,
                shininess: 80,
                transparent: true,
                opacity: 0.85,
                wireframe: false,
                side: THREE.DoubleSide
            });

            model.traverse(function (child) {
                if (child.isMesh) {
                    child.material = holoMaterial;
                }
            });

            holoScene.add(pivot);

            var dist = maxDim * scale * 1.5;
            holoCamera.position.set(0, maxDim * scale * 0.4, dist);
            holoControls.target.set(0, 0, 0);
            holoControls.update();

            loadingEl.style.display = 'none';
        }

        function onModelError(error) {
            console.error('GLTF load error:', error);
            loadingEl.style.display = 'none';
            errorEl.style.display = 'block';
            errorEl.querySelector('p').textContent = 'Failed to load holographic model';
            var retryBtn = document.getElementById('holo-retry-btn');
            retryBtn.style.display = 'inline-flex';
            retryBtn.onclick = function () {
                retryBtn.style.display = 'none';
                errorEl.style.display = 'none';
                loadingEl.style.display = 'block';
                delete holoCache[url];
                cleanupHolo();
                initHoloViewer(url);
            };
        }

        function animate() {
            holoAnimationId = requestAnimationFrame(animate);
            if (holoControls) holoControls.update();
            if (holoRenderer && holoScene && holoCamera) {
                holoRenderer.render(holoScene, holoCamera);
            }
        }
        animate();

        if (holoDracoLoader) {
            holoDracoLoader.dispose();
        }
        holoDracoLoader = new THREE.DRACOLoader();
        holoDracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
        holoDracoLoader.setDecoderConfig({ type: 'js' });

        try {
            const arrayBuffer = await fetchHoloModel(url);
            const loader = new THREE.GLTFLoader();
            loader.setDRACOLoader(holoDracoLoader);
            loader.parse(arrayBuffer, '', onModelLoaded, onModelError);
        } catch (fetchErr) {
            console.warn('Fetch GLTF failed:', fetchErr);
            delete holoCache[url];
            onModelError(fetchErr);
        }
    }

    function cleanupHolo() {
        if (holoAnimationId) {
            cancelAnimationFrame(holoAnimationId);
            holoAnimationId = null;
        }
        if (holoRenderer) {
            holoRenderer.dispose();
            const canvas = holoRenderer.domElement;
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
            holoRenderer = null;
        }
        if (holoScene) {
            holoScene.traverse(function (obj) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
            holoScene = null;
        }
        holoCamera = null;
        holoControls = null;
        if (holoDracoLoader) {
            holoDracoLoader.dispose();
            holoDracoLoader = null;
        }
    }

    // ── Fleet View ──

    var holoCache = {};

    async function fetchHoloModel(url) {
        if (holoCache[url]) return holoCache[url];
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 15000);
        try {
            var response = await fetch(url, { mode: 'cors', redirect: 'follow', signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var buf = await response.arrayBuffer();
            holoCache[url] = buf;
            return buf;
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') throw new Error('Timed out loading model');
            throw e;
        }
    }

    let fvZoom = 1;
    let fvScaleMode = false;
    const fvMiniRenderers = [];
    const FV_BASE_SIZE = 140;
    const FV_SCALE_PPM = 2.5;
    const FV_SCALE_MIN = 80;

    function getFleetViewPositions() {
        try {
            return JSON.parse(localStorage.getItem('sc-fv-positions')) || {};
        } catch { return {}; }
    }

    function saveFleetViewPositions(positions) {
        localStorage.setItem('sc-fv-positions', JSON.stringify(positions));
    }

    async function renderFleetView() {
        const canvas = document.getElementById('fv-canvas');
        const emptyEl = document.getElementById('fv-empty');
        const wrapperEl = document.getElementById('fv-wrapper');

        if (allShips.length === 0) {
            await fetchShips();
        }

        cleanupFvRenderers();

        if (fleet.length === 0) {
            canvas.innerHTML = '<div class="fv-grid-bg"></div>';
            emptyEl.style.display = 'block';
            wrapperEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        wrapperEl.style.display = 'block';

        const positions = getFleetViewPositions();
        canvas.innerHTML = '<div class="fv-grid-bg"></div>';

        const CARD_GAP = 20;

        function resolveMetrics(item) {
            var len = item.length || 0;
            var beam = item.beam || 0;
            if ((!len || !beam) && allShips.length > 0) {
                var dbShip = allShips.find(function (s) { return s.slug === item.slug; });
                if (dbShip && dbShip.metrics) {
                    if (!len) len = dbShip.metrics.length || 0;
                    if (!beam) beam = dbShip.metrics.beam || 0;
                }
            }
            if (!beam && len) beam = len * 0.4;
            return { length: len, beam: beam };
        }

        function getScaledDimensions(metrics) {
            if (!fvScaleMode || !metrics.length) return { w: FV_BASE_SIZE, h: FV_BASE_SIZE };
            var s = Math.max(FV_SCALE_MIN, Math.round(metrics.length * FV_SCALE_PPM));
            return { w: s, h: s };
        }

        fleet.forEach(function (item, idx) {
            const el = document.createElement('div');
            el.className = 'fv-ship';
            el.dataset.fleetId = item.id;

            var metrics = resolveMetrics(item);
            var dims = getScaledDimensions(metrics);

            let x, y;
            if (positions[item.id]) {
                x = positions[item.id].x;
                y = positions[item.id].y;
            } else {
                if (!positions._autoX) { positions._autoX = 40; positions._autoY = 40; positions._rowH = 0; }
                var totalW = dims.w + 40;
                var totalH = dims.h + 70;
                if (positions._autoX + totalW > 2900) {
                    positions._autoX = 40;
                    positions._autoY += positions._rowH + 20;
                    positions._rowH = 0;
                }
                x = positions._autoX;
                y = positions._autoY;
                positions._autoX += totalW + 20;
                if (totalH > positions._rowH) positions._rowH = totalH;
            }

            el.style.left = x + 'px';
            el.style.top = y + 'px';

            const crewHtml = item.assignedCrew.length > 0
                ? item.assignedCrew.map(function (c) { return '<span class="fv-crew-tag">' + escapeHtml(c) + '</span>'; }).join('')
                : '<span style="font-size:0.5rem;color:var(--text-muted)">No crew</span>';

            const holoId = 'fv-holo-' + item.id.replace(/[^a-zA-Z0-9]/g, '_');
            var lengthLabel = metrics.length ? metrics.length + 'm' : '';
            var scale = fvScaleMode ? Math.max(dims.w, dims.h) / FV_BASE_SIZE : 1;
            var nameFz = Math.max(0.45, Math.min(1.4, 0.65 * scale));
            var mfrFz = Math.max(0.35, Math.min(1.0, 0.55 * scale));
            var crewFz = Math.max(0.35, Math.min(0.9, 0.55 * scale));
            var pad = Math.max(4, Math.round(6 * scale));

            el.innerHTML =
                '<div class="fv-ship-inner" style="min-width:' + (dims.w + pad * 2) + 'px;padding:' + pad + 'px">' +
                    '<div class="fv-ship-holo" id="' + holoId + '" style="width:' + dims.w + 'px;height:' + dims.h + 'px">' +
                        (item.holo
                            ? '<div class="fv-holo-loading"></div>'
                            : (item.topView || item.image
                                ? '<img src="' + (item.topView || item.image) + '" alt="' + escapeHtml(item.name) + '">'
                                : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:' + (2 * scale) + 'rem">&#128640;</div>')) +
                    '</div>' +
                    '<div class="fv-ship-name" title="' + escapeHtml(item.name) + '" style="max-width:' + dims.w + 'px;font-size:' + nameFz + 'rem;margin-top:' + Math.round(4 * scale) + 'px">' + escapeHtml(item.name) + '</div>' +
                    '<div class="fv-ship-mfr" style="font-size:' + mfrFz + 'rem">' + escapeHtml(item.manufacturer) + (lengthLabel ? ' &middot; ' + lengthLabel : '') + '</div>' +
                    '<div class="fv-ship-crew" style="max-width:' + dims.w + 'px;font-size:' + crewFz + 'rem;gap:' + Math.max(1, Math.round(2 * scale)) + 'px">' + crewHtml + '</div>' +
                '</div>';

            canvas.appendChild(el);

            if (item.holo) {
                loadFvHolo(holoId, item.holo, dims.w, dims.h);
            }
        });

        initFvDrag();
    }

    function loadFvHolo(containerId, holoUrl, renderW, renderH) {
        var container = document.getElementById(containerId);
        if (!container) return;

        var w = renderW || FV_BASE_SIZE;
        var h = renderH || FV_BASE_SIZE;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050a12);

        var camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 500);
        camera.position.set(0, 50, 0);
        camera.lookAt(0, 0, 0);

        var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;

        var ambient = new THREE.AmbientLight(0x406080, 1.0);
        scene.add(ambient);

        var dir1 = new THREE.DirectionalLight(0x00d4ff, 1.5);
        dir1.position.set(0, 50, 0);
        scene.add(dir1);

        var dir2 = new THREE.DirectionalLight(0x7dd3fc, 0.4);
        dir2.position.set(5, 20, 5);
        scene.add(dir2);

        var dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
        dracoLoader.setDecoderConfig({ type: 'js' });

        function onLoaded(gltf) {
            if (!container.parentNode) { renderer.dispose(); dracoLoader.dispose(); return; }

            var model = gltf.scene;
            var box = new THREE.Box3().setFromObject(model);
            var bSize = box.getSize(new THREE.Vector3());
            var center = box.getCenter(new THREE.Vector3());

            var maxDim = Math.max(bSize.x, bSize.z);
            var scale = 20 / maxDim;
            model.scale.setScalar(scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

            var holoMat = new THREE.MeshPhongMaterial({
                color: 0x00bbdd,
                emissive: 0x004455,
                specular: 0x00d4ff,
                shininess: 60,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide
            });
            model.traverse(function (child) {
                if (child.isMesh) child.material = holoMat;
            });

            scene.add(model);

            var newBox = new THREE.Box3().setFromObject(model);
            var newSize = newBox.getSize(new THREE.Vector3());
            var halfMax = Math.max(newSize.x, newSize.z) / 2 + 1;
            camera.left = -halfMax;
            camera.right = halfMax;
            camera.top = halfMax;
            camera.bottom = -halfMax;
            camera.updateProjectionMatrix();

            renderer.render(scene, camera);
            container.innerHTML = '';
            container.appendChild(renderer.domElement);

            fvMiniRenderers.push({ renderer: renderer, scene: scene, dracoLoader: dracoLoader });
        }

        function onError() {
            if (!container.parentNode) { renderer.dispose(); dracoLoader.dispose(); return; }
            renderer.dispose();
            dracoLoader.dispose();
            container.innerHTML = '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">' +
                '<span style="font-size:1.2rem">&#128640;</span>' +
                '<button class="fv-retry-btn" style="font-family:Rajdhani,sans-serif;font-size:0.6rem;padding:2px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:3px;color:var(--accent);cursor:pointer">Retry</button>' +
                '</div>';
            container.querySelector('.fv-retry-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                container.innerHTML = '<div class="fv-holo-loading"></div>';
                loadFvHolo(containerId, holoUrl, renderW, renderH);
            });
        }

        (async function () {
            try {
                var arrayBuffer = await fetchHoloModel(holoUrl);
                var loader = new THREE.GLTFLoader();
                loader.setDRACOLoader(dracoLoader);
                loader.parse(arrayBuffer, '', onLoaded, onError);
            } catch (e) {
                console.warn('FV holo fetch failed:', e);
                delete holoCache[holoUrl];
                onError();
            }
        })();
    }

    function cleanupFvRenderers() {
        while (fvMiniRenderers.length > 0) {
            var entry = fvMiniRenderers.pop();
            if (entry.renderer) entry.renderer.dispose();
            if (entry.dracoLoader) entry.dracoLoader.dispose();
            if (entry.scene) {
                entry.scene.traverse(function (obj) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
                        else obj.material.dispose();
                    }
                });
            }
        }
    }

    function initFvDrag() {
        var canvas = document.getElementById('fv-canvas');
        var ships = canvas.querySelectorAll('.fv-ship');
        var dragState = null;

        ships.forEach(function (ship) {
            ship.addEventListener('mousedown', startDrag);
            ship.addEventListener('touchstart', startDrag, { passive: false });
        });

        function startDrag(e) {
            if (e.button && e.button !== 0) return;
            e.preventDefault();
            var ship = e.currentTarget;
            ship.classList.add('dragging');

            var pt = e.touches ? e.touches[0] : e;
            var rect = ship.getBoundingClientRect();
            dragState = {
                el: ship,
                offsetX: pt.clientX - rect.left,
                offsetY: pt.clientY - rect.top,
                fleetId: ship.dataset.fleetId
            };

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', endDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('touchend', endDrag);
        }

        function onDrag(e) {
            if (!dragState) return;
            e.preventDefault();
            var pt = e.touches ? e.touches[0] : e;
            var canvasRect = canvas.getBoundingClientRect();
            var x = (pt.clientX - canvasRect.left) / fvZoom - dragState.offsetX / fvZoom;
            var y = (pt.clientY - canvasRect.top) / fvZoom - dragState.offsetY / fvZoom;

            x = Math.max(0, Math.round(x / 10) * 10);
            y = Math.max(0, Math.round(y / 10) * 10);

            dragState.el.style.left = x + 'px';
            dragState.el.style.top = y + 'px';
            dragState.lastX = x;
            dragState.lastY = y;
        }

        function endDrag() {
            if (!dragState) return;
            dragState.el.classList.remove('dragging');

            if (dragState.lastX !== undefined) {
                var positions = getFleetViewPositions();
                positions[dragState.fleetId] = { x: dragState.lastX, y: dragState.lastY };
                saveFleetViewPositions(positions);
            }

            dragState = null;
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', endDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('touchend', endDrag);
        }
    }

    function autoArrangeFleet() {
        saveFleetViewPositions({});
        renderFleetView();
        toast('Fleet arranged', 'info');
    }

    async function screenshotFleetView() {
        var fvCanvas = document.getElementById('fv-canvas');
        if (!fvCanvas || fleet.length === 0) {
            toast('Nothing to screenshot', 'error');
            return;
        }

        toast('Capturing fleet view...', 'info');

        try {
            var ships = fvCanvas.querySelectorAll('.fv-ship');
            var minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            ships.forEach(function (s) {
                var x = parseInt(s.style.left) || 0;
                var y = parseInt(s.style.top) || 0;
                var w = s.offsetWidth;
                var h = s.offsetHeight;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x + w > maxX) maxX = x + w;
                if (y + h > maxY) maxY = y + h;
            });

            var pad = 40;
            var captureW = maxX - minX + pad * 2;
            var captureH = maxY - minY + pad * 2;

            var result = await html2canvas(fvCanvas, {
                x: minX - pad,
                y: minY - pad,
                width: captureW,
                height: captureH,
                backgroundColor: '#060b14',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                onclone: function (doc) {
                    var clonedCanvas = doc.getElementById('fv-canvas');
                    if (clonedCanvas) {
                        clonedCanvas.style.transform = 'none';
                    }
                    var webglCanvases = clonedCanvas.querySelectorAll('canvas');
                    var origCanvases = fvCanvas.querySelectorAll('canvas');
                    webglCanvases.forEach(function (clone, i) {
                        var orig = origCanvases[i];
                        if (orig) {
                            try {
                                var dataUrl = orig.toDataURL('image/png');
                                var img = doc.createElement('img');
                                img.src = dataUrl;
                                img.style.width = clone.style.width || clone.width + 'px';
                                img.style.height = clone.style.height || clone.height + 'px';
                                img.style.display = 'block';
                                clone.parentNode.replaceChild(img, clone);
                            } catch (e) { /* keep canvas as-is */ }
                        }
                    });
                }
            });

            result.toBlob(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'fleet-view-' + new Date().toISOString().slice(0, 10) + '.png';
                a.click();
                setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
                toast('Screenshot saved!', 'success');
            }, 'image/png');
        } catch (err) {
            console.error('Screenshot error:', err);
            toast('Screenshot failed: ' + err.message, 'error');
        }
    }

    // ── Helpers ──

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    // ── Event Binding ──

    function initEvents() {
        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                this.classList.add('active');
                document.getElementById('tab-' + this.dataset.tab).classList.add('active');
                if (this.dataset.tab === 'fleetview') renderFleetView();
            });
        });

        // Fleet View controls
        document.getElementById('fv-auto-arrange').addEventListener('click', autoArrangeFleet);
        document.getElementById('fv-screenshot').addEventListener('click', screenshotFleetView);
        document.getElementById('fv-zoom-in').addEventListener('click', function () {
            fvZoom = Math.min(2, fvZoom + 0.1);
            document.getElementById('fv-canvas').style.transform = 'scale(' + fvZoom + ')';
            document.getElementById('fv-zoom-label').textContent = Math.round(fvZoom * 100) + '%';
        });
        document.getElementById('fv-zoom-out').addEventListener('click', function () {
            fvZoom = Math.max(0.3, fvZoom - 0.1);
            document.getElementById('fv-canvas').style.transform = 'scale(' + fvZoom + ')';
            document.getElementById('fv-zoom-label').textContent = Math.round(fvZoom * 100) + '%';
        });
        document.getElementById('fv-scale-toggle').addEventListener('change', function () {
            fvScaleMode = this.checked;
            localStorage.setItem('sc-fv-scale', fvScaleMode ? '1' : '0');
            renderFleetView();
        });

        // Ship search + filters
        let searchTimeout;
        document.getElementById('ship-search').addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(applyFilters, 200);
        });
        document.getElementById('filter-manufacturer').addEventListener('change', applyFilters);
        document.getElementById('filter-size').addEventListener('change', applyFilters);
        document.getElementById('filter-classification').addEventListener('change', applyFilters);
        document.getElementById('filter-status').addEventListener('change', applyFilters);

        // Fleet search
        document.getElementById('fleet-search').addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(renderFleet, 200);
        });

        // Delegated: add to fleet
        document.getElementById('ships-container').addEventListener('click', function (e) {
            const btn = e.target.closest('.add-to-fleet-btn');
            if (btn) addToFleet(btn.dataset.slug);

            const holoBtn = e.target.closest('.view-holo-btn');
            if (holoBtn) openHoloViewer(holoBtn.dataset.slug);
        });

        // Delegated: assign crew in fleet
        document.getElementById('fleet-container').addEventListener('click', function (e) {
            const btn = e.target.closest('.assign-crew-btn');
            if (btn) {
                const fleetId = btn.dataset.fleetId;
                const select = document.querySelector(`.assign-crew-select[data-fleet-id="${fleetId}"]`);
                if (select && select.value) {
                    assignCrew(fleetId, select.value);
                }
            }
        });

        // Clear fleet
        document.getElementById('clear-fleet-btn').addEventListener('click', function () {
            if (fleet.length === 0) return;
            if (confirm('Remove all ships from your fleet?')) {
                fleet = [];
                saveFleet();
                renderFleet();
                renderUsersTab();
                toast('Fleet cleared', 'info');
            }
        });

        // Add user
        document.getElementById('add-user-btn').addEventListener('click', function () {
            const input = document.getElementById('new-user-input');
            addUser(input.value);
            input.value = '';
        });
        document.getElementById('new-user-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                addUser(this.value);
                this.value = '';
            }
        });

        // Holo modal close
        document.getElementById('holo-modal-close').addEventListener('click', function () {
            document.getElementById('holo-modal').classList.remove('open');
            cleanupHolo();
        });
        document.getElementById('holo-modal').addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('open');
                cleanupHolo();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                const modal = document.getElementById('holo-modal');
                if (modal.classList.contains('open')) {
                    modal.classList.remove('open');
                    cleanupHolo();
                }
            }
        });
    }

    // ── Expose globals for inline handlers ──

    window.removeFromFleet = removeFromFleet;
    window.unassignCrew = unassignCrew;
    window.removeUser = removeUser;
    window.openHoloViewer = openHoloViewer;

    // ── Init ──

    document.addEventListener('DOMContentLoaded', function () {
        loadFleet();
        loadUsers();
        fvScaleMode = localStorage.getItem('sc-fv-scale') === '1';
        document.getElementById('fv-scale-toggle').checked = fvScaleMode;
        initEvents();
        updateStats();
        renderUsersTab();
        fetchShips();
    });
})();
