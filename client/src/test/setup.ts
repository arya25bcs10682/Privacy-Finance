import "@testing-library/jest-dom";

// Mock ResizeObserver for jsdom environment (required by Recharts ResponsiveContainer)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill Promise.try for environments/libraries (such as pdfjs-dist v4+)
if (typeof (Promise as unknown as { try?: unknown }).try !== "function") {
  (
    Promise as unknown as {
      try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
    }
  ).try = function (fn: (...args: unknown[]) => unknown, ...args: unknown[]) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}

// Ensure modern Web standards in jsdom (crypto, subtle, and Blob with arrayBuffer support)
if (typeof window !== "undefined") {
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, "crypto", {
      value: globalThis.crypto,
      writable: true,
      configurable: true,
    });
  }
}

// Polyfill Blob.prototype.arrayBuffer in jsdom if missing
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
