// https://github.com/LUFSI/framework/blob/main/src/SharedAPIStorage.js

// This is a library file that can be included to provide a consistent and intuitive
// asynchronous access to the games APIs.
// It will provide an object `sharedAPIStorage` available in a userscripts context.

// TODO: Check what happens if another tab / instance upgrades the Database
// TODO: Implement methods for all APIs of the game
// TODO: Implement methods for the LSSM APIs
// TODO: Implement error handling
// TODO: Write documentation for this file (JSDoc)
// TODO: Provide type definitions for API results
// TODO: Investigate if decorators can be used to open the DB connection
// TODO: V2-API must adjust the limits if requests are failing

// Usage:
// 1. In the userscript header include a @require rule:
// // @require https://raw.githubusercontent.com/LUFSI/framework/refs/heads/main/src/SharedAPIStorage.js
// 2. Optionally, add a hint for ESLint to avoid warnings:
// /* global sharedAPIStorage */
// 3. Interact with the API provided by sharedAPIStorage (e.g. to log all alliance members in console):
// sharedAPIStorage.getAllianceMembers().then(users => console.log(users));

// This defines the current version of the indexedDB.
// Which each change to the database structure (e.g. a table is added or removed),
// This needs to be incremented by 1.
// Within the SharedAPIStorage.#upgradDB method, this constant wil lbe used
// to determine which changes needs to be applied to the respective DB instance.
const CURRENT_DB_VERSION = 5;

// Some consants that define several commonly used durations in ms.
const ONE_MINUTE = 60 * 1000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;

// These are all tables, the indexedDB contains.
// We're using this dictionary/object to create some kind of
// lookup-table. This avoids errors through typos that were more frequent
// if we simply used the strings within the class.
// IDEs can also use this for better code completion etc.
// In TypeScript we would use an Enum here.
const TABLES = {
    lastUpdates: 'lastUpdates',
    missionTypes: 'missionTypes',
    allianceEventTypes: 'allianceEventTypes',
    userInfo: 'userinfo',
    allianceInfo: 'allianceinfo',
    settings: 'settings',
    allianceMembers: 'allianceMembers',
    vehicles: 'vehicles',
    buildings: 'buildings',
    vehicleDistances: 'vehicleDistances',
    equipments: 'equipments',
    allianceBuildings: 'allianceBuildings',
    schoolings: 'schoolings',
    allianceSchoolings: 'allianceSchoolings',
    aaoCategories: 'aaoCategories',
    aaos: 'aaos',

    // LSSM:
    // vehicleTypes
    // buildingTypes
    // schoolings
    // ranks
    // pois
};

// We're defining the indexes used within the indexedDB here.
// Indexes are used to improve lookup speed in the table.
// Again, a lookup-table to reduce errors by typos.
const INDEXES = {
    allianceMembers: {
        name: 'name',
    },
    allianceEventTypes: {
        name: 'caption',
    },
    vehicles: {
        building: 'building_id',
        vehicleType: 'vehicle_type',
    },
    buildings: {
        dispatchCenter: 'leitstelle_building_id',
        buildingType: 'building_type',
    },
    equipments: {
        equipmentType: 'equipment_type',
        buildingId: 'building_id',
    },
    allianceBuildings: {
        buildingType: 'building_type',
    },
    schoolings: {
        educationTitle: 'education_title',
        buildingId: 'building_id',
        running: 'running',
    },
    allianceSchoolings: {
        educationTitle: 'education_title',
        buildingId: 'building_id',
        running: 'running',
    },
    aaos: {
        color: 'color',
        column: 'column',
        categoryId: 'aao_category_id',
    },
};

/* global GM_info:readonly */

/**
 * @param endpoint
 */
// eslint-disable-next-line no-redeclare
const fetch = endpoint =>
    window.fetch(endpoint, {
        headers: {
            'X-LUFSI': `SharedAPIStorage (version ${CURRENT_DB_VERSION})`,
            'X-SCRIPT-NAME':
                typeof GM_info !== 'undefined' ?
                    GM_info.script.name
                :   'Unknown script',
            'X-SCRIPT-VERSION':
                typeof GM_info !== 'undefined' ?
                    GM_info.script.version
                :   'Unknown script',
        },
    });

// Let's start with some type definitions first.
// This helps us improving the overall code quality.
// Type definitions may be outsourced to their own repository or file some day.

/**
 * A mission as it occurs within the /einsaetze.json (TODO)
 * @typedef {object} Mission
 * @property {string} id - the unique ID of this mission type
 */

/**
 * A class that provides a central interface for interacting with the games API.
 * It handles everything needed in order to store the API results within an {@link https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API|indexedDB}.
 * It also makes the required network requests to fetch new API results.
 * The methods exposed to the outside allow getting a whole API as well as
 * searching through API results in an efficient way (at least for specific keys).
 * The general usage is described in the {@tutorial SharedAPIStorage} tutorial.
 */
class SharedAPIStorage {
    /**
     * @typedef {(number | string | Date | BufferSource | Array<SharedAPIStorage~IDBValidKey>)} SharedAPIStorage~IDBValidKey
     */

    /**
     * This is the name of the indexedDB instance.
     * This MUST NOT be changed at any time as otherwise
     * a new indexedDB instance would be created.
     * @type {string}
     * @private
     */
    #DB_NAME = `shared-api-storage`;

    /**
     * Within this attribute, we're storing the indexedDB instance.
     * It is set when opening the indexedDB and unset (to null) when closing.
     * If we didn't unset this on closing, the indexedDB object would live
     * permanently within the memory.
     * Additionally, closing the database allows other scripts or tabs to
     * also connect to the database, which otherwise wouldn't be possible.
     * @type {IDBDatabase | null}
     * @private
     */
    #db = null;
    /**
     * There may be multiple connections open at the same time,
     * all of them opened by the same class instance.
     * We're tracking the amount of open connections in this attribute
     * to avoid closing the indexedDB when there are still
     * unfinished transactions and connections.
     * @type {number}
     * @private
     */
    #connections = 0;
    /**
     * How many vehicles should be loaded at once with V2-API?
     * For very large accounts, the default 10k limit throws timeouts thus we need some system
     * to reduce this limit more or less intelligent
     * @type {number}
     * @private
     */
    #v2VehiclesLimit = 10_000;

    /**
     * Initializes the SharedAPIStorage and adjusts some internal state if necessary
     */
    constructor() {
        // Adjust the limit vor vehicles v2 API if the user has a large amount of vehicles.
        // This is no efficient, intelligent or dynamic algorithm, it just aims to work in most use-cases so far.
        this.getVehiclesCount().then(
            count => (this.#v2VehiclesLimit /= Math.ceil(count / 50_000))
        );
    }

    /**
     * This methods upgrades the database if required.
     * Upgrading meens changing the structure such as adding or removing tables,
     * as well as adding or removing indexes.
     * @param {IDBVersionChangeEvent} event - the version change event that contains the old version number
     * @returns {Promise<void>} a Promise that resolves once all upgrade transactions completed.
     * @private
     */
    async #upgradeDB({ oldVersion }) {
        if (!this.#db) return;

        /**
         * All transactions (creating or altering tables) are stored in this array.
         * The method returns a Promise which resolves once all transactions are completed.
         * @type {Array<Promise<void>>}
         */
        const transactions = [];

        /**
         * This function is a small helper for transactions.
         * It adds a Promise that resolves once the transaction
         * has completed to the transactions array.
         * @param {IDBTransaction} transaction - the altering transaction that must complete for the upgrade process to be marked as finished.
         * @returns {void}
         */
        const addTransaction = transaction =>
            transactions.push(
                new Promise(resolve =>
                    transaction.addEventListener('complete', () => resolve())
                )
            );

        /**
         * This function is a small helper.
         * It creates a table, optionally with a specific key path.
         * @param {string} table - the name of the table to be created
         * @param {string} [keyPath] - – the path to the attribute that should be used as a key (default: undefined = no keyPath)
         * @returns {IDBObjectStore} the created table (ObjectStore)
         */
        const createTable = (table, keyPath = undefined) =>
            this.#db.createObjectStore(table, { keyPath });
        /**
         * This function is a small helper.
         * It creates an index on a table (ObjectStore).
         * @param {IDBObjectStore} store - the table (ObjectStore) to create the index on
         * @param {string} index - the path to the attribute that should be used as an index
         * @param {boolean} unique - wether this attribute needs to be unique over all values in this table (default: true)
         * @returns {IDBIndex} the newly created index
         */
        const createIndex = (store, index, unique = true) =>
            store.createIndex(index, index, { unique });

        // In version 1, we introduced:
        // * a table for lastUpdates
        // * storing missionTypes
        // * storing the simple APIs userinfo, allianceinfo and settings
        // * storing alliance members additionally in their own table
        if (oldVersion < 1) {
            addTransaction(createTable(TABLES.lastUpdates).transaction);
            addTransaction(createTable(TABLES.missionTypes, 'id').transaction);
            addTransaction(createTable(TABLES.userInfo).transaction);
            addTransaction(createTable(TABLES.allianceInfo).transaction);
            addTransaction(createTable(TABLES.settings).transaction);
            addTransaction(
                (() => {
                    const store = createTable(TABLES.allianceMembers, 'id');
                    createIndex(store, INDEXES.allianceMembers.name);

                    return store.transaction;
                })()
            );
        }

        // In version 2, we introduced:
        // * storing allianceEventTypes
        if (oldVersion < 2) {
            addTransaction(
                (() => {
                    const store = createTable(TABLES.allianceEventTypes, 'id');
                    createIndex(store, INDEXES.allianceEventTypes.name);

                    return store.transaction;
                })()
            );
        }

        // In version 3, we introduced:
        // * storing vehicles
        // * storing buildings
        if (oldVersion < 3) {
            addTransaction(
                (() => {
                    const store = createTable(TABLES.vehicles, 'id');
                    createIndex(store, INDEXES.vehicles.building, false);
                    createIndex(store, INDEXES.vehicles.vehicleType, false);

                    return store.transaction;
                })()
            );
            addTransaction(
                (() => {
                    const store = createTable(TABLES.buildings, 'id');
                    createIndex(store, INDEXES.buildings.dispatchCenter, false);
                    createIndex(store, INDEXES.buildings.buildingType, false);

                    return store.transaction;
                })()
            );
        }

        // In version 4, we introduced:
        // * storing vehicle_distances
        if (oldVersion < 4) {
            addTransaction(
                createTable(TABLES.vehicleDistances, 'vehicle_id').transaction
            );
            addTransaction(
                (() => {
                    const store = createTable(TABLES.equipments, 'id');
                    createIndex(store, INDEXES.equipments.equipmentType, false);
                    createIndex(store, INDEXES.equipments.buildingId, false);

                    return store.transaction;
                })()
            );
        }

        // In version 5, we introduced:
        // * storing alliancebuildings
        // * storing schoolings
        // * storing allianceschoolings
        // * storing aaoCategories
        // * storing aaos
        if (oldVersion < 5) {
            addTransaction(
                (() => {
                    const store = createTable(TABLES.allianceBuildings, 'id');
                    createIndex(
                        store,
                        INDEXES.allianceBuildings.buildingType,
                        false
                    );

                    return store.transaction;
                })()
            );
            addTransaction(
                (() => {
                    const store = createTable(TABLES.schoolings, 'id');
                    createIndex(
                        store,
                        INDEXES.schoolings.educationTitle,
                        false
                    );
                    createIndex(store, INDEXES.schoolings.buildingId, false);
                    createIndex(store, INDEXES.schoolings.running, false);

                    return store.transaction;
                })()
            );
            addTransaction(
                (() => {
                    const store = createTable(TABLES.allianceSchoolings, 'id');
                    createIndex(
                        store,
                        INDEXES.allianceSchoolings.educationTitle,
                        false
                    );
                    createIndex(
                        store,
                        INDEXES.allianceSchoolings.buildingId,
                        false
                    );
                    createIndex(
                        store,
                        INDEXES.allianceSchoolings.running,
                        false
                    );

                    return store.transaction;
                })()
            );
            addTransaction(createTable(TABLES.aaoCategories).transaction);
            addTransaction(
                (() => {
                    const store = createTable(TABLES.aaos, 'id');
                    createIndex(store, INDEXES.aaos.color, false);
                    createIndex(store, INDEXES.aaos.column, false);
                    createIndex(store, INDEXES.aaos.categoryId, false);

                    return store.transaction;
                })()
            );
        }

        // This promise resolves once all transactions are completed
        await Promise.all(transactions);
    }

    /**
     * @callback SharedAPIStorage~OpenDBCallback
     * @param {IDBDatabase} db
     * @returns {(void|Promise<void>)}
     */

    /**
     * Opens a connection to the database and
     * closes it once callback has been executed.
     * Triggers a database upgrade if necessary.
     * @param {SharedAPIStorage~OpenDBCallback} callback - – a function that works with the open database connection
     * @returns {Promise<void>} a promise once the callback has been executed and the connection has been closed
     * @private
     */
    #openDB(callback) {
        this.#connections++;
        const promise =
            this.#db ?
                Promise.resolve(this.#db)
            :   new Promise((resolve, reject) => {
                    const request = indexedDB.open(
                        this.#DB_NAME,
                        CURRENT_DB_VERSION
                    );

                    let upgradeNeeded = false;

                    request.addEventListener('success', () => {
                        if (upgradeNeeded) return;
                        this.#db = request.result;
                        return resolve(request.result);
                    });
                    request.addEventListener('error', () =>
                        reject(request.error)
                    );

                    request.addEventListener('upgradeneeded', async event => {
                        upgradeNeeded = true;
                        this.#db = request.result;
                        await this.#upgradeDB(event);
                        return resolve(request.result);
                    });
                });

        return promise
            .then(async () => await callback(this.#db))
            .finally(() => this.#closeDB());
    }

    /**
     * Mark the current connection as closed.
     * Disconnects from the database if there are no more open connections.
     * @private
     */
    #closeDB() {
        this.#connections--;
        if (this.#connections > 0) return;
        if (this.#db) this.#db.close();
        this.#db = null;
    }

    /**
     * TODO: find a way for better type-safety
     * Gets a specific entry from a table.
     * If an index is provided, use the index to get the entry.
     * If the provided index is not unique, returns an array of entries.
     * @param {string} table - the table to get the entry from
     * @param {SharedAPIStorage~IDBValidKey} key - the key to search for
     * @param {string} [index] - use this index instead of the keyPath
     * @returns {Promise<*|Array<*>>} a promise that resolves to the unique entry or to an array of matching entries if a non-unique index has been passed
     * @private
     */
    #getEntry(table, key, index = undefined) {
        return this.#openDB(db => {
            const tx = db.transaction(table, 'readonly');
            const store = tx.objectStore(table);
            const storeIndex = index ? store.index(index) : null;
            const request =
                storeIndex?.unique ?
                    storeIndex.get(key)
                :   (storeIndex?.getAll(key) ?? store.get(key));
            return new Promise((resolve, reject) => {
                request.addEventListener('success', () =>
                    resolve(request.result)
                );
                request.addEventListener('error', () => reject(request.error));
            });
        });
    }

    /**
     * Gets all available keys of a table.
     * @param {string} table - the table to get the keys of
     * @returns {Promise<SharedAPIStorage~IDBValidKey[]>} - a promise that resolves to an array containing all keys of this table
     * @private
     */
    #getKeys(table) {
        return this.#openDB(db => {
            const tx = db.transaction(table, 'readonly');
            const store = tx.objectStore(table);
            const request = store.getAllKeys();
            return new Promise((resolve, reject) => {
                request.addEventListener('success', () =>
                    resolve(new Set(request.result))
                );
                request.addEventListener('error', () => reject(request.error));
            });
        });
    }

    /**
     * Gets all entries of a table as an array or object.
     * @param {string} table - the table to get the entries of
     * @param {object} [boolean] - controls wether to return the entries as an array (false) or as an object where keys are determined by the keyPath (true)
     * @param object
     * @returns {Promise<Array<*>|Object.<SharedAPIStorage~IDBValidKey, *>>} - a promise that resolves to either an array or an object representing all entries of the table
     * @private
     */
    #getTable(table, object = false) {
        return this.#openDB(db => {
            const tx = db.transaction(table, 'readonly');
            const store = tx.objectStore(table);
            if (!object) {
                const request = store.getAll();
                return new Promise((resolve, reject) => {
                    request.addEventListener('success', () =>
                        resolve(request.result)
                    );
                    request.addEventListener('error', () =>
                        reject(request.error)
                    );
                });
            }
            const request = store.openCursor();
            const result = {};
            return new Promise((resolve, reject) => {
                request.addEventListener('success', event => {
                    const cursor = event.target.result;
                    if (!cursor) return resolve(result);
                    result[cursor.key] = cursor.value;
                    cursor.continue();
                });
                request.addEventListener('error', () => reject(request.error));
            });
        });
    }

    // region lastUpdates
    /**
     * Stores the current timestamp to indicate this has been the last update of a table
     * @param {string} api - the api this last update indicates
     * @private
     */
    #setLastUpdate(api) {
        return this.#openDB(db => {
            const tx = db.transaction(TABLES.lastUpdates, 'readwrite');
            const store = tx.objectStore(TABLES.lastUpdates);
            store.put(Date.now(), api);
        });
    }

    /**
     * Returns the timestamp of the last update of a table
     * @param {string} api - the api to get the last update of
     * @returns {number} the timestamp of the last update
     * @private
     */
    #getLastUpdate(api) {
        return this.#getEntry(TABLES.lastUpdates, api).then(res => res || 0);
    }

    /**
     * @param table
     * @param treshhold
     */
    async #needsUpdate(table, treshhold) {
        return Date.now() - (await this.#getLastUpdate(table)) > treshhold;
    }
    // endregion

    // region missionTypes
    /**
     *
     */
    async #updateMissionTypes() {
        const table = TABLES.missionTypes;

        if (!(await this.#needsUpdate(table, ONE_HOUR))) return;

        return fetch('/einsaetze.json')
            .then(res => res.json())
            .then(missionTypes =>
                this.#openDB(async db => {
                    const storedMissionTypes = await this.#getKeys(table);
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    const currentMissionTypes = new Set();
                    missionTypes.forEach(missionType => {
                        currentMissionTypes.add(missionType.id);
                        store.put(missionType);
                    });
                    storedMissionTypes
                        .difference(currentMissionTypes)
                        .forEach(id => store.delete(id));
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve());
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                }).then(() => this.#setLastUpdate(table))
            );
    }

    /**
     * @param id
     * @returns {Promise<Record<string, Mission>>}
     */
    async getMissionTypes(id) {
        await this.#updateMissionTypes();

        if (void 0 !== id)
            return this.#getEntry(TABLES.missionTypes, id.toString());
        return this.#getTable(TABLES.missionTypes).then(missionTypes => {
            // indexedDB returns an array, so we need to convert it to an object
            /** @type {Record<string, Mission>} */
            const missionTypesObject = {};
            missionTypes.forEach(
                missionType =>
                    (missionTypesObject[missionType.id] = missionType)
            );
            return missionTypesObject;
        });
    }
    // endregion

    // region simple APIs (userinfo, allianceinfo, settings, aaoCategories)
    /**
     * @param table
     * @param endpoint
     */
    async #updateSimpleAPI(table, endpoint) {
        if (!(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch(`/api/${endpoint}`)
            .then(res => res.json())
            .then(result =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    Object.entries(result).forEach(([key, value]) =>
                        store.put(value, key)
                    );
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve(result));
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                }).then(result => this.#setLastUpdate(table).then(() => result))
            );
    }

    /**
     *
     */
    #updateAllianceInfo() {
        const membersTable = TABLES.allianceMembers;
        return this.#updateSimpleAPI(TABLES.allianceInfo, 'allianceinfo').then(
            result =>
                result ?
                    this.#openDB(async db => {
                        const storedUserIDs = await this.#getKeys(membersTable);
                        const tx = db.transaction(membersTable, 'readwrite');
                        const store = tx.objectStore(membersTable);
                        const currentUserIDs = new Set();
                        result.users.forEach(user => {
                            currentUserIDs.add(user.id);
                            store.put(user);
                        });
                        storedUserIDs
                            .difference(currentUserIDs)
                            .forEach(id => store.delete(id));
                        return new Promise((resolve, reject) => {
                            tx.addEventListener('complete', () => resolve());
                            tx.addEventListener('error', () =>
                                reject(tx.error)
                            );
                        });
                    })
                :   void 0
        );
    }

    /**
     * @param key
     */
    async getUserInfo(key) {
        const table = TABLES.userInfo;
        await this.#updateSimpleAPI(table, 'userinfo');
        if (key) return this.#getEntry(table, key);
        else return this.#getTable(table, true);
    }

    /**
     * @param key
     */
    async getAllianceInfo(key) {
        const table = INDEXES.allianceMembers.name;
        await this.#updateAllianceInfo();
        if (key) return this.#getEntry(table, key);
        else return this.#getTable(table, true);
    }

    /**
     * @param key
     */
    async getSettings(key) {
        const table = TABLES.settings;
        await this.#updateSimpleAPI(table, 'settings');
        if (key) return this.#getEntry(table, key);
        else return this.#getTable(table, true);
    }

    /**
     * @param nameOrId
     */
    async getAllianceMembers(nameOrId) {
        await this.#updateAllianceInfo();
        const table = TABLES.allianceMembers;
        if (typeof nameOrId === 'number')
            return this.#getEntry(table, nameOrId);
        else if (typeof nameOrId === 'string')
            return this.#getEntry(
                table,
                nameOrId,
                INDEXES.allianceMembers.name
            );
        else return this.#getTable(table);
    }

    /**
     * @param id
     */
    async getAAOCategories(id) {
        const table = TABLES.aaoCategories;
        await this.#updateSimpleAPI(table, 'v1/aao_categories');
        if (id) return this.#getEntry(table, id);
        else return this.#getTable(table, true);
    }
    // endregion

    // region AAOs
    /**
     *
     */
    async #updateAAOs() {
        const table = TABLES.aaos;
        if (!(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch(`/api/v1/aaos`)
            .then(res => res.json())
            .then(result =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    result.forEach(aao => store.put(aao));
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve(result));
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                }).then(result => this.#setLastUpdate(table).then(() => result))
            );
    }

    /**
     * @param id
     */
    async getAAOs(id) {
        const table = TABLES.aaos;
        await this.#updateAAOs();
        if (id) return this.#getEntry(table, id);
        else return this.#getTable(table, true);
    }

    /**
     * @param color
     */
    async getAAOsOfColor(color) {
        const table = TABLES.aaos;
        await this.#updateAAOs();
        return this.#getEntry(table, color, INDEXES.aaos.color);
    }

    /**
     * @param column
     */
    async getAAOsOfColumn(column) {
        const table = TABLES.aaos;
        await this.#updateAAOs();
        return this.#getEntry(table, column, INDEXES.aaos.column);
    }

    /**
     * @param category
     */
    async getAAOsOfCategory(category) {
        const table = TABLES.aaos;
        await this.#updateAAOs();
        return this.#getEntry(table, category, INDEXES.aaos.categoryId);
    }
    // endregion

    // region equipments
    /**
     *
     */
    async #updateEquipments() {
        const table = TABLES.equipments;
        if (!(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch(`/api/equipments`)
            .then(res => res.json())
            .then(result =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    result.forEach(equipment => store.put(equipment));
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve(result));
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                }).then(result => this.#setLastUpdate(table).then(() => result))
            );
    }

    /**
     * @param typeOrId
     */
    async getEquipments(typeOrId) {
        await this.#updateEquipments();
        const table = TABLES.equipments;
        if (typeof typeOrId === 'number')
            return this.#getEntry(table, typeOrId);
        else if (typeof typeOrId === 'string')
            return this.#getEntry(
                table,
                typeOrId,
                INDEXES.equipments.equipmentType
            );
        else return this.#getTable(table);
    }

    /**
     * @param id
     */
    async getEquipmentsAtBuilding(id) {
        await this.#updateEquipments();
        return this.#getEntry(
            TABLES.equipments,
            id,
            INDEXES.equipments.buildingId
        );
    }
    // endregion

    // region schoolings
    /**
     * @param alliance
     */
    async #updateSchoolings(alliance = false) {
        const table = alliance ? TABLES.allianceSchoolings : TABLES.schoolings;
        if (!(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch(`/api/${alliance ? 'alliance_' : ''}schoolings`)
            .then(res => res.json())
            .then(({ result }) =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    result.forEach(schooling => {
                        // boolean index is now allowed
                        schooling.running = +schooling.running;
                        store.put(schooling);
                    });
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve(result));
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                }).then(result => this.#setLastUpdate(table).then(() => result))
            );
    }

    /**
     *
     */
    async #updateAllianceSchoolings() {
        return this.#updateSchoolings(true);
    }

    /**
     * @param idTitleOrRunning
     */
    async getSchoolings(idTitleOrRunning) {
        await this.#updateSchoolings();
        const table = TABLES.schoolings;
        if (typeof idTitleOrRunning === 'number')
            return this.#getEntry(table, idTitleOrRunning);
        else if (typeof idTitleOrRunning === 'string')
            return this.#getEntry(
                table,
                idTitleOrRunning,
                INDEXES.schoolings.educationTitle
            );
        else if (typeof idTitleOrRunning === 'boolean')
            return this.#getEntry(
                table,
                +idTitleOrRunning, // boolean index not allowed
                INDEXES.schoolings.running
            );
        else return this.#getTable(table);
    }

    /**
     * @param id
     */
    async getSchoolingsAtBuilding(id) {
        await this.#updateSchoolings();
        return this.#getEntry(
            TABLES.schoolings,
            id,
            INDEXES.schoolings.buildingId
        );
    }

    /**
     * @param idTitleOrRunning
     */
    async getAllianceSchoolings(idTitleOrRunning) {
        await this.#updateAllianceSchoolings();
        const table = TABLES.allianceSchoolings;
        if (typeof idTitleOrRunning === 'number')
            return this.#getEntry(table, idTitleOrRunning);
        else if (typeof idTitleOrRunning === 'string')
            return this.#getEntry(
                table,
                idTitleOrRunning,
                INDEXES.allianceSchoolings.educationTitle
            );
        else if (typeof idTitleOrRunning === 'boolean')
            return this.#getEntry(
                table,
                +idTitleOrRunning, // boolean index not allowed
                INDEXES.allianceSchoolings.running
            );
        else return this.#getTable(table);
    }

    /**
     * @param id
     */
    async getAllianceSchoolingsAtBuilding(id) {
        await this.#updateAllianceSchoolings();
        return this.#getEntry(
            TABLES.allianceSchoolings,
            id,
            INDEXES.allianceSchoolings.buildingId
        );
    }
    // endregion

    // region allianceEventTypes
    /**
     *
     */
    async #updateAllianceEventTypes() {
        const table = TABLES.allianceEventTypes;

        if (!(await this.#needsUpdate(table, ONE_HOUR))) return;

        return fetch('/alliance_event_types.json')
            .then(res => res.json())
            .then(allianceEventTypes =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    allianceEventTypes.forEach(eventType =>
                        store.put(eventType)
                    );
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve());
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                })
            )
            .then(() => this.#setLastUpdate(table));
    }

    /**
     * @param nameOrId
     */
    async getAllianceEventTypes(nameOrId) {
        await this.#updateAllianceEventTypes();
        const table = TABLES.allianceEventTypes;
        if (typeof nameOrId === 'number')
            return this.#getEntry(table, nameOrId);
        else if (typeof nameOrId === 'string')
            return this.#getEntry(
                table,
                nameOrId,
                INDEXES.allianceEventTypes.name
            );
        else return this.#getTable(table);
    }
    // endregion

    // region vehicleDistances
    /**
     *
     */
    async #updateVehicleDistances() {
        const table = TABLES.vehicleDistances;

        if (!(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch('/api/v1/vehicle_distances')
            .then(res => res.json())
            .then(({ result: distances }) =>
                this.#openDB(db => {
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    store.clear();
                    distances.forEach(vehicle => store.put(vehicle));
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve());
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                })
            )
            .then(() => this.#setLastUpdate(table));
    }

    /**
     * @param id
     */
    async getVehicleDistances(id) {
        await this.#updateVehicleDistances();
        const table = TABLES.vehicleDistances;
        if (id) return this.#getEntry(table, id);
        else return this.#getTable(table, true);
    }
    // endregion

    /**
     * @param api
     * @param id
     */
    async *#fetchV2API(api, id) {
        const limit = api === 'vehicles' ? this.#v2VehiclesLimit : undefined;
        const idString = id ? `/${id}` : '';
        const limitString = limit ? `?limit=${limit}` : '';
        let nextPage = `/api/v2/${api}${idString}${limitString}`;
        while (nextPage) {
            yield await fetch(nextPage)
                .then(res => res.json())
                .then(res => {
                    nextPage = res.paging?.next_page;
                    return res.result;
                });
        }
    }

    /**
     * @param table
     * @param endpoint
     * @param idOrPartial
     * @param callback
     */
    async #updateV2API(table, endpoint, idOrPartial, callback) {
        const partial = idOrPartial === true || void 0 !== idOrPartial;
        const id = idOrPartial === true ? void 0 : idOrPartial;
        const single = void 0 !== id;
        if (!single && !(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        const storedIDs = await this.#getKeys(table);
        const currentIDs = new Set();

        for await (const result of this.#fetchV2API(endpoint, id)) {
            await this.#openDB(db => {
                const tx = db.transaction(table, 'readwrite');
                const store = tx.objectStore(table);
                if (!Array.isArray(result)) store.put(result);
                else
                    result.forEach(item => {
                        currentIDs.add(item.id);
                        store.put(item);
                    });
                return new Promise((resolve, reject) => {
                    tx.addEventListener('complete', () => resolve());
                    tx.addEventListener('error', () => reject(tx.error));
                });
            });
            callback?.(result);
        }

        if (!partial) {
            await this.#setLastUpdate(table);

            const deletedItems = storedIDs.difference(currentIDs);

            if (deletedItems.size === 0) return;

            await this.#openDB(db => {
                const tx = db.transaction(table, 'readwrite');
                const store = tx.objectStore(table);
                deletedItems.forEach(id => store.delete(id));
                return new Promise((resolve, reject) => {
                    tx.addEventListener('complete', () => resolve());
                    tx.addEventListener('error', () => reject(tx.error));
                });
            });
        }
    }

    /**
     * @param id
     * @param callback
     */
    async getVehicles(id, callback) {
        const table = TABLES.vehicles;
        await this.#updateV2API(table, 'vehicles', id, callback);

        if (void 0 !== id) return this.#getEntry(table, id);
        else return this.#getTable(table);
    }

    /**
     * @param vehicleType
     * @param callback
     */
    async getVehiclesOfType(vehicleType, callback) {
        const table = TABLES.vehicles;
        await this.#updateV2API(table, 'vehicles', undefined, callback);

        return this.#getEntry(table, vehicleType, INDEXES.vehicles.vehicleType);
    }

    /**
     * @param buildingId
     * @param callback
     */
    async getVehiclesAtBuilding(buildingId, callback) {
        const table = TABLES.vehicles;
        await this.#updateV2API(
            table,
            `buildings/${buildingId}/vehicles`,
            true,
            callback
        );

        return this.#getEntry(table, buildingId, INDEXES.vehicles.building);
    }

    /**
     *
     */
    getVehiclesCount() {
        return fetch('/api/v2/vehicles?limit=2')
            .then(res => res.json())
            .then(res => res.paging.count_total);
    }

    /**
     * @param id
     * @param alliance
     */
    async #updateBuildings(id, alliance = false) {
        const table = alliance ? TABLES.allianceBuildings : TABLES.buildings;
        const single = void 0 !== id;

        if (!single && !(await this.#needsUpdate(table, FIVE_MINUTES))) return;

        return fetch(
            `/api/${alliance ? 'alliance_' : ''}buildings${id ? `/${id}` : ''}`
        )
            .then(res => res.json())
            .then(buildings =>
                this.#openDB(async db => {
                    const storedBuildings = await this.#getKeys(table);
                    const tx = db.transaction(table, 'readwrite');
                    const store = tx.objectStore(table);
                    const currentBuildings = new Set();
                    if (single) store.put(buildings);
                    else {
                        buildings.forEach(building => {
                            currentBuildings.add(building.id);
                            store.put(building);
                        });
                        storedBuildings
                            .difference(currentBuildings)
                            .forEach(id => store.delete(id));
                    }
                    return new Promise((resolve, reject) => {
                        tx.addEventListener('complete', () => resolve());
                        tx.addEventListener('error', () => reject(tx.error));
                    });
                })
            )
            .then(() => this.#setLastUpdate(table));
    }

    /**
     * @param id
     */
    async #updateAllianceBuildings(id) {
        return this.#updateBuildings(id, true);
    }

    /**
     * @param id
     */
    async getBuildings(id) {
        await this.#updateBuildings(id);

        if (void 0 !== id) return this.#getEntry(TABLES.buildings, id);
        else return this.#getTable(TABLES.buildings);
    }

    /**
     * @param buildingType
     */
    async getBuildingsOfType(buildingType) {
        await this.#updateBuildings();

        return this.#getEntry(
            TABLES.buildings,
            buildingType,
            INDEXES.buildings.buildingType
        );
    }

    /**
     * @param dispatchCenterId
     */
    async getBuildingsOfDispatchCenter(dispatchCenterId) {
        await this.#updateBuildings();

        return this.#getEntry(
            TABLES.buildings,
            dispatchCenterId,
            INDEXES.buildings.dispatchCenter
        );
    }

    /**
     * @param id
     */
    async getAllianceBuildings(id) {
        await this.#updateAllianceBuildings(id);

        if (void 0 !== id) return this.#getEntry(TABLES.allianceBuildings, id);
        else return this.#getTable(TABLES.allianceBuildings);
    }

    /**
     * @param buildingType
     */
    async getAllianceBuildingsOfType(buildingType) {
        await this.#updateAllianceBuildings();

        return this.#getEntry(
            TABLES.allianceBuildings,
            buildingType,
            INDEXES.allianceBuildings.buildingType
        );
    }
}

this.sharedAPIStorage = new SharedAPIStorage();