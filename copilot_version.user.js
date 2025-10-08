// ==UserScript==
// @name         Rename Vehicles
// @namespace    https://github.com/Praschinato
// @version      0.0.1
// @description  Rename vehicles in the game
// @author       Eli_Pra16 (forum.leitstellenspiel.de)
// @match        https://www.leitstellenspiel.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://www.example.com/download
// @updateURL    https://www.example.com/update
// @supportURL   https://www.example.com/support
// @connect      api.lss-manager.de
// @connect      leitstellenspiel.de

// @require      file://C:\Users\Elias\Documents\GitHub\LSS_rename_vehicles\rename_vehicles.user.js

// ==/UserScript==

const TESTING = true;

// NEW constants for session storage keys
const SESSION_KEYS = {
    vehicleTypeAliases: 'rv_vehicleTypeAliases',
    buildingAliases: 'rv_buildingAliases'
};

// Utility: load/save alias maps
function loadAliasMap(key) {
    try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveAliasMap(key, obj) {
    sessionStorage.setItem(key, JSON.stringify(obj));
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
#rename_vehicles_extension-lightbox-close:hover {
    background: darkred;
}
#rename_vehicles_extension-lightbox-content {
    background: transparent !important;
    border: none !important;
    text-shadow: none !important;
    box-shadow: none !important;
    color: #000 !important;
    padding: 20px;
    font-size: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}
#rename_vehicles_settings-button {
    background: #007bff;
    color: white;
    border: none;
    padding: 15px 30px;
    font-size: 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s;
}
#rename_vehicles_settings-button:hover {
    background: #0056b3;
}
#rename_vehicles_rename-button {
    background: #28a745;
    color: white;
    border: none;
    padding: 15px 30px;
    font-size: 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s;
}
#rename_vehicles_rename-button:hover {
    background: #1e7e34;
}
/* Settings overlay (second lightbox) */
#rename_vehicles_settings-overlay {
    position: fixed;
    top:0;
    left:0;
    width:100%;
    height:100%;
    background: rgba(0,0,0,0.55);
    z-index: 10050; /* above base */
    display:flex;
    justify-content:center;
    align-items:center;
    font-size:14px;
}
#rename_vehicles_settings-modal {
    background:#fff;
    width:85%;
    height:85%;
    display:flex;
    flex-direction:column;
    border:2px solid #007bff;
    position:relative;
    padding:0.75rem 1rem 1rem;
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
#rename_vehicles_settings-title {
    margin:0 0 .5rem 0;
    font-size:18px;
    font-weight:600;
    padding-right:40px;
}
#rename_vehicles_settings-body {
    flex:1;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:1rem;
    overflow:hidden;
}
.rv_column {
    display:flex;
    flex-direction:column;
    min-height:0;
    border:1px solid #ddd;
}
.rv_column h3 {
    margin:0;
    padding:.4rem .6rem;
    background:#f5f5f5;
    font-size:15px;
    border-bottom:1px solid #ddd;
}
.rv_scroll {
    flex:1;
    overflow:auto;
    padding:.5rem .75rem;
}
.rv_pair {
    display:flex;
    align-items:center;
    gap:.4rem;
    margin-bottom:.4rem;
}
.rv_pair label {
    flex:0 0 160px;
    font-weight:500;
    font-size:12px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}
.rv_pair input {
    flex:1;
    font-size:12px;
    padding:2px 4px;
}
#rename_vehicles_settings-footer {
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:.5rem .25rem 0 .25rem;
    border-top:1px solid #ddd;
    gap:.5rem;
}
#rv_export_json {
    background:#17a2b8;
    color:#fff;
    border:none;
    padding:.4rem .8rem;
    cursor:pointer;
}
#rv_export_json:hover { background:#117485; }
.alias-saved-indicator {
    font-size:12px;
    color:#28a745;
    opacity:0;
    transition:opacity .4s;
    margin-left:.5rem;
}
.alias-saved-indicator.show { opacity:1; }
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
    // FIX id to match CSS
    lightbox.id = 'rename_vehicles_extension-lightbox';

    lightbox.innerHTML = `
        <div id="rename_vehicles_extension-lightbox-modal">
            <button id="rename_vehicles_extension-lightbox-close">✖</button>
            <div id="rename_vehicles_extension-lightbox-content">
                <h1>Fahrzeug Umbenennungs Skript</h1>
                <p>Dieses Skript ermöglicht das Umbenennen von Fahrzeugen anhand von laufenden Nummern, Aliassen, oder dem zugehörigem Gebäudenamen.</p>
                <button id="rename_vehicles_settings-button">Settings</button>
                <button id="rename_vehicles_rename-button">Rename</button>
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

    // NEW: settings modal open
    document.getElementById('rename_vehicles_settings-button')
        .addEventListener('click', () => {
            const b = GM_getValue("building_data", []) || [];
            const v = GM_getValue("vehicles_data", []) || [];
            open_settings_modal(v, b);
        });
}

// NEW helpers to extract uniques
function uniqueVehicleTypes(vehicles) {
    const seen = new Set();
    const types = [];
    vehicles.forEach(v => {
        let typeRaw =
            v.vehicle_type_caption ??
            v.vehicle_type ??
            v.type ??
            v.class ??
            (v.vehicle_type_id ?? v.id); // fallback number

        if (typeRaw === undefined || typeRaw === null) return;

        // Force to string
        try { typeRaw = String(typeRaw); } catch { return; }

        const t = typeRaw.trim();
        if (!t) return;
        if (!seen.has(t)) {
            seen.add(t);
            types.push(t);
        }
    });
    types.sort((a, b) => a.localeCompare(b, 'de'));
    return types;
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
function open_settings_modal(vehicles, buildings) {
    // Prevent duplicate overlay
    if (document.getElementById('rename_vehicles_settings-overlay')) return;

    const vehicleTypes = uniqueVehicleTypes(vehicles);
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
            <div class="rv_column">
                <h3>Fahrzeugtypen (${vehicleTypes.length})</h3>
                <div class="rv_scroll" id="rv_vehicle_types_container"></div>
            </div>
            <div class="rv_column">
                <h3>Gebäude (${buildingList.length})</h3>
                <div class="rv_scroll" id="rv_buildings_container"></div>
            </div>
        </div>
        <div id="rename_vehicles_settings-footer">
            <div style="display:flex;align-items:center;">
                <strong>Status:</strong>
                <span class="alias-saved-indicator" id="rv_saved_indicator">Gespeichert</span>
            </div>
            <div style="display:flex;gap:.5rem;">
                <button id="rv_export_json" title="Alias JSON in Konsole anzeigen">Export JSON</button>
                <button id="rv_close_btn">Schließen</button>
            </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const vehicleContainer = overlay.querySelector('#rv_vehicle_types_container');
    vehicleTypes.forEach(type => {
        const div = document.createElement('div');
        div.className = 'rv_pair';
        div.innerHTML = `
           <label title="${type}">${type}</label>
           <input type="text" data-type="vehicle" data-key="${encodeURIComponent(type)}" value="${vtAliases[type] ?? ''}" placeholder="Alias...">
        `;
        vehicleContainer.appendChild(div);
    });

    const buildingContainer = overlay.querySelector('#rv_buildings_container');
    buildingList.forEach(b => {
        const div = document.createElement('div');
        div.className = 'rv_pair';
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

    const debouncedSave = debounce(() => {
        saveAliasMap(SESSION_KEYS.vehicleTypeAliases, vtAliases);
        saveAliasMap(SESSION_KEYS.buildingAliases, bdAliases);
        showSaved();
    }, 350);

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

    overlay.querySelector('#rv_export_json').addEventListener('click', () => {
        console.log('Vehicle Type Aliases:', vtAliases);
        console.log('Building Aliases:', bdAliases);
        showSaved();
    });

    const closeFn = () => overlay.remove();
    overlay.querySelector('#rename_vehicles_settings-close').addEventListener('click', closeFn);
    overlay.querySelector('#rv_close_btn').addEventListener('click', closeFn);
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






