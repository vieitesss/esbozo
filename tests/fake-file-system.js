/**
 * A test double for the File System Access API's folder handles.
 *
 * Runs inside the page (`page.addInitScript({ path })`), so the editor opens a
 * "folder" without a picker and writes real text into
 * `window.__esbozoFolders[folderName]`, which the test seeds and reads back.
 * `window.__esbozoPicks` is the queue of folder names `showDirectoryPicker`
 * returns, so a test can browse one folder and then another; the last name
 * repeats, which keeps a second pick of the same folder possible.
 *
 * Nothing in the editor knows about it: it is the same `showDirectoryPicker`,
 * directory handle and writable path a browser gives. `window.__esbozoGate` can
 * hold a write open, so a test sees what the editor does while the disk is busy.
 */
(() => {
  const folders = () => {
    if (window.__esbozoFolders === undefined) {
      window.__esbozoFolders = {};
    }
    return window.__esbozoFolders;
  };

  const filesIn = (folder) => {
    const all = folders();
    if (all[folder] === undefined) {
      all[folder] = {};
    }
    return all[folder];
  };

  const notFound = (name) => {
    const error = new Error(`${name} not found`);
    error.name = 'NotFoundError';
    return error;
  };

  const fileHandle = (folder, name) => ({
    kind: 'file',
    name,
    async getFile() {
      const files = filesIn(folder);
      if (!(name in files)) {
        throw notFound(name);
      }
      return {
        name,
        size: new TextEncoder().encode(files[name]).length,
        async text() {
          return files[name];
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
          const gate = window.__esbozoGate;
          if (typeof gate === 'function') {
            await gate(name);
          }
          filesIn(folder)[name] = buffer;
        },
      };
    },
  });

  window.showDirectoryPicker = async () => {
    const picks = window.__esbozoPicks ?? [];
    if (picks.length === 0) {
      throw Object.assign(new Error('no folder to pick'), { name: 'AbortError' });
    }
    const folder = picks.length > 1 ? picks.shift() : picks[0];
    return {
      kind: 'directory',
      name: folder,
      async *values() {
        for (const name of Object.keys(filesIn(folder))) {
          yield { kind: 'file', name };
        }
      },
      async getFileHandle(name, options) {
        if (options?.create) {
          const files = filesIn(folder);
          if (!(name in files)) {
            files[name] = '';
          }
        }
        return fileHandle(folder, name);
      },
    };
  };
})();
