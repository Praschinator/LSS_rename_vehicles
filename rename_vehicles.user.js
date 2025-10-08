// ==UserScript==
// @name         Rename Vehicles
// @namespace    https://github.com/Praschinator
// @version      0.0.1
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

// NEW: storage key for rename pattern
const RENAME_PATTERN_STORAGE_KEY = 'rv_rename_pattern';

// NEW constants for session storage keys
const SESSION_KEYS = {
    vehicleTypeAliases: 'rv_vehicleTypeAliases',
    buildingAliases: 'rv_buildingAliases'
};

// Add new sessionStorage key for vehicle type catalog map
const SESSION_VT_CATALOG_KEY = 'rv_vehicleTypeCatalogMap';

// Utility: load/save alias maps
function loadAliasMap(key) {
    try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveAliasMap(key, obj) {
    sessionStorage.setItem(key, JSON.stringify(obj));
}

// Helper: cache vehicle type catalog map (id -> caption)
function cacheVehicleTypeCatalogMap(list) {
    if (!Array.isArray(list)) return;
    const map = {};
    list.forEach(v => {
        if (v && Number.isFinite(v.id)) map[v.id] = v.caption;
    });
    sessionStorage.setItem(SESSION_VT_CATALOG_KEY, JSON.stringify(map));
    return map;
}

function loadVehicleTypeCatalogMap() {
    try {
        const raw = sessionStorage.getItem(SESSION_VT_CATALOG_KEY);
        if (!raw) return null;
        return JSON.parse(raw) || null;
    } catch {
        return null;
    }
}

// ADD: missing cached loader
async function getVehicleTypeCatalogCached(playerVehicles = []) {
    let map = loadVehicleTypeCatalogMap();
    if (map && Object.keys(map).length) return map;
    try {
        const list = await uniqueVehicleTypes(playerVehicles);
        map = cacheVehicleTypeCatalogMap(list) || {};
        return map;
    } catch (e) {
        console.warn('getVehicleTypeCatalogCached fallback:', e);
        return {};
    }
}

// Debounce helper
function debounce(fn, wait=300) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(()=>fn(...args), wait);
    };
}

// Definition Styles, kopiert aus Caddys Erweiterungsmanager :)
const styles = `
#rename_vehicles_extension-lightbox { /* FIX id naming to match creation */
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

/* --- SETTINGS (Aliase) MODAL --- */
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

/* --- RENAME PATTERN (Umbenennungslogik) MODAL (RESTORED) --- */
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

/* --- Execute (Umbenennen) Modal --- */
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
`;

function add_button_to_personal_dropdown() {
    const profileMenu = document.querySelector('#menu_profile + .dropdown-menu');

    // Inject static HTML ////////// --> Maybe edit 'span' for icon? Currently commented out
    profileMenu.insertAdjacentHTML(
        'beforeend',
        `<li role="presentation">
            <a id="rename-vehicles-menu-button" href="#">
                <!-- <span class="glyphicon glyphicon-wrench"></span>&nbsp;&nbsp; -->
                Fahrzeuge umbenennen
            </a>
         </li>`
    );

    document.getElementById('rename-vehicles-menu-button').addEventListener('click', async e => {
        e.preventDefault();
        if (TESTING == true) {
            open_iframe();
            return;
        }
        if (TESTING == false) {
            // Call both APIs and wait until both are done, then open the iframe
            const [data_buildings, data_vehicles] = await Promise.all([
                api_call_buildings(),
                api_call_vehicles()
            ]);
            // Pass the data to open_iframe if needed
            open_iframe();
        };
    });
}

// Function to join vehicles with their building information (like pandas join)
function joinVehiclesWithBuildings(vehicles, buildings) {
    // Create a lookup map for buildings by ID for faster access
    const buildingMap = new Map();
    buildings.forEach(building => {
        buildingMap.set(building.id, building);
    });
    
    // Join vehicles with their corresponding buildings - prefix properties to avoid conflicts
    return vehicles.map(vehicle => {
        const building = buildingMap.get(vehicle.building_id);
        if (building) {
            // Create new object with prefixed properties
            const result = {};
            
            // Add all vehicle properties with "v_" prefix
            Object.keys(vehicle).forEach(key => {
                result[`v_${key}`] = vehicle[key];
            });
            
            // Add all building properties with "b_" prefix
            Object.keys(building).forEach(key => {
                result[`b_${key}`] = building[key];
            });
            
            return result;
        } else {
            // If no building found, still prefix vehicle properties for consistency
            const result = {};
            Object.keys(vehicle).forEach(key => {
                result[`v_${key}`] = vehicle[key];
            });
            return result;
        }
    });
}

function open_iframe() {
    console.log("Open Iframe NOW!");
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
        </div>
    `;
    document.body.appendChild(lightbox);

    const building_data = GM_getValue("building_data", null);
    const vehicle_data  = GM_getValue("vehicles_data", null);

    if (building_data && vehicle_data) {
        const joinedData = joinVehiclesWithBuildings(vehicle_data, building_data);
        console.log("Joined data:", joinedData);
    }

    document.getElementById('rename_vehicles_extension-lightbox-close')
        .addEventListener('click', () => lightbox.remove());

    document.getElementById('rename_vehicles_settings-button')
        .addEventListener('click', async () => {
            const b = GM_getValue("building_data", []) || [];
            const v = GM_getValue("vehicles_data", []) || [];
            await open_settings_modal(v, b);
        });

    document.getElementById('rename_vehicles_rename-button')
        .addEventListener('click', () => {
            const b = GM_getValue("building_data", []) || [];
            const v = GM_getValue("vehicles_data", []) || [];
            open_rename_modal(v, b);
        });

    // NEW: execute rename (placeholder)
    document.getElementById('rename_vehicles_execute-button')
        .addEventListener('click', () => {
            const b = GM_getValue("building_data", []) || [];
            const v = GM_getValue("vehicles_data", []) || [];
            open_execute_modal(v, b);
        });
}

// REPLACE uniqueVehicleTypes with non-caching version
async function uniqueVehicleTypes(playerVehicles = []) {
    try {
        const resp = await fetch(VEHICLE_TYPE_CATALOG_URL, { cache: 'no-store' });
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
            list = Object.entries(data).map(([k, val]) => {
                const idNum = Number(k);
                if (!Number.isFinite(idNum)) return null;
                const caption = String(val.caption || val.name || val.localized_name || k).trim();
                return { id: idNum, caption };
            }).filter(Boolean);
        }

        // Deduplicate & sort numerically
        const seen = new Set();
        list = list.filter(v => {
            if (seen.has(v.id)) return false;
            seen.add(v.id);
            return true;
        }).sort((a, b) => a.id - b.id);

        return list;
    } catch (e) {
        console.warn('Fahrzeugtypen API fehlgeschlagen – Fallback.', e);
        // Fallback from playerVehicles
        const seen = new Set();
        const fb = [];
        playerVehicles.forEach(v => {
            const raw = v.vehicle_type_id ?? v.vehicle_type ?? v.type ?? v.class ?? v.id;
            const idNum = Number(raw);
            if (!Number.isFinite(idNum) || seen.has(idNum)) return;
            seen.add(idNum);
            const caption = String(
                v.vehicle_type_caption || v.caption || v.name || raw
            ).trim();
            fb.push({ id: idNum, caption });
        });
        fb.sort((a, b) => a.id - b.id);
        return fb;
    }
}

function uniqueBuildings(buildings) {
    const arr = buildings.map(b => {
        let name = b.caption || b.name || b.building_caption || b.building_name || (b.id != null ? `Gebäude ${b.id}` : 'Unbekannt');
        name = String(name).trim();
        return { id: b.id, name };
    });
    arr.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return arr;
}

// NEW: create settings modal
async function open_settings_modal(vehicles, buildings) {
    // Prevent duplicate overlay
    if (document.getElementById('rename_vehicles_settings-overlay')) return;

    const vehicleTypes = await uniqueVehicleTypes(vehicles);
    cacheVehicleTypeCatalogMap(vehicleTypes); // NEW: store map
    const buildingList = uniqueBuildings(buildings);

    const vtAliases = loadAliasMap(SESSION_KEYS.vehicleTypeAliases);
    const bdAliases = loadAliasMap(SESSION_KEYS.buildingAliases);

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
      </div>
    `;
    document.body.appendChild(overlay);

    const vehicleContainer = overlay.querySelector('#rv_vehicle_types_container');
    vehicleTypes.forEach(vt => {
        const idStr = String(vt.id);
        const div = document.createElement('div');
        div.className = 'rename_vehicles_rv_pair';
        div.innerHTML = `
           <label title="${vt.caption}">${idStr} - ${vt.caption}</label>
           <input type="text" data-type="vehicle" data-key="${encodeURIComponent(idStr)}" value="${vtAliases[idStr] ?? ''}" placeholder="Alias...">
        `;
        vehicleContainer.appendChild(div);
    });

    const buildingContainer = overlay.querySelector('#rv_buildings_container');
    buildingList.forEach(b => {
        const div = document.createElement('div');
        div.className = 'rename_vehicles_rv_pair';
        div.innerHTML = `
           <label title="${b.name}">${b.id} - ${b.name}</label>
           <input type="text" data-type="building" data-key="${b.id}" value="${bdAliases[b.id] ?? ''}" placeholder="Alias...">
        `;
        buildingContainer.appendChild(div);
    });

    const savedIndicator = overlay.querySelector('#rv_saved_indicator');
    const showSaved = () => {
        savedIndicator.classList.add('show');
        setTimeout(()=>savedIndicator.classList.remove('show'), 1400);
    };

    const debouncedSave = () => {
        saveAliasMap(SESSION_KEYS.vehicleTypeAliases, vtAliases);
        saveAliasMap(SESSION_KEYS.buildingAliases, bdAliases);
        showSaved();
    };

    overlay.addEventListener('input', e => {
        if (e.target.matches('input[data-type]')) {
            const key = decodeURIComponent(e.target.dataset.key);
            if (e.target.dataset.type === 'vehicle') {
                if (e.target.value.trim()) vtAliases[key] = e.target.value.trim();
                else delete vtAliases[key];
            } else {
                if (e.target.value.trim()) bdAliases[key] = e.target.value.trim();
                else delete bdAliases[key];
            }
            debouncedSave();
        }
    });

    const closeFn = () => overlay.remove();
    overlay.querySelector('#rename_vehicles_settings-close').addEventListener('click', closeFn);
}

// NEW: rename pattern modal
function open_rename_modal(vehicles, buildings) {
    if (document.getElementById('rename_vehicles_rename-overlay')) return;

    // Default pattern referencing supported vars
    const defaultPattern = '{stationAlias}-{tagging}-{number}';
    const storedPattern = GM_getValue(RENAME_PATTERN_STORAGE_KEY, defaultPattern);

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
                <div id="rv_pattern_preview" title="Vorschau (zeigt Platzhalter farbig, keine echte Ersetzung)."></div>
            </div>
            <div id="rv_variable_list">
                <strong>Verfügbare Platzhalter / Available placeholders:</strong><br><br>
                <code>{id}</code> Fahrzeug-ID / Vehicle ID<br>
                <code>{old}</code> Alter Name / Old name<br>
                <code>{vehicleType}</code> Original Fahrzeugtyp Bezeichnung<br>
                <code>{tagging}</code> Alias des Fahrzeugtyps (aus Settings)<br>
                <code>{stationName}</code> Name des Gebäudes / Building name<br>
                <code>{stationAlias}</code> Alias des Gebäudes (aus Settings)<br>
                <code>{number}</code> Laufende Nummer pro Typ und Gebäude (arabisch) / sequential number<br>
                <code>{numberRoman}</code> Laufende Nummer in römischen Zahlen / Roman numerals<br>
                <hr style="margin:.6rem 0;">
                Beispiel / Example:<br>
                <code>{stationAlias}-{tagging}-{number}</code><br><br>
                Hinweis: Diese Ansicht speichert nur das Muster. Die eigentliche Umbenennungs-Logik folgt separat.
            </div>
        </div>
        <div id="rename_vehicles_rename-footer">
            <div style="display:flex;gap:.5rem;">
                <button id="rv_pattern_reset" class="btn btn-xs btn-warning">Zurücksetzen</button>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem;">
                <span id="rv_pattern_saved">Gespeichert</span>
                <button id="rv_pattern_close" class="btn btn-xs btn-success">Schließen</button>
            </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const ta = overlay.querySelector('#rv_pattern_input');
    const savedIndicator = overlay.querySelector('#rv_pattern_saved');
    const preview = overlay.querySelector('#rv_pattern_preview');

    const showSaved = () => {
        savedIndicator.classList.add('show');
        setTimeout(()=>savedIndicator.classList.remove('show'), 1200);
    };

    const updatePreview = () => {
        const val = ta.value;
        preview.innerHTML = val.replace(/\{[^}]+\}/g, m => `<span style="color:#007bff;font-weight:600;">${m}</span>`);
    };
    updatePreview();

    const debouncedSave = debounce(() => {
        GM_setValue(RENAME_PATTERN_STORAGE_KEY, ta.value);
        showSaved();
        updatePreview();
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

// --- ADD: Execute / Umbenennen Modal + Helpers ---
function open_execute_modal(vehicles, buildings) {
    if (document.getElementById('rename_vehicles_execute-overlay')) return;

    const vtAliases = loadAliasMap(SESSION_KEYS.vehicleTypeAliases);
    const bdAliases = loadAliasMap(SESSION_KEYS.buildingAliases);

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
            <div id="rv_pattern_info" title="Aktuell gespeichertes Pattern"></div>
        </div>
        <div id="rv_exec_progress"><strong>Fortschritt:</strong> Noch keine Generierung.</div>
        <div id="rv_exec_log"></div>
        <div id="rename_vehicles_execute-table-wrapper">
            <table id="rename_vehicles_execute-table">
                <thead>
                    <tr>
                        <th style="width:55px;">ID</th>
                        <th style="width:210px;">Aktueller Name</th>
                        <th style="width:200px;">Gebäude</th>
                        <th style="width:140px;">Fahrzeugtyp</th>
                        <th style="width:60px;">Nr</th>
                        <th style="width:220px;">Neuer Name (Vorschau)</th>
                        <th style="width:80px;">Status</th>
                    </tr>
                </thead>
                <tbody id="rv_exec_tbody"></tbody>
            </table>
        </div>
      </div>
    `;
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
            const vtCaption = catalogMap[vehicleTypeId] ||
                              v.vehicle_type_caption ||
                              `Typ ${vehicleTypeId}`;
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
                <td class="rv_status_cell rv_status_pending">PENDING</td>
            `;
            tbody.appendChild(tr);
        });

        const ui = {
            tbody,
            progressBox: overlay.querySelector('#rv_exec_progress'),
            log: overlay.querySelector('#rv_exec_log'),
            commitBtn: overlay.querySelector('#rv_btn_commit')
        };

        const getPattern = () => GM_getValue(RENAME_PATTERN_STORAGE_KEY, '{stationAlias}-{tagging}-{number}');
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
                    vehicle,
                    building,
                    seq,
                    seqStr,
                    vtAliases,
                    bdAliases,
                    catalogMap
                });

                const oldName = vehicle.caption || '';
                tr.querySelector('.rv_new_name').textContent = newName;
                if (newName && newName !== oldName) tr.classList.add('rv_changed');
                else tr.classList.remove('rv_changed');

                ops.push({ id: vid, old: oldName, proposed: newName });
            });

            overlay.dataset.operations = JSON.stringify(ops);
            ui.commitBtn.disabled = false;
        });

        overlay.querySelector('#rv_btn_commit').addEventListener('click', () => {
            const raw = overlay.dataset.operations;
            if (!raw) {
                ui.log && (ui.log.textContent += '\nErst generieren.');
                return;
            }
            let ops;
            try { ops = JSON.parse(raw); } catch(e){ return; }
            overlay.querySelector('#rv_btn_commit').disabled = true;
            overlay.querySelector('#rv_btn_commit').textContent = 'Läuft...';
            startCaptionRenameQueue(ops, ui);
        });
    })();
};

// --- NEW CONFIG FOR RENAME QUEUE (caption-only) ---
const RENAME_RATE_MS = 100;      // 1 request / 100 ms
const RENAME_MAX_RETRIES = 2;

// --- NEW CSS (append to styles) ---
/*
Add after the existing CSS string creation if not already appended.
You can also merge manually if you maintain styles elsewhere.
*/
(function appendRenameQueueCss(){
    const extraCss = `
#rename_vehicles_execute-table td.rv_status_cell { text-align:center; font-size:11px; font-weight:600; }
.rv_status_pending { color:#6c757d; }
.rv_status_running { color:#17a2b8; }
.rv_status_done { color:#28a745; }
.rv_status_failed { color:#dc3545; }
.rv_status_retry { color:#fd7e14; }
#rv_exec_progress {
    font-size:12px;
    padding:.2rem .5rem;
    background:#eef5ff;
    border:1px solid #cfe2ff;
    border-radius:4px;
    display:flex;
    gap:.75rem;
    flex-wrap:wrap;
    align-items:center;
}
#rv_exec_progress strong { font-weight:600; }
#rv_exec_log {
    flex:1 1 100%;
    max-height:70px;
    overflow:auto;
    background:#f8f9fa;
    border:1px solid #ddd;
    padding:.25rem .4rem;
    font-size:11px;
    line-height:1.25;
    font-family:monospace;
}
    `;
    const st = document.createElement('style');
    st.textContent = extraCss;
    document.head.appendChild(st);
})();

// --- CSRF TOKEN HELPERS (caption-only variant) ---
let GLOBAL_CSRF_TOKEN = null;

async function getCsrfToken() {
    if (GLOBAL_CSRF_TOKEN) return GLOBAL_CSRF_TOKEN;

    // Try meta tag (Rails pattern)
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="csrf_token"]');
    if (meta && meta.content) {
        GLOBAL_CSRF_TOKEN = meta.content;
        return GLOBAL_CSRF_TOKEN;
    }

    // Fallback: fetch one edit form (arbitrary first vehicle) if needed externally; left empty for now.
    return null; // Will force per-vehicle edit fetch fallback
}

async function fetchAuthTokenFromEdit(vehicleId) {
    const resp = await fetch(`/vehicles/${vehicleId}/edit`, { credentials:'same-origin' });
    if (!resp.ok) throw new Error(`Edit-Form HTTP ${resp.status}`);
    const html = await resp.text();
    const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
    if (!tokenMatch) throw new Error('authenticity_token nicht gefunden');
    return tokenMatch[1];
}

// --- SEND ONLY CAPTION (minimal form) ---
async function sendRenameCaptionOnly(vehicleId, newCaption) {
    let token = await getCsrfToken();
    if (!token) {
        // fallback fetch for this vehicle
        token = await fetchAuthTokenFromEdit(vehicleId);
    }
    const fd = new FormData();
    fd.append('utf8', '✓');
    fd.append('_method', 'patch');
    fd.append('authenticity_token', token);
    fd.append('vehicle[caption]', newCaption);
    fd.append('commit', 'Speichern');

    const resp = await fetch(`/vehicles/${vehicleId}`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin'
    });
    if (!resp.ok) throw new Error(`Rename HTTP ${resp.status}`);
    return true;
}

// --- RENAME QUEUE (sequential, 100ms spacing, caption only) ---
function startCaptionRenameQueue(operations, uiCtx) {
    const queue = operations
        .filter(o => o.proposed && o.proposed !== o.old)
        .map(o => ({ ...o, tries:0, status:'pending' }));

    if (!queue.length) {
        logExec('Keine zu ändernden Fahrzeuge.');
        return queue;
    }

    let index = 0;
    updateProgress(queue);

    function updateRowStatus(item) {
        const row = uiCtx.tbody.querySelector(`tr[data-vehicle-id="${item.id}"]`);
        if (!row) return;
        const cell = row.querySelector('.rv_status_cell');
        if (!cell) return;
        cell.textContent = item.status.toUpperCase();
        cell.className = `rv_status_cell rv_status_${item.status}`;
        if (item.status === 'done') row.classList.add('rv_done_success');
    }

    function logExec(msg) {
        if (!uiCtx.log) return;
        const line = document.createElement('div');
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        uiCtx.log.appendChild(line);
        uiCtx.log.scrollTop = uiCtx.log.scrollHeight;
    }

    function updateProgress(list) {
        const total = list.length;
        const done = list.filter(i=>i.status==='done').length;
        const failed = list.filter(i=>i.status==='failed').length;
        const running = list.filter(i=>i.status==='running').length;
        const retry = list.filter(i=>i.status==='retry').length;
        if (uiCtx.progressBox) {
            uiCtx.progressBox.innerHTML = `
                <strong>Fortschritt:</strong>
                Gesamt: ${total} |
                Fertig: ${done} |
                Läuft: ${running} |
                Retry: ${retry} |
                Fehlgeschlagen: ${failed} |
                Offen: ${total - done - failed - running - retry}
            `;
        }
    }

    async function step() {
        if (index >= queue.length) {
            logExec('Fertig – Queue abgeschlossen.');
            updateProgress(queue);
            uiCtx.commitBtn.disabled = false;
            uiCtx.commitBtn.textContent = 'Umbenennen speichern (erneut)';
            return;
        }
        const item = queue[index];
        if (item.status === 'done' || item.status === 'failed') {
            index++;
            return setTimeout(step, RENAME_RATE_MS);
        }
        item.status = 'running';
        item.tries++;
        updateRowStatus(item);
        updateProgress(queue);

        try {
            await sendRenameCaptionOnly(item.id, item.proposed);
            item.status = 'done';
            logExec(`OK: Fahrzeug ${item.id} -> "${item.proposed}"`);
        } catch (e) {
            if (item.tries <= RENAME_MAX_RETRIES) {
                item.status = 'retry';
                logExec(`Retry (${item.tries}) Fahrzeug ${item.id}: ${e.message}`);
            } else {
                item.status = 'failed';
                logExec(`FEHLER: Fahrzeug ${item.id}: ${e.message}`);
            }
        }
        updateRowStatus(item);
        updateProgress(queue);

        if (item.status === 'retry') {
            // Retry same index after delay
            return setTimeout(step, RENAME_RATE_MS);
        } else {
            index++;
            return setTimeout(step, RENAME_RATE_MS);
        }
    }

    logExec(`Starte Queue mit ${queue.length} Fahrzeug(en).`);
    step();
    return queue;
}

// --- PATCH open_execute_modal: add Status column + integrate queue ---
const _old_open_execute_modal = open_execute_modal;
open_execute_modal = function(vehicles, buildings) {
    if (document.getElementById('rename_vehicles_execute-overlay')) return;

    const vtAliases = loadAliasMap(SESSION_KEYS.vehicleTypeAliases);
    const bdAliases = loadAliasMap(SESSION_KEYS.buildingAliases);

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
            <div id="rv_pattern_info" title="Aktuell gespeichertes Pattern"></div>
        </div>
        <div id="rv_exec_progress"><strong>Fortschritt:</strong> Noch keine Generierung.</div>
        <div id="rv_exec_log"></div>
        <div id="rename_vehicles_execute-table-wrapper">
            <table id="rename_vehicles_execute-table">
                <thead>
                    <tr>
                        <th style="width:55px;">ID</th>
                        <th style="width:210px;">Aktueller Name</th>
                        <th style="width:200px;">Gebäude</th>
                        <th style="width:140px;">Fahrzeugtyp</th>
                        <th style="width:60px;">Nr</th>
                        <th style="width:220px;">Neuer Name (Vorschau)</th>
                        <th style="width:80px;">Status</th>
                    </tr>
                </thead>
                <tbody id="rv_exec_tbody"></tbody>
            </table>
        </div>
      </div>
    `;
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
            const vtCaption = catalogMap[vehicleTypeId] ||
                              v.vehicle_type_caption ||
                              `Typ ${vehicleTypeId}`;
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
                <td class="rv_status_cell rv_status_pending">PENDING</td>
            `;
            tbody.appendChild(tr);
        });

        const ui = {
            tbody,
            progressBox: overlay.querySelector('#rv_exec_progress'),
            log: overlay.querySelector('#rv_exec_log'),
            commitBtn: overlay.querySelector('#rv_btn_commit')
        };

        const getPattern = () => GM_getValue(RENAME_PATTERN_STORAGE_KEY, '{stationAlias}-{tagging}-{number}');
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
                    vehicle,
                    building,
                    seq,
                    seqStr,
                    vtAliases,
                    bdAliases,
                    catalogMap
                });

                const oldName = vehicle.caption || '';
                tr.querySelector('.rv_new_name').textContent = newName;
                if (newName && newName !== oldName) tr.classList.add('rv_changed');
                else tr.classList.remove('rv_changed');

                ops.push({ id: vid, old: oldName, proposed: newName });
            });

            overlay.dataset.operations = JSON.stringify(ops);
            ui.commitBtn.disabled = false;
        });

        overlay.querySelector('#rv_btn_commit').addEventListener('click', () => {
            const raw = overlay.dataset.operations;
            if (!raw) {
                ui.log && (ui.log.textContent += '\nErst generieren.');
                return;
            }
            let ops;
            try { ops = JSON.parse(raw); } catch(e){ return; }
            overlay.querySelector('#rv_btn_commit').disabled = true;
            overlay.querySelector('#rv_btn_commit').textContent = 'Läuft...';
            startCaptionRenameQueue(ops, ui);
        });
    })();
};

// Updated: applyRenamePattern now uses catalogMap preferentially
function applyRenamePattern(pattern, ctx) {
    if (!pattern) return '';
    const {
        vehicle, building, seq, seqStr,
        vtAliases, bdAliases, catalogMap = {}
    } = ctx;

    const vehicleTypeId = vehicle.vehicle_type ?? vehicle.vehicle_type_id ?? '';
    const catalogCaption = catalogMap[vehicleTypeId];
    const baseTypeCaption =
        catalogCaption ||
        vehicle.vehicle_type_caption ||
        `Typ ${vehicleTypeId}`;

    const tagging = vtAliases[String(vehicleTypeId)] || baseTypeCaption;

    const stationName = building.caption || building.name || (`Gebäude ${building.id ?? ''}`).trim();
    const stationAlias = bdAliases[String(building.id)] || stationName;

    const roman = toRoman(seq);

    const replacements = {
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
    Object.entries(replacements).forEach(([k, v]) => {
        if (out.includes(k)) out = out.split(k).join(v);
    });
    return out.trim();
}

function toRoman(num) {
    const map = [
        [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],
        [100,'C'],[90,'XC'],[50,'L'],[40,'XL'],
        [10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
    ];
    let n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return '';
    let res = '';
    for (const [v,s] of map) {
        while (n >= v) { res += s; n -= v; }
        if (!n) break;
    }
    return res;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

async function api_call_vehicles() {
    // https://www.leitstellenspiel.de/api/vehicles
    const response = await fetch("https://www.leitstellenspiel.de/api/vehicles");
    const data = await response.json();
    // console.log(data);
    GM_setValue("vehicles_data", data);
    console.log("API Call Vehicles erfolgreich");
    return data;
}

async function api_call_buildings() {
    // https://www.leitstellenspiel.de/api/buildings
    const response = await fetch("https://www.leitstellenspiel.de/api/buildings");
    const data = await response.json();
    // console.log(data);
    GM_setValue("building_data", data);
    console.log("API Call Buildings erfolgreich");
    return data;
}


function inject_styles() {
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

(function() { 
    console.log(`Fahrzeug Umbenenner geladen. API Calls werden beim öffnen des Fensters ausgeführt. ${new Date().toISOString()}`);
    inject_styles();
    add_button_to_personal_dropdown();
})();






