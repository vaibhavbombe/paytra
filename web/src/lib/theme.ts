// Shared by the server layout (inline script) and the client toggle.
// Plain module (not "use client") so the server gets the real string.

export const THEME_STORAGE_KEY = "paytra-theme";

// Runs inline in <head> BEFORE first paint, so a dark-mode user never sees a
// white flash. Tiny and dependency-free; must match applyTheme() in
// theme-toggle.tsx.
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
