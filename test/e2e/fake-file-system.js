/**
 * A test double for the File System Access API's folder handle.
 *
 * Runs inside the page (`page.addInitScript({ path })`), so the editor opens a
 * "folder" without a picker and writes real text into `window.__esbozoFiles`,
 * which the test seeds and reads back. Nothing in the editor knows about it: it
 * is the same `showDirectoryPicker`, handle and writable path a browser gives.
 */
(() => {
  const files = () => {
    if (window.__esbozoFiles === undefined) {
      window.__esbozoFiles = {};
    }
    return window.__esbozoFiles;
  };

  const notFound = (name) => {
    const error = new Error(`${name} not found`);
    error.name = 'NotFoundError';
    return error;
  };

  const fileHandle = (name) => ({
    kind: 'file',
    name,
    async getFile() {
      const store = files();
      if (!(name in store)) {
        throw notFound(name);
      }
      return {
        name,
        async text() {
          return store[name];
        },
        async arrayBuffer() {
          return new TextEncoder().encode(store[name]).buffer;
        },
      };
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(data) {
          buffer += typeof data === 'string' ? data : new TextDecoder().decode(data);
        },
        async close() {
          files()[name] = buffer;
        },
        async abort() {},
      };
    },
  });

  window.showDirectoryPicker = async (options) => ({
    kind: 'directory',
    name: options?.startIn?.name ?? 'scenes',
    async *values() {
      for (const name of Object.keys(files())) {
        yield { kind: 'file', name };
      }
    },
    async getFileHandle(name, handleOptions) {
      if (handleOptions?.create) {
        const store = files();
        if (!(name in store)) {
          store[name] = '';
        }
      }
      return fileHandle(name);
    },
    async *entries() {
      for (const name of Object.keys(files())) {
        yield [name, fileHandle(name)];
      }
    },
  });
})();
