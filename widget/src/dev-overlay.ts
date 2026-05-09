// Optional dev overlay: when VITE_TOKENBBQ_DEV_OVERLAY is set at build time,
// load that JS module at startup and call its `mountOverlay()`. In default
// public builds the env var is undefined, so this branch is tree-shaken
// entirely and ships zero overhead. The overlay itself lives in a private
// companion repo (tokenbbq-dev) and is never published.
const overlayPath = (import.meta as ImportMeta & { env?: { VITE_TOKENBBQ_DEV_OVERLAY?: string } })
  .env?.VITE_TOKENBBQ_DEV_OVERLAY;

if (overlayPath) {
  import(/* @vite-ignore */ overlayPath)
    .then((m: { mountOverlay?: () => void | Promise<void> }) => {
      if (typeof m.mountOverlay === "function") {
        m.mountOverlay();
      }
    })
    .catch((e) => console.warn("[dev-overlay] failed to load:", e));
}
