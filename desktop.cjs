const {app, BrowserWindow, session, desktopCapturer, dialog} = require('electron');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {parseEnv} = require('node:util');
let server;
app.setName('听题');
app.whenReady().then(async () => {
  // User secrets stay outside the packaged application and are never injected into the renderer.
  const config = app.isPackaged ? join(app.getPath('userData'), '.env') : join(__dirname, '.env');
  try { const values = parseEnv(readFileSync(config, 'utf8')); for (const [k, v] of Object.entries(values)) if (process.env[k] === undefined) process.env[k] = v; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  process.env.PORT = '0';
  ({server} = await import('./server.js'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (new URL(request.frame.url).origin !== origin) return callback({});
    try {
      const sources = await desktopCapturer.getSources({types: ['screen', 'window']});
      if (!sources.length) return callback({});
      const result = await dialog.showMessageBox({type: 'question', title: '选择会议共享来源', message: '请选择会议窗口或屏幕。Windows 将采集系统播放声音，请关闭其他有声音的程序。', buttons: [...sources.map(s => s.name), '取消'], cancelId: sources.length});
      if (result.response >= sources.length) return callback({});
      callback({video: sources[result.response], audio: 'loopback'});
    } catch { callback({}); }
  }, {useSystemPicker: true});
  const win = new BrowserWindow({width: 1200, height: 900, minWidth: 820, minHeight: 640, title: '听题 · 化工 / 材料 / 半导体', webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  await win.loadURL(origin);
}).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit(); });
app.on('window-all-closed', () => { server?.close(); app.quit(); });
