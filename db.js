/* ============================================================
   db.js — IndexedDB wrapper (Promise-based)
   Two stores: "debtors" and "payments"
   ============================================================ */

const DB_NAME = "debtDB";
const DB_VERSION = 1;

let _dbPromise = null;

/** Open (or upgrade) the database once; reuse the connection. */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("debtors")) {
        db.createObjectStore("debtors", { keyPath: "id", autoIncrement: true });
      }

      if (!db.objectStoreNames.contains("payments")) {
        const payStore = db.createObjectStore("payments", {
          keyPath: "id",
          autoIncrement: true,
        });
        // Index lets us fetch payments for one debtor efficiently.
        payStore.createIndex("debtorId", "debtorId", { unique: false });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return _dbPromise;
}

/** Run a transaction and resolve with the request result. */
function tx(storeName, mode, work) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = work(store);

        transaction.oncomplete = () => resolve(req ? req.result : undefined);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

/* -------------------- Debtors -------------------- */

const DebtorsDB = {
  add: (debtor) => tx("debtors", "readwrite", (s) => s.add(debtor)),
  put: (debtor) => tx("debtors", "readwrite", (s) => s.put(debtor)),
  get: (id) => tx("debtors", "readonly", (s) => s.get(Number(id))),
  getAll: () => tx("debtors", "readonly", (s) => s.getAll()),
  delete: (id) => tx("debtors", "readwrite", (s) => s.delete(Number(id))),
};

/* -------------------- Payments -------------------- */

const PaymentsDB = {
  add: (payment) => tx("payments", "readwrite", (s) => s.add(payment)),
  put: (payment) => tx("payments", "readwrite", (s) => s.put(payment)),
  get: (id) => tx("payments", "readonly", (s) => s.get(Number(id))),
  getAll: () => tx("payments", "readonly", (s) => s.getAll()),
  delete: (id) => tx("payments", "readwrite", (s) => s.delete(Number(id))),

  /** All payments belonging to one debtor, via the debtorId index. */
  getByDebtor: (debtorId) =>
    tx("payments", "readonly", (s) =>
      s.index("debtorId").getAll(Number(debtorId))
    ),

  /** Delete every payment for a debtor (used when a debtor is removed). */
  deleteByDebtor: (debtorId) =>
    tx("payments", "readwrite", (store) => {
      const idx = store.index("debtorId");
      const range = IDBKeyRange.only(Number(debtorId));
      idx.openCursor(range).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      return null; // resolution handled by tx.oncomplete
    }),
};
