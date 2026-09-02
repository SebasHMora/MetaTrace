const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Maneja los eventos internos de instalación/actualización/desinstalación de Squirrel
// en Windows. Sin esto, la app nunca queda registrada en "Aplicaciones y características"
// ni crea bien su acceso directo del menú Inicio — abre normal, pero Windows nunca sabe
// que está "instalada" de verdad. En Mac esta línea no hace nada (se ignora sola).
if (require('electron-squirrel-startup')) {
  app.quit();
}

const REPO_OWNER = 'SebasHMora';
const REPO_NAME = 'MetaTrace';

function createWindow () {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    // En Windows, Electron necesita un .ico (no .icns). Con icon.ico junto a
    // icon.icns en la raíz del proyecto, esta línea recoge el correcto según el sistema.
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.icns'),
    webPreferences: {
      // La interfaz (index.html) es 100% web: usa localStorage y el DOM, nunca
      // Node. Por eso mantenemos Node fuera del render y aislamos el contexto:
      // así, si algún día se colara un XSS (p. ej. al importar un respaldo
      // manipulado), no podría tocar el sistema de archivos ni ejecutar comandos.
      // El preload expone únicamente un puente acotado para los respaldos.
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  win.loadFile('index.html');

  // Respaldo automático a disco: una vez ~60 s después de abrir y luego cada 15 min.
  // Nunca bloquea ni interrumpe la app (todo va en try/catch dentro).
  setTimeout(() => respaldoAutomatico(win), 60 * 1000);
  const backupTimer = setInterval(() => respaldoAutomatico(win), 15 * 60 * 1000);
  win.on('closed', () => clearInterval(backupTimer));

  // La ventana principal nunca debe salir de index.html.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // Enlaces externos (sitio de COMETA, correo, página de descargas) -> se abren en
  // el navegador / cliente de correo del sistema, nunca dentro de una ventana de
  // Electron. La ventana del reporte imprimible usa window.open('') con contenido
  // local generado por la app: esa sí se permite, y hereda esta misma configuración.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') return { action: 'allow' };
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// --------------------------------------------------------------------------
// Respaldos automáticos a disco. Carpeta visible en Documentos para que la
// persona usuaria pueda encontrarlos y, si hace falta, restaurar uno con el
// botón "Importar respaldo" que ya existe.
// --------------------------------------------------------------------------

const BACKUPS_DIR = path.join(app.getPath('documents'), 'MetaTrace', 'Respaldos automáticos');
const MAX_RESPALDOS = 20;

function asegurarCarpetaRespaldos() {
  try { fs.mkdirSync(BACKUPS_DIR, { recursive: true }); return true; } catch (e) { return false; }
}

function listarRespaldos() {
  try {
    return fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^metatrace_auto_[\w-]+\.json$/.test(n))
      .map(n => {
        const st = fs.statSync(path.join(BACKUPS_DIR, n));
        return { name: n, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) { return []; }
}

function escribirRespaldo(jsonString) {
  try {
    if (!jsonString || typeof jsonString !== 'string') return null;
    let datos;
    try { datos = JSON.parse(jsonString); } catch (e) { return null; }
    const hayAlgo = datos && (
      (datos.objetivosGenerales || []).length || (datos.objetivosEspecificos || []).length ||
      (datos.proyectos || []).length || (datos.actividades || []).length || (datos.responsables || []).length
    );
    if (!hayAlgo) return null;
    if (!asegurarCarpetaRespaldos()) return null;

    const previos = listarRespaldos();
    if (previos.length) {
      try {
        const ultimo = fs.readFileSync(path.join(BACKUPS_DIR, previos[0].name), 'utf-8');
        if (ultimo === jsonString) return null; // idéntico al más reciente: no duplicar
      } catch (e) { /* si no se puede leer, seguimos y escribimos igual */ }
    }

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nombre = `metatrace_auto_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
    fs.writeFileSync(path.join(BACKUPS_DIR, nombre), jsonString);

    listarRespaldos().slice(MAX_RESPALDOS).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, f.name)); } catch (e) { /* ignora */ }
    });
    return nombre;
  } catch (e) {
    console.error('No se pudo escribir el respaldo automático', e);
    return null;
  }
}

async function respaldoAutomatico(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const json = await win.webContents.executeJavaScript(
      '(function(){ try { return localStorage.getItem("cometa_data_v2"); } catch(e){ return null; } })()'
    );
    escribirRespaldo(json);
  } catch (e) { /* nunca romper la app por un respaldo */ }
}

ipcMain.handle('mt:backupsDir', () => BACKUPS_DIR);
ipcMain.handle('mt:backupNow', (_e, json) => escribirRespaldo(json));
ipcMain.handle('mt:listBackups', () => listarRespaldos());
ipcMain.handle('mt:readBackup', (_e, name) => {
  try {
    if (typeof name !== 'string' || !/^metatrace_auto_[\w-]+\.json$/.test(name)) return null;
    return fs.readFileSync(path.join(BACKUPS_DIR, name), 'utf-8');
  } catch (e) { return null; }
});
ipcMain.handle('mt:openFolder', () => {
  asegurarCarpetaRespaldos();
  shell.openPath(BACKUPS_DIR);
});

// --------------------------------------------------------------------------
// Revisor de actualizaciones (Opción B): solo avisa, nunca reemplaza nada solo.
// No requiere firma de código ni cuenta de Apple Developer.
// --------------------------------------------------------------------------

const archivoEstado = path.join(app.getPath('userData'), 'estado-actualizaciones.json');

function leerUltimaVersionAvisada() {
  try {
    const datos = JSON.parse(fs.readFileSync(archivoEstado, 'utf-8'));
    return datos.ultimaVersionAvisada || '';
  } catch (e) {
    return '';
  }
}

function guardarUltimaVersionAvisada(version) {
  try {
    fs.writeFileSync(archivoEstado, JSON.stringify({ ultimaVersionAvisada: version }));
  } catch (e) {
    console.error('No se pudo guardar el estado de actualizaciones', e);
  }
}

// Compara versiones tipo "1.2.0" o "0.2" (con o sin "v" al inicio, con 2 o 3 partes).
function compararVersiones(a, b) {
  const limpiar = (v) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pa = limpiar(a);
  const pb = limpiar(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function revisarActualizaciones() {
  const opciones = {
    hostname: 'api.github.com',
    path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    headers: { 'User-Agent': 'MetaTrace-App' }
  };

  const peticion = https.get(opciones, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        if (!release || !release.tag_name) return;

        const ultimaVersion = release.tag_name;
        const versionActual = app.getVersion();
        const yaAvisada = leerUltimaVersionAvisada();

        const hayVersionNueva = compararVersiones(ultimaVersion, versionActual) > 0;
        const yaSeAviso = compararVersiones(ultimaVersion, yaAvisada) === 0;

        if (hayVersionNueva && !yaSeAviso) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Nueva versión de MetaTrace disponible',
            message: `Hay una nueva versión disponible: ${ultimaVersion} (tienes instalada la ${versionActual}).`,
            detail: '¿Quieres abrir la página de descarga? Vas a tener que instalarla manualmente, como la primera vez.',
            buttons: ['Descargar ahora', 'Más tarde'],
            defaultId: 0,
            cancelId: 1
          }).then(resultado => {
            guardarUltimaVersionAvisada(ultimaVersion);
            if (resultado.response === 0) {
              shell.openExternal(release.html_url);
            }
          });
        }
      } catch (e) {
        console.error('No se pudo interpretar la respuesta de GitHub', e);
      }
    });
  });

  peticion.on('error', (e) => {
    console.error('No se pudo revisar si hay actualizaciones', e);
  });
}

app.whenReady().then(() => {
  createWindow();
  revisarActualizaciones();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
