const fs = require('fs');
const path = require('path');

// Configuración de Electron Forge. Antes vivía en package.json > config.forge;
// se movió aquí para poder usar el hook postPackage (que necesita código).
module.exports = {
  packagerConfig: {
    icon: './icon',
    // Se copia dentro de la app (Contents/Resources/ en Mac). Contiene los avisos
    // de copyright y el texto de las licencias de SheetJS, electron-squirrel-startup
    // y Electron. Ver también el hook postPackage de abajo.
    extraResource: ['./THIRD-PARTY-LICENSES.txt'],
    // No incluir en la app material que solo sirve para desarrollo/pruebas.
    ignore: [/^\/demo($|\/)/, /^\/\.github($|\/)/, /^\/_harness_tmp\.js$/],
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: {} },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'SebasHMora', name: 'MetaTrace' },
        prerelease: false,
        draft: true,
      },
    },
  ],
  hooks: {
    // @electron/packager deja el LICENSE de Electron (MIT) y el enorme
    // LICENSES.chromium.html (avisos completos de Chromium, Node y V8) JUNTO al
    // .app, no dentro. En el instalador de Windows eso basta porque se empaqueta
    // toda la carpeta, pero el .zip de macOS solo lleva el .app. Este hook los
    // copia dentro de la app para que viajen con cualquier distribuible.
    postPackage: async (_forgeConfig, options) => {
      for (const outDir of options.outputPaths || []) {
        let appResources = null;
        for (const entry of fs.readdirSync(outDir)) {
          if (entry.endsWith('.app')) {
            appResources = path.join(outDir, entry, 'Contents', 'Resources');
          }
        }
        if (!appResources || !fs.existsSync(appResources)) continue; // solo aplica en macOS
        for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
          const src = path.join(outDir, name);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(appResources, 'electron.' + name));
          }
        }
      }
    },
  },
};
