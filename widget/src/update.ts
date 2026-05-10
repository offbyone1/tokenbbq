import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const AUTO_UPDATE_KEY = "tokenbbq-auto-update-checks";
const LAST_UPDATE_CHECK_KEY = "tokenbbq-last-update-check-at";
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_DELAY_MS = 30_000;

let availableUpdate: Update | null = null;
let isChecking = false;
let isInstalling = false;

export function autoUpdateChecksEnabled(): boolean {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== "0";
}

function saveAutoUpdateChecksEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_UPDATE_KEY, enabled ? "1" : "0");
}

function shouldRunAutomaticCheck(): boolean {
  const lastRaw = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
  const last = lastRaw ? Number(lastRaw) : 0;
  return !Number.isFinite(last) || Date.now() - last >= AUTO_CHECK_INTERVAL_MS;
}

function markAutomaticCheckAttempted(): void {
  localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
}

function setStatus(message: string, kind: "idle" | "success" | "error" | "loading" = "idle"): void {
  const el = document.getElementById("update-status");
  if (!el) return;
  el.textContent = message;
  el.className = `update-status ${kind}`;
}

function setInstallVisible(visible: boolean): void {
  const btn = document.getElementById("btn-install-update") as HTMLButtonElement | null;
  if (!btn) return;
  btn.hidden = !visible;
  btn.disabled = !visible || isInstalling;
}

async function checkForUpdates(manual: boolean): Promise<void> {
  if (isChecking || isInstalling) return;
  isChecking = true;
  availableUpdate = null;
  setInstallVisible(false);

  const checkBtn = document.getElementById("btn-check-updates") as HTMLButtonElement | null;
  if (checkBtn) checkBtn.disabled = true;
  if (manual) setStatus("Checking for updates...", "loading");

  try {
    const update = await check({ timeout: 15_000 });
    if (!manual) markAutomaticCheckAttempted();

    if (!update) {
      if (manual) setStatus("TokenBBQ is up to date.", "success");
      return;
    }

    availableUpdate = update;
    setStatus(`Version ${update.version} is available.`, "success");
    setInstallVisible(true);
  } catch (err) {
    if (!manual) markAutomaticCheckAttempted();
    const message = err instanceof Error ? err.message : String(err);
    if (manual) setStatus(`Update check failed: ${message}`, "error");
    console.warn("update check failed:", err);
  } finally {
    isChecking = false;
    if (checkBtn) checkBtn.disabled = false;
  }
}

async function installAvailableUpdate(): Promise<void> {
  if (!availableUpdate || isInstalling) return;
  isInstalling = true;
  setInstallVisible(true);

  const installBtn = document.getElementById("btn-install-update") as HTMLButtonElement | null;
  if (installBtn) installBtn.disabled = true;

  let downloaded = 0;
  try {
    setStatus("Downloading update...", "loading");
    await availableUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        setStatus("Downloading update...", "loading");
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        setStatus(`Downloading update... ${mb} MB`, "loading");
      } else if (event.event === "Finished") {
        setStatus("Installing update...", "loading");
      }
    });
    setStatus("Update installed. Restarting...", "success");
    await relaunch();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Update install failed: ${message}`, "error");
    console.warn("update install failed:", err);
    isInstalling = false;
    if (installBtn) installBtn.disabled = false;
  }
}

export function scheduleAutoUpdateCheck(): void {
  if (!autoUpdateChecksEnabled() || !shouldRunAutomaticCheck()) return;
  window.setTimeout(() => {
    if (!autoUpdateChecksEnabled()) return;
    void checkForUpdates(false);
  }, AUTO_CHECK_DELAY_MS);
}

export function setupUpdateControls(): void {
  const toggle = document.getElementById("auto-update-toggle") as HTMLInputElement | null;
  const checkBtn = document.getElementById("btn-check-updates") as HTMLButtonElement | null;
  const installBtn = document.getElementById("btn-install-update") as HTMLButtonElement | null;

  if (toggle) {
    toggle.checked = autoUpdateChecksEnabled();
    toggle.addEventListener("change", () => {
      saveAutoUpdateChecksEnabled(toggle.checked);
      setStatus(
        toggle.checked ? "Automatic checks are on." : "Automatic checks are off.",
        "idle",
      );
    });
  }

  checkBtn?.addEventListener("click", () => {
    void checkForUpdates(true);
  });
  installBtn?.addEventListener("click", () => {
    void installAvailableUpdate();
  });
  setInstallVisible(false);
}
