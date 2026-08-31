const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

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
      nodeIntegration: true
    }
  });
  win.loadFile('index.html');
}

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
