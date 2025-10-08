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

// Sleep Funktion in Sekunden
function sleep(s) {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}


// Definition Styles, kopiert aus Caddys Erweiterungsmanager :)
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

    // Erstelle die Lightbox
    const lightbox = document.createElement('div');
    lightbox.id = 'extension-lightbox';

    lightbox.innerHTML = `
        <div id="rename_vehicles_extension-lightbox-modal">
            <button id="rename_vehicles_extension-lightbox-close">✖<!-- https://stackoverflow.com/a/9201092 --></button>
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
    const vehicle_data = GM_getValue("vehicles_data", null);
    // console.log("Buildings from GM_getValue:", building_data);
    // console.log("Vehicles from GM_getValue:", vehicle_data);
    
    if (building_data && vehicle_data) {
        // Join the data
        const joinedData = joinVehiclesWithBuildings(vehicle_data, building_data);
        console.log("Joined data:", joinedData);
    }

        
    // Event Listener zum Schließen der Lightbox
    document.getElementById('rename_vehicles_extension-lightbox-close').addEventListener('click', () => {
        lightbox.remove();
        console.log("Lightbox geschlossen");
    });
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






