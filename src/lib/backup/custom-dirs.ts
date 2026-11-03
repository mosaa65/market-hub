/**
 * v3.1 — Custom Local Backup Directories (File System Access API)
 * ---------------------------------------------------------------
 * تسمح للمالك بإضافة مجلدات/أقراص محلية على جهازه، وتُكتب كل نسخة احتياطية
 * (يدوية أو مجدولة) تلقائياً في كل المسارات المضافة بالإضافة إلى التنزيل والسحابة.
 *
 * التخزين: قائمة أسماء المسارات تُحفظ في localStorage، و FileSystemDirectoryHandle
 * يُحفظ في IndexedDB (المتصفح لا يسمح بحفظه في localStorage) مع طلب إذن الوصول
 * عند أول كتابة في الجلسة.
 */

const DIRS_LIST_KEY = "vortex_backup_custom_dirs";
const HANDLE_DB_NAME = "vortex_backup_dir_handles";
const HANDLE_STORE = "handles";

type CustomDirMeta = { id: number; name: string; added_at: string };

let handleDbPromise: Promise<IDBDatabase> | null = null;

function openHandleDb(): Promise<IDBDatabase> {
  if (!handleDbPromise) {
    handleDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return handleDbPromise;
}

async function putHandle(id: number, handle: any): Promise<void> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getHandle(id: number): Promise<any | null> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteHandle(id: number): Promise<void> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readDirList(): CustomDirMeta[] {
  try {
    return JSON.parse(localStorage.getItem(DIRS_LIST_KEY) || "[]") as CustomDirMeta[];
  } catch {
    return [];
  }
}

function writeDirList(dirs: CustomDirMeta[]): void {
  localStorage.setItem(DIRS_LIST_KEY, JSON.stringify(dirs));
}

/** هل يدعم المتصفح File System Access API؟ */
export function customDirSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** كل المسارات المخصصة المسجلة */
export async function listCustomBackupDirectories(): Promise<CustomDirMeta[]> {
  return readDirList();
}

/** يطلب من المستخدم اختيار مجلد ويسجله كموجه نسخ */
export async function addCustomBackupDirectory(): Promise<string> {
  if (!customDirSupported()) {
    throw new Error(
      "المتصفح لا يدعم اختيار مجلدات النظام (File System Access API) — استخدم Chrome أو Edge.",
    );
  }
  // @ts-expect-error — showDirectoryPicker غير معرّف في TypeScript DOM lib بعد
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const meta: CustomDirMeta = {
    id: Date.now(),
    name: handle.name,
    added_at: new Date().toISOString(),
  };
  await putHandle(meta.id, handle);
  const dirs = readDirList();
  dirs.push(meta);
  writeDirList(dirs);
  return handle.name;
}

/** يزيل مساراً من القائمة */
export async function removeCustomBackupDirectory(id: number): Promise<void> {
  writeDirList(readDirList().filter((d) => d.id !== id));
  await deleteHandle(id);
}

/** يطلب إذن القراءة/الكتابة للمسار في بداية الجلسة (يدوي) */
async function ensurePermission(handle: any): Promise<boolean> {
  if ((await handle.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
  return (await handle.requestPermission?.({ mode: "readwrite" })) === "granted";
}

/**
 * يكتب محتوى ملف النسخة في كل المسارات المخصصة المسجلة.
 * المسارات التي يُرفض إذنها أو تفشل تُعاد في قائمة الأخطاء.
 */
export async function writeBackupToCustomDirs(
  content: string,
  fileName: string,
): Promise<{ ok: number; failed: string[] }> {
  const dirs = readDirList();
  let ok = 0;
  const failed: string[] = [];

  for (const dir of dirs) {
    try {
      const handle = await getHandle(dir.id);
      if (!handle) {
        failed.push(`${dir.name} (غير متاح)`);
        continue;
      }
      if (!(await ensurePermission(handle))) {
        failed.push(`${dir.name} (إذن مرفوض)`);
        continue;
      }
      const fileHandle = await handle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      ok++;
    } catch (e) {
      failed.push(`${dir.name} (${(e as Error).message})`);
    }
  }

  return { ok, failed };
}
