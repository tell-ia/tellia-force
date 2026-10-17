// Copy text to the clipboard. navigator.clipboard needs a secure context (https or localhost), so
// an Android WebView over http, or an older browser, falls back to a hidden textarea and
// document.execCommand("copy"). No new dependency (@capacitor/clipboard is not used).

export interface ClipboardEnv {
  writeText?: (text: string) => Promise<void>;
  /** The legacy path: put the text in a hidden field, select it and run the copy command. */
  legacyCopy: (text: string) => boolean;
}

/** True when the text reached the clipboard by either path. Never throws. */
export async function copyText(text: string, env: ClipboardEnv = browserClipboard()): Promise<boolean> {
  if (env.writeText) {
    try {
      await env.writeText(text);
      return true;
    } catch {
      // Rejected (permission, insecure context, no focus): try the legacy path.
    }
  }
  try {
    return env.legacyCopy(text);
  } catch {
    return false;
  }
}

function browserClipboard(): ClipboardEnv {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    writeText: clip?.writeText ? (t) => clip.writeText(t) : undefined,
    legacyCopy: (text) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      const active = document.activeElement as HTMLElement | null;
      try {
        ta.select();
        ta.setSelectionRange(0, text.length);
        return document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
        active?.focus?.();
      }
    },
  };
}
