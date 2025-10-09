// ==UserScript==
// @name         Rename Vehicles
// @namespace    https://github.com/Praschinator
// @version      0.0.2
// @description  Rename vehicles in the game
// @author       Eli_Pra16 (forum.leitstellenspiel.de)
// @match        https://www.leitstellenspiel.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://github.com/Praschinator/LSS_rename_vehicles/raw/refs/heads/main/rename_vehicles.user.js
// @updateURL    https://github.com/Praschinator/LSS_rename_vehicles/raw/refs/heads/main/rename_vehicles.user.js
// @supportURL   https://forum.leitstellenspiel.de/index.php?thread/10810-scriptwusch-fahrzeugumbenennungsscript/
// @connect      api.lss-manager.de
// @connect      leitstellenspiel.de

// @require      file://C:\Users\Elias\Documents\GitHub\LSS_rename_vehicles\rename_vehicles.user.js

// ==/UserScript==

const TESTING = false;
const VEHICLE_TYPE_CATALOG_URL = 'https://api.lss-manager.de/de_DE/vehicles';

const RENAME_PATTERN_STORAGE_KEY = 'rv_rename_pattern';

const LS_KEYS = {
    vehicleTypeAliases: 'rv_vehicleTypeAliases',
    buildingAliases: 'rv_buildingAliases',
    vehicleTypeCatalogMap: 'rv_vehicleTypeCatalogMap',
    vehicles: 'vehicles_data',
    buildings: 'building_data'
};

/** KONFIG: Erlaubte Building Types (nur numerisch) */
const ALLOWED_BUILDING_TYPES = new Set([0, 2, 5, 6, 9, 11, 12, 13, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28]);

/** Force: clears cached buildings and reloads them via API; no args. */
async function forceReloadBuildings() {
    localStorage.removeItem(LS_KEYS.buildings);
    await api_call_buildings();
    console.log('[RV] Buildings reloaded fresh from API');
}

/** Storage: get JSON from localStorage with fallback. Args: key String, fallback any. */
function lsGetJson(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
/** Storage: set JSON to localStorage. Args: key String, value any. */
function lsSetJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** Aliases: load alias map by LS key. Args: key String. */
function loadAliasMap(key) { return lsGetJson(key, {}) || {}; }
/** Aliases: save alias map by LS key. Args: key String, obj Object. */
function saveAliasMap(key, obj) { lsSetJson(key, obj); }

/** Catalog: cache vehicle type id->caption map. Args: list Array. */
function cacheVehicleTypeCatalogMap(list) {
    if (!Array.isArray(list)) return;
    const map = {};
    list.forEach(v => { if (v && Number.isFinite(v.id)) map[v.id] = v.caption; });
    lsSetJson(LS_KEYS.vehicleTypeCatalogMap, map);
    return map;
}
/** Catalog: load cached vehicle type map from LS; no args. */
function loadVehicleTypeCatalogMap() {
    return lsGetJson(LS_KEYS.vehicleTypeCatalogMap, null);
}
/** Catalog: return cached vehicle type map or build from playerVehicles. Args: playerVehicles Array. */
async function getVehicleTypeCatalogCached(playerVehicles = []) {
    let map = loadVehicleTypeCatalogMap();
    if (map && Object.keys(map).length) return map;
    try {
        const list = await uniqueVehicleTypes(playerVehicles);
        map = cacheVehicleTypeCatalogMap(list) || {};
        return map;
    } catch {
        return {};
    }
}

/** Utils: create a debounced function. Args: fn Function, wait Number(ms). */
function debounce(fn, wait=300) {
    let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}

// Styles // Abgekuckt von Caddy 
const styles = `
#rename_vehicles_extension-lightbox {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
}
#rename_vehicles_extension-lightbox-modal {
    background: #fff;
    width: 80%;
    height: 80%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    position: relative;
}
#rename_vehicles_extension-lightbox-close {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 25px;
    height: 25px;
    background: red;
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 13px;
    font-weight: bold;
}
#rename_vehicles_extension-lightbox-close:hover { background: darkred; }
#rename_vehicles_extension-lightbox-content {
    background: transparent !important;
    border: none !important;
    text-shadow: none !important;
    box-shadow: none !important;
    color: #000 !important;
    padding: 20px;
    font-size: 20px;
    display: flex;
    gap: 14px;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    max-width: 850px;
}
#rename_vehicles_extension-lightbox-content h1 { margin:0; font-size:28px; }
.rv_button_row { display:flex; gap:12px; flex-wrap:wrap; }
#rename_vehicles_settings-button,
#rename_vehicles_rename-button,
#rename_vehicles_execute-button {
    color: #fff;
    border: none;
    padding: 15px 30px;
    font-size: 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color .3s;
}
#rename_vehicles_settings-button { background:#007bff; }
#rename_vehicles_settings-button:hover { background:#0056b3; }
#rename_vehicles_rename-button { background:#28a745; }
#rename_vehicles_rename-button:hover { background:#1e7e34; }
#rename_vehicles_execute-button { background:#ffc107; color:#212529; }
#rename_vehicles_execute-button:hover { background:#e0a800; }

#rename_vehicles_settings-overlay {
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.55);
    z-index:10050;
    display:flex;
    justify-content:center;
    align-items:center;
    font-size:14px;
}
#rename_vehicles_settings-modal {
    background:#fff;
    width:80%;
    max-width:1100px;
    height:80%;
    display:flex;
    flex-direction:column;
    border:2px solid #007bff;
    position:relative;
    padding:.75rem 1rem 1rem;
    overflow:hidden;
}
#rename_vehicles_settings-close {
    position:absolute;
    top:6px;
    right:6px;
    border:none;
    background:#dc3545;
    color:#fff;
    width:32px;
    height:32px;
    font-weight:bold;
    cursor:pointer;
}
#rename_vehicles_settings-close:hover { background:#b52a36; }
#rename_vehicles_settings-title { margin:0 0 .5rem 0; font-size:20px; font-weight:600; }
#rename_vehicles_settings-body {
    flex:1;
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap:1rem;
    overflow:hidden;
    min-height:0;
}
.rename_vehicles_rv_column { display:flex; flex-direction:column; min-height:0; }
.rename_vehicles_rv_column h3 { margin:.2rem 0 .4rem; font-size:15px; font-weight:600; }
.rename_vehicles_rv_scroll {
    flex:1; overflow:auto; border:1px solid #ddd; padding:.4rem .5rem;
    background:#fafafa; border-radius:4px;
}
.rename_vehicles_rv_pair { display:flex; align-items:center; gap:.5rem; margin-bottom:.35rem; font-size:12px; }
.rename_vehicles_rv_pair label {
    flex:0 0 230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;
}
.rename_vehicles_rv_pair input { flex:1; min-width:120px; font-size:12px; padding:2px 4px; }
#rename_vehicles_settings-footer {
    border-top:1px solid #ddd; padding:.45rem .25rem 0;
    display:flex; justify-content:space-between; align-items:center; gap:.5rem; font-size:12px;
}
.alias-saved-indicator {
    margin-left:.5rem; color:#28a745; font-weight:600; opacity:0; transition:opacity .25s;
}
.alias-saved-indicator.show { opacity:1; }

#rename_vehicles_rename-overlay {
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.55);
    z-index:10060;
    display:flex;
    justify-content:center;
    align-items:center;
    font-size:14px;
}
#rename_vehicles_rename-modal {
    background:#fff;
    width:70%;
    max-width:900px;
    height:70%;
    display:flex;
    flex-direction:column;
    border:2px solid #28a745;
    position:relative;
    padding:.75rem 1rem 1rem;
    overflow:hidden;
}
#rename_vehicles_rename-close {
    position:absolute;
    top:6px;
    right:6px;
    border:none;
    background:#dc3545;
    color:#fff;
    width:32px;
    height:32px;
    font-weight:bold;
    cursor:pointer;
}
#rename_vehicles_rename-close:hover { background:#b52a36; }
#rename_vehicles_rename-title { margin:0 0 .5rem 0; font-size:18px; font-weight:600; padding-right:40px; }
#rename_vehicles_rename-body {
    flex:1;
    display:grid;
    grid-template-columns: 2fr 1fr;
    gap:1rem;
    overflow:hidden;
}
#rv_pattern_area_wrapper { display:flex; flex-direction:column; min-height:0; }
#rv_pattern_input {
    flex:1; width:100%; resize:none; font-family:monospace; font-size:13px;
    padding:.5rem; border:1px solid #ccc;
}
#rv_pattern_preview {
    margin-top:.5rem; font-size:12px; background:#f8f9fa; padding:.45rem .6rem;
    border:1px dashed #ccc; white-space:pre-wrap; overflow:auto; flex:0 0 auto;
}
#rv_variable_list {
    overflow:auto; border:1px solid #ddd; padding:.5rem .6rem;
    background:#fafafa; font-size:12px; line-height:1.4;
}
#rv_variable_list code {
    background:#eee; padding:0 3px; border-radius:3px; font-size:11px;
}
#rename_vehicles_rename-footer {
    display:flex; justify-content:space-between; align-items:center;
    padding:.5rem .25rem 0 .25rem; border-top:1px solid #ddd; gap:.5rem;
}
#rv_pattern_saved {
    font-weight:bold; color:#28a745; opacity:0; transition:opacity .25s;
}
#rv_pattern_saved.show { opacity:1; }

#rename_vehicles_execute-overlay {
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.6);
    z-index:10070;
    display:flex;
    justify-content:center;
    align-items:center;
    font-size:14px;
}
#rename_vehicles_execute-modal {
    background:#fff;
    width:90%;
    max-width:1300px;
    height:85%;
    display:flex;
    flex-direction:column;
    border:2px solid #ffc107;
    position:relative;
    padding:.75rem 1rem 1rem;
    overflow:hidden;
}
#rename_vehicles_execute-close {
    position:absolute;
    top:6px;
    right:6px;
    border:none;
    background:#dc3545;
    color:#fff;
    width:32px;
    height:32px;
    font-weight:bold;
    cursor:pointer;
}
#rename_vehicles_execute-close:hover { background:#b52a36; }
#rename_vehicles_execute-title { margin:0 0 .5rem; font-size:20px; font-weight:600; }
#rename_vehicles_execute-toolbar {
    display:flex; gap:.5rem; margin-bottom:.5rem; flex-wrap:wrap;
}
#rename_vehicles_execute-toolbar button {
    border:none; padding:.45rem .9rem; font-size:13px; cursor:pointer;
    border-radius:4px; font-weight:600;
}
#rv_btn_generate { background:#28a745; color:#fff; }
#rv_btn_generate:hover { background:#1d6c32; }
#rv_btn_commit { background:#ffc107; color:#212529; }
#rv_btn_commit:hover { background:#e0a100; }
#rv_pattern_info {
    font-size:12px; color:#555; display:flex; align-items:center; gap:.4rem; flex-wrap:wrap;
}

#rv_exec_progress {
    font-size:12px;
    color:#333;
    margin-bottom:.35rem;
}

#rv_exec_log {
    max-height:140px;
    overflow:auto;
    border:1px solid #ddd;
    background:#fff;
    padding:.35rem .5rem;
    font-family:monospace;
    font-size:11px;
}

#rename_vehicles_execute-table-wrapper {
    flex:1; overflow:auto; border:1px solid #ddd; background:#fafafa;
}
#rename_vehicles_execute-table { width:100%; border-collapse:collapse; font-size:12px; }
#rename_vehicles_execute-table thead {
    position:sticky; top:0; background:#343a40; color:#fff; z-index:1;
}
#rename_vehicles_execute-table th,
#rename_vehicles_execute-table td {
    padding:.35rem .5rem; border:1px solid #ccc; text-align:left; vertical-align:middle;
}
#rename_vehicles_execute-table tbody tr:nth-child(even) { background:#f1f1f1; }

.rv_new_name {
    font-family:monospace; font-size:11px; color:#004085; word-break:break-all;
}
.rv_changed td { background:#fff9e6; }
.rv_badpattern { color:#dc3545; font-weight:600; }

.rv_status_cell { font-weight:700; }
.rv_status_pending { color:#6c757d; }
.rv_status_running { color:#17a2b8; }
.rv_status_retry { color:#ffc107; }
.rv_status_done { color:#28a745; }
.rv_status_failed { color:#dc3545; }
`;

/** UI: adds the "Fahrzeuge umbenennen" button to the profile dropdown; no args. */
function add_button_to_personal_dropdown() {
    const profileMenu = document.querySelector('#menu_profile + .dropdown-menu');
    if (!profileMenu || document.getElementById('rename-vehicles-menu-button')) return;
    profileMenu.insertAdjacentHTML(
        'beforeend',
        `<li role="presentation">
            <a id="rename-vehicles-menu-button" href="#">Fahrzeuge umbenennen</a>
         </li>`
    );
    document.getElementById('rename-vehicles-menu-button').addEventListener('click', async e => {
        e.preventDefault();
        if (TESTING) return open_iframe();
        await Promise.all([api_call_buildings(), api_call_vehicles()]);
        open_iframe();
    });
}

/** Data: joins vehicles with their buildings into flat objects. Args: vehicles Array, buildings Array. */
function joinVehiclesWithBuildings(vehicles, buildings) {
    const buildingMap = new Map();
    buildings.forEach(b => buildingMap.set(b.id, b));
    return vehicles.map(v => {
        const b = buildingMap.get(v.building_id);
        const out = {};
        Object.keys(v).forEach(k => out[`v_${k}`] = v[k]);
        if (b) Object.keys(b).forEach(k => out[`b_${k}`] = b[k]);
        return out;
    });
}

/** UI: opens main lightbox with navigation to settings/logic/execute; no args. */
function open_iframe() {
    if (document.getElementById('rename_vehicles_extension-lightbox')) return;
    const lightbox = document.createElement('div');
    lightbox.id = 'rename_vehicles_extension-lightbox';
    lightbox.innerHTML = `
        <div id="rename_vehicles_extension-lightbox-modal">
            <button id="rename_vehicles_extension-lightbox-close">✖</button>
            <div id="rename_vehicles_extension-lightbox-content">
                <h1>Fahrzeug Umbenennungs Skript</h1>
                <p>Verwalte Aliase, definiere die Umbenennungslogik oder starte jetzt den Umbenennungs-Prozess.</p>
                <div class="rv_button_row">
                    <button id="rename_vehicles_settings-button">Aliase</button>
                    <button id="rename_vehicles_rename-button">Umbenennungslogik</button>
                    <button id="rename_vehicles_execute-button">Umbenennen</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(lightbox);

    const building_data = lsGetJson(LS_KEYS.buildings, null);
    const vehicle_data  = lsGetJson(LS_KEYS.vehicles, null);
    if (building_data && vehicle_data) {
        console.log("Joined data:", joinVehiclesWithBuildings(vehicle_data, building_data));
    }

    lightbox.querySelector('#rename_vehicles_extension-lightbox-close')
        .addEventListener('click', () => lightbox.remove());

    lightbox.querySelector('#rename_vehicles_settings-button')
        .addEventListener('click', async () => {
            await open_settings_modal(
                lsGetJson(LS_KEYS.vehicles, []) || [],
                lsGetJson(LS_KEYS.buildings, []) || []
            );
        });
    lightbox.querySelector('#rename_vehicles_rename-button')
        .addEventListener('click', () => {
            open_rename_modal(
                lsGetJson(LS_KEYS.vehicles, []) || [],
                lsGetJson(LS_KEYS.buildings, []) || []
            );
        });
    lightbox.querySelector('#rename_vehicles_execute-button')
        .addEventListener('click', () => {
            open_execute_modal(
                lsGetJson(LS_KEYS.vehicles, []) || [],
                lsGetJson(LS_KEYS.buildings, []) || []
            );
        });
}

/** API: fetches and normalizes the unique vehicle type list. Args: playerVehicles Array. */
async function uniqueVehicleTypes(playerVehicles = []) {
    try {
        const resp = await fetch(VEHICLE_TYPE_CATALOG_URL, { cache:'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        let list = [];
        if (Array.isArray(data)) {
            list = data.map(it => {
                const idNum = Number(it.id ?? it.type ?? it.vehicle_type);
                if (!Number.isFinite(idNum)) return null;
                const caption = String(it.caption || it.name || it.localized_name || it.text || idNum).trim();
                return { id: idNum, caption };
            }).filter(Boolean);
        } else if (data && typeof data === 'object') {
            list = Object.entries(data).map(([k,val])=>{
                const idNum = Number(k);
                if (!Number.isFinite(idNum)) return null;
                const caption = String(val.caption || val.name || val.localized_name || k).trim();
                return { id:idNum, caption };
            }).filter(Boolean);
        }
        const seen = new Set();
        list = list.filter(v => !seen.has(v.id) && seen.add(v.id)).sort((a,b)=>a.id-b.id);
        return list;
    } catch {
        const seen = new Set(), fb=[];
        playerVehicles.forEach(v=>{
            const raw = v.vehicle_type_id ?? v.vehicle_type ?? v.type ?? v.class ?? v.id;
            const idNum = Number(raw);
            if (!Number.isFinite(idNum) || seen.has(idNum)) return;
            seen.add(idNum);
            const caption = String(v.vehicle_type_caption || v.caption || v.name || raw).trim();
            fb.push({ id:idNum, caption });
        });
        fb.sort((a,b)=>a.id-b.id);
        return fb;
    }
}

/** Data: filters buildings by allowed numeric types and returns id/name pairs. Args: buildings Array. */
function uniqueBuildings(buildings) {
    if (!Array.isArray(buildings)) return [];

    const kept = [];
    const dropped = [];

    for (const b of buildings) {
        if (!b) continue;
        const t = Number(b.building_type);
        const isAllowed = Number.isFinite(t) && ALLOWED_BUILDING_TYPES.has(t);
        if (isAllowed) kept.push(b); else dropped.push(b);
    }

    const arr = kept.map(b => {
        const name = b.caption || b.name || b.building_caption || b.building_name || `Gebäude ${b.id}`;
        return { id: b.id, name: String(name).trim() };
    });

    arr.sort((a,b)=>a.name.localeCompare(b.name,'de'));
    return arr;
}

/** UI: opens alias settings modal with vehicle/building alias inputs. Args: vehicles Array, buildings Array. */
async function open_settings_modal(vehicles, buildings) {
    if (document.getElementById('rename_vehicles_settings-overlay')) return;

    const vehicleTypes = await uniqueVehicleTypes(vehicles);
    cacheVehicleTypeCatalogMap(vehicleTypes);

    // Will now only include allowed building types
    const buildingList = uniqueBuildings(buildings);

    const vtAliases = loadAliasMap(LS_KEYS.vehicleTypeAliases);
    const bdAliases = loadAliasMap(LS_KEYS.buildingAliases);

    const overlay = document.createElement('div');
    overlay.id = 'rename_vehicles_settings-overlay';
    overlay.innerHTML = `
      <div id="rename_vehicles_settings-modal">
        <button id="rename_vehicles_settings-close">✖</button>
        <h2 id="rename_vehicles_settings-title">Alias Einstellungen</h2>
        <div id="rename_vehicles_settings-body">
            <div class="rename_vehicles_rv_column">
                <h3>Fahrzeugtypen (${vehicleTypes.length})</h3>
                <div class="rename_vehicles_rv_scroll" id="rv_vehicle_types_container"></div>
            </div>
            <div class="rename_vehicles_rv_column">
                <h3>Gebäude (${buildingList.length})</h3>
                <div class="rename_vehicles_rv_scroll" id="rv_buildings_container"></div>
            </div>
        </div>
        <div id="rename_vehicles_settings-footer">
            <div style="display:flex;align-items:center;">
                <strong>Status:</strong>
                <span class="alias-saved-indicator" id="rv_saved_indicator">Gespeichert</span>
            </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const vehicleContainer = overlay.querySelector('#rv_vehicle_types_container');
    vehicleTypes.forEach(vt => {
        const idStr = String(vt.id);
        vehicleContainer.insertAdjacentHTML('beforeend', `
          <div class="rename_vehicles_rv_pair">
            <label title="${vt.caption}">${idStr} - ${vt.caption}</label>
            <input type="text" data-type="vehicle" data-key="${encodeURIComponent(idStr)}" value="${vtAliases[idStr] ?? ''}" placeholder="Alias...">
          </div>`);
    });

    const buildingContainer = overlay.querySelector('#rv_buildings_container');
    buildingList.forEach(b => {
        buildingContainer.insertAdjacentHTML('beforeend', `
          <div class="rename_vehicles_rv_pair">
            <label title="${b.name}">${b.id} - ${b.name}</label>
            <input type="text" data-type="building" data-key="${b.id}" value="${bdAliases[b.id] ?? ''}" placeholder="Alias...">
          </div>`);
    });

    const savedIndicator = overlay.querySelector('#rv_saved_indicator');
    const showSaved = () => {
        savedIndicator.classList.add('show');
        setTimeout(()=>savedIndicator.classList.remove('show'), 1400);
    };
    const debouncedSave = debounce(() => {
        saveAliasMap(LS_KEYS.vehicleTypeAliases, vtAliases);
        saveAliasMap(LS_KEYS.buildingAliases, bdAliases);
        showSaved();
    }, 300);

    overlay.addEventListener('input', e => {
        if (!e.target.matches('input[data-type]')) return;
        const key = decodeURIComponent(e.target.dataset.key);
        if (e.target.dataset.type === 'vehicle') {
            if (e.target.value.trim()) vtAliases[key] = e.target.value.trim(); else delete vtAliases[key];
        } else {
            if (e.target.value.trim()) bdAliases[key] = e.target.value.trim(); else delete bdAliases[key];
        }
        debouncedSave();
    });

    overlay.querySelector('#rename_vehicles_settings-close')
        .addEventListener('click', () => overlay.remove());
}

/** UI: opens pattern editor modal for renaming logic; no args. */
function open_rename_modal() {
    if (document.getElementById('rename_vehicles_rename-overlay')) return;
    const defaultPattern = '{stationAlias}-{tagging}-{number}';
    const storedPattern = localStorage.getItem(RENAME_PATTERN_STORAGE_KEY) || defaultPattern;

    const overlay = document.createElement('div');
    overlay.id = 'rename_vehicles_rename-overlay';
    overlay.innerHTML = `
      <div id="rename_vehicles_rename-modal">
        <button id="rename_vehicles_rename-close">✖</button>
        <h2 id="rename_vehicles_rename-title">Rename Muster (Pattern)</h2>
        <div id="rename_vehicles_rename-body">
            <div id="rv_pattern_area_wrapper">
                <label for="rv_pattern_input" style="font-weight:600;">Pattern:</label>
                <textarea id="rv_pattern_input" spellcheck="false" placeholder="{stationAlias}-{tagging}-{number}">${storedPattern}</textarea>
                <div id="rv_pattern_preview"></div>
            </div>
            <div id="rv_variable_list">
                <strong>Platzhalter:</strong><br><br>
                <code>{id}</code> Fahrzeug-ID<br>
                <code>{old}</code> Alter Name<br>
                <code>{vehicleType}</code> Original Typbezeichnung<br>
                <code>{tagging}</code> Fahrzeugtyp Alias<br>
                <code>{stationName}</code> Gebäude-Name<br>
                <code>{stationAlias}</code> Gebäude-Alias<br>
                <code>{number}</code> Laufende Nummer<br>
                <code>{numberRoman}</code> Nummer römisch<br>
                Beispiel: <code>{stationAlias}-{tagging}-{number}</code>
            </div>
        </div>
        <div id="rename_vehicles_rename-footer">
            <div>
                <button id="rv_pattern_reset" class="btn btn-xs btn-warning">Zurücksetzen</button>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem;">
                <span id="rv_pattern_saved">Gespeichert</span>
                <button id="rv_pattern_close" class="btn btn-xs btn-success">Schließen</button>
            </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const ta = overlay.querySelector('#rv_pattern_input');
    const savedIndicator = overlay.querySelector('#rv_pattern_saved');
    const preview = overlay.querySelector('#rv_pattern_preview');

    const showSaved = () => { savedIndicator.classList.add('show'); setTimeout(()=>savedIndicator.classList.remove('show'), 1200); };
    const updatePreview = () => {
        preview.innerHTML = ta.value.replace(/\{[^}]+\}/g, m => `<span style="color:#007bff;font-weight:600;">${m}</span>`);
    };
    updatePreview();

    const debouncedSave = debounce(() => {
        localStorage.setItem(RENAME_PATTERN_STORAGE_KEY, ta.value);
        showSaved(); updatePreview();
    }, 400);

    ta.addEventListener('input', debouncedSave);
    overlay.querySelector('#rv_pattern_reset').addEventListener('click', () => {
        ta.value = defaultPattern;
        debouncedSave();
    });
    const closeFn = () => overlay.remove();
    overlay.querySelector('#rv_pattern_close').addEventListener('click', closeFn);
    overlay.querySelector('#rename_vehicles_rename-close').addEventListener('click', closeFn);
}

/** UI: opens execution modal, generates previews and commits renames. Args: vehicles Array, buildings Array. */
function open_execute_modal(vehicles, buildings) {
    if (document.getElementById('rename_vehicles_execute-overlay')) return;

    const vtAliases = loadAliasMap(LS_KEYS.vehicleTypeAliases);
    const bdAliases = loadAliasMap(LS_KEYS.buildingAliases);

    const buildingMap = new Map();
    buildings.forEach(b => buildingMap.set(b.id, b));

    const overlay = document.createElement('div');
    overlay.id = 'rename_vehicles_execute-overlay';
    overlay.innerHTML = `
      <div id="rename_vehicles_execute-modal">
        <button id="rename_vehicles_execute-close">✖</button>
        <h2 id="rename_vehicles_execute-title">Fahrzeuge umbenennen</h2>
        <div id="rename_vehicles_execute-toolbar">
            <button id="rv_btn_generate">Umbenennen starten</button>
            <button id="rv_btn_commit" disabled>Umbenennen speichern</button>
            <div id="rv_pattern_info"></div>
        </div>
        <div id="rv_exec_progress"><strong>Fortschritt:</strong> Noch keine Generierung.</div>
        <div id="rv_exec_log"></div>
        <div id="rename_vehicles_execute-table-wrapper">
            <table id="rename_vehicles_execute-table">
                <thead>
                    <tr>
                        <th>ID</th><th>Aktueller Name</th><th>Gebäude</th><th>Fahrzeugtyp</th>
                        <th>Nr</th><th>Neuer Name (Vorschau)</th><th>Status</th>
                    </tr>
                </thead>
                <tbody id="rv_exec_tbody"></tbody>
            </table>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#rename_vehicles_execute-close')
        .addEventListener('click', () => overlay.remove());

    const tbody = overlay.querySelector('#rv_exec_tbody');
    const patternInfo = overlay.querySelector('#rv_pattern_info');

    (async () => {
        const catalogMap = await getVehicleTypeCatalogCached(vehicles);
        vehicles.forEach(v => {
            const b = buildingMap.get(v.building_id) || {};
            const vehicleTypeId = v.vehicle_type ?? v.vehicle_type_id ?? '';
            const vtCaption = catalogMap[vehicleTypeId] || v.vehicle_type_caption || `Typ ${vehicleTypeId}`;
            const tr = document.createElement('tr');
            tr.dataset.vehicleId = v.id;
            tr.dataset.vehicleType = vehicleTypeId;
            tr.dataset.buildingId = v.building_id ?? '';
            tr.innerHTML = `
                <td>${v.id}</td>
                <td class="rv_old_name">${escapeHtml(v.caption || '')}</td>
                <td>${escapeHtml(b.caption || b.name || ('Gebäude '+(b.id??'?')))}</td>
                <td>${escapeHtml(vtCaption)}</td>
                <td class="rv_seq"></td>
                <td class="rv_new_name"></td>
                <td class="rv_status_cell rv_status_pending">PENDING</td>`;
            tbody.appendChild(tr);
        });

        const ui = {
            tbody,
            progressBox: overlay.querySelector('#rv_exec_progress'),
            log: overlay.querySelector('#rv_exec_log'),
            commitBtn: overlay.querySelector('#rv_btn_commit')
        };

        const getPattern = () => localStorage.getItem(RENAME_PATTERN_STORAGE_KEY) || '{stationAlias}-{tagging}-{number}';
        patternInfo.textContent = 'Pattern: ' + getPattern();

        overlay.querySelector('#rv_btn_generate').addEventListener('click', () => {
            const pattern = getPattern();
            patternInfo.textContent = 'Pattern: ' + pattern;
            const counters = {};
            const ops = [];

            tbody.querySelectorAll('tr').forEach(tr => {
                const vid = Number(tr.dataset.vehicleId);
                const vType = tr.dataset.vehicleType;
                const bId = tr.dataset.buildingId;
                const key = `${bId}|${vType}`;
                counters[key] = (counters[key] || 0) + 1;

                const seq = counters[key];
                const seqStr = seq.toString().padStart(2,'0');
                tr.querySelector('.rv_seq').textContent = seqStr;

                const vehicle = vehicles.find(x => x.id === vid);
                const building = buildingMap.get(Number(bId)) || {};

                const newName = applyRenamePattern(pattern, {
                    vehicle, building, seq, seqStr,
                    vtAliases, bdAliases, catalogMap
                });

                const oldName = vehicle.caption || '';
                tr.querySelector('.rv_new_name').textContent = newName;
                if (newName && newName !== oldName) tr.classList.add('rv_changed'); else tr.classList.remove('rv_changed');
                ops.push({ id: vid, old: oldName, proposed: newName });
            });

            overlay.dataset.operations = JSON.stringify(ops);
            ui.commitBtn.disabled = false;
        });

        overlay.querySelector('#rv_btn_commit').addEventListener('click', () => {
            const raw = overlay.dataset.operations;
            if (!raw) return;
            let ops;
            try { ops = JSON.parse(raw); } catch { return; }
            ui.commitBtn.disabled = true;
            ui.commitBtn.textContent = 'Läuft...';
            startCaptionRenameQueue(ops, ui);
        });
    })();
}

const RENAME_RATE_MS = 100;
const RENAME_MAX_RETRIES = 2;

let GLOBAL_CSRF_TOKEN = null;
/** Auth: tries to read CSRF token from meta tags and cache it; no args. */
async function getCsrfToken() {
    if (GLOBAL_CSRF_TOKEN) return GLOBAL_CSRF_TOKEN;
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="csrf_token"]');
    if (meta?.content) GLOBAL_CSRF_TOKEN = meta.content;
    return GLOBAL_CSRF_TOKEN;
}
/** Auth: fetches authenticity_token from vehicle edit page. Args: vehicleId Number. */
async function fetchAuthTokenFromEdit(vehicleId) {
    const resp = await fetch(`/vehicles/${vehicleId}/edit`, { credentials:'same-origin' });
    if (!resp.ok) throw new Error(`Edit HTTP ${resp.status}`);
    const html = await resp.text();
    const m = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
    if (!m) throw new Error('authenticity_token nicht gefunden');
    return m[1];
}
/** API: sends only caption rename PATCH for a vehicle. Args: vehicleId Number, newCaption String. */
async function sendRenameCaptionOnly(vehicleId, newCaption) {
    let token = await getCsrfToken();
    if (!token) token = await fetchAuthTokenFromEdit(vehicleId);
    const fd = new FormData();
    fd.append('utf8','✓');
    fd.append('_method','patch');
    fd.append('authenticity_token', token);
    fd.append('vehicle[caption]', newCaption);
    fd.append('commit','Speichern');
    const resp = await fetch(`/vehicles/${vehicleId}`, { method:'POST', body:fd, credentials:'same-origin' });
    if (!resp.ok) throw new Error(`Rename HTTP ${resp.status}`);
    return true;
}

/** Queue: processes rename operations with retries and UI updates. Args: operations Array, uiCtx Object. */
function startCaptionRenameQueue(operations, uiCtx) {
    const queue = operations.filter(o => o.proposed && o.proposed !== o.old)
        .map(o => ({ ...o, tries:0, status:'pending' }));
    if (!queue.length) {
        logExec('Keine Änderungen.');
        return queue;
    }
    let index = 0;

    /** Log: appends a timestamped message to exec log. Args: msg String. */
    function logExec(msg) {
        if (!uiCtx.log) return;
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        uiCtx.log.appendChild(div);
        uiCtx.log.scrollTop = uiCtx.log.scrollHeight;
    }
    /** UI: updates status cell for a queue item. Args: item Object. */
    function updateRow(item) {
        const row = uiCtx.tbody.querySelector(`tr[data-vehicle-id="${item.id}"]`);
        if (!row) return;
        const cell = row.querySelector('.rv_status_cell');
        cell.textContent = item.status.toUpperCase();
        cell.className = `rv_status_cell rv_status_${item.status}`;
    }
    /** UI: updates progress summary counts; no args. */
    function updateProgress() {
        const t=queue.length;
        const done=queue.filter(i=>i.status==='done').length;
        const failed=queue.filter(i=>i.status==='failed').length;
        const retry=queue.filter(i=>i.status==='retry').length;
        const running=queue.filter(i=>i.status==='running').length;
        if (uiCtx.progressBox) uiCtx.progressBox.innerHTML =
            `<strong>Fortschritt:</strong> Gesamt:${t} | Fertig:${done} | Läuft:${running} | Retry:${retry} | Fehlgeschlagen:${failed} | Offen:${t-done-failed-running-retry}`;
    }
    /** Step: consumes next queue item, performs rename, handles retry. No direct args. */
    async function step() {
        if (index >= queue.length) {
            logExec('Abgeschlossen.');
            updateProgress();
            uiCtx.commitBtn.disabled = false;
            uiCtx.commitBtn.textContent = 'Umbenennen speichern (erneut)';
            return;
        }
        const item = queue[index];
        if (['done','failed'].includes(item.status)) {
            index++; return setTimeout(step, RENAME_RATE_MS);
        }
        item.status='running'; item.tries++; updateRow(item); updateProgress();
        try {
            await sendRenameCaptionOnly(item.id, item.proposed);
            item.status='done';
            logExec(`OK ${item.id} -> "${item.proposed}"`);
        } catch(e) {
            if (item.tries <= RENAME_MAX_RETRIES) {
                item.status='retry';
                logExec(`Retry ${item.id} (${item.tries}): ${e.message}`);
            } else {
                item.status='failed';
                logExec(`FEHLER ${item.id}: ${e.message}`);
            }
        }
        updateRow(item); updateProgress();
        if (item.status==='retry') {
            return setTimeout(step, RENAME_RATE_MS);
        } else {
            index++; return setTimeout(step, RENAME_RATE_MS);
        }
    }
    logExec(`Starte Queue (${queue.length}).`);
    updateProgress();
    step();
    return queue;
}

/** Naming: builds a new caption from pattern and context. Args: pattern String, ctx Object. */
function applyRenamePattern(pattern, ctx) {
    if (!pattern) return '';
    const { vehicle, building, seq, seqStr, vtAliases, bdAliases, catalogMap = {} } = ctx;
    const vehicleTypeId = vehicle.vehicle_type ?? vehicle.vehicle_type_id ?? '';
    const catalogCaption = catalogMap[vehicleTypeId];
    const baseTypeCaption = catalogCaption || vehicle.vehicle_type_caption || `Typ ${vehicleTypeId}`;
    const tagging = vtAliases[String(vehicleTypeId)] || baseTypeCaption;
    const stationName = building.caption || building.name || (`Gebäude ${building.id ?? ''}`).trim();
    const stationAlias = bdAliases[String(building.id)] || stationName;
    const roman = toRoman(seq);
    const repl = {
        '{id}': vehicle.id,
        '{old}': vehicle.caption || '',
        '{vehicleType}': baseTypeCaption,
        '{tagging}': tagging,
        '{stationName}': stationName,
        '{stationAlias}': stationAlias,
        '{dispatch}': '',
        '{dispatchAlias}': '',
        '{number}': seqStr,
        '{numberRoman}': roman
    };
    let out = pattern;
    Object.entries(repl).forEach(([k,v]) => { if (out.includes(k)) out = out.split(k).join(v); });
    return out.trim();
}

/** Utils: converts a positive integer to Roman numerals. Args: num Number. */
function toRoman(num) {
    const map=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let n=Number(num); if(!Number.isFinite(n)||n<=0) return '';
    let r=''; for(const [v,s] of map){ while(n>=v){r+=s;n-=v;} if(!n) break; } return r;
}

/** Utils: escapes HTML special chars to prevent injection. Args: str String. */
function escapeHtml(str){ return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/** API: loads vehicles list and caches it in LS; no args. */
async function api_call_vehicles() {
    const resp = await fetch("https://www.leitstellenspiel.de/api/vehicles");
    const data = await resp.json();
    lsSetJson(LS_KEYS.vehicles, data);
    console.log("API Call Vehicles erfolgreich");
    return data;
}
/** API: loads buildings list and caches it in LS; no args. */
async function api_call_buildings() {
    const resp = await fetch("https://www.leitstellenspiel.de/api/buildings");
    const data = await resp.json();
    lsSetJson(LS_KEYS.buildings, data);
    console.log("API Call Buildings erfolgreich");
    return data;
}

/** UI: injects style block once into the page; no args. */
function inject_styles() {
    if (document.getElementById('rv_style_block')) return;
    const styleSheet = document.createElement('style');
    styleSheet.id = 'rv_style_block';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/** Init: boots the script, injects styles, adds menu button and observers; no args. */
(function init() {
    console.log('Rename Vehicles Script geladen', new Date().toISOString());
    inject_styles();

    function tryAdd() {
        add_button_to_personal_dropdown();
        if (!document.getElementById('rename-vehicles-menu-button')) {
            setTimeout(tryAdd, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryAdd);
    } else {
        tryAdd();
    }

    const obs = new MutationObserver(() => {
        if (!document.getElementById('rename-vehicles-menu-button')) {
            add_button_to_personal_dropdown();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
})();






