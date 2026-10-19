const $ = id => document.getElementById(id);
let stream, recorder, timer, busy = false, generation = 0;
function status(text) { $('status').textContent = text; }
async function post(path, body, type = 'application/json') {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': type}, body});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function lock(value) { busy = value; $('answer').disabled = value; $('capture').disabled = value || Boolean(stream); }
async function answer(text, run = generation) {
  lock(true); $('error').textContent = ''; status('正在分析问题…');
  try {
    const data = await post('/api/answer', JSON.stringify({text, role: $('role').value, background: $('background').value}));
    if (run !== generation) return;
    if (!data.question) { status('未识别到明确的面试提问'); return; }
    const container = $('results'); container.querySelector('.empty')?.remove();
    const card = document.createElement('article'); card.className = 'answer-card';
    const tag = document.createElement('small'); tag.textContent = '已提取提问 · 回答建议';
    const heading = document.createElement('h3'); heading.textContent = data.question;
    const content = document.createElement('p'); content.textContent = data.answer;
    const copy = document.createElement('button'); copy.className = 'secondary'; copy.textContent = '复制回答';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(data.answer); copy.textContent = '已复制'; } catch { $('error').textContent = '复制失败，请手动选择回答文本。'; } };
    card.append(tag, heading, content, copy); container.prepend(card); status('回答已生成');
  } catch (e) { if (run === generation) { $('error').textContent = e.message; status('请求未完成'); } }
  finally { lock(false); }
}
function cleanup() { clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; $('stop').disabled = true; $('capture').disabled = busy; $('answer').disabled = busy; }
function stop() { if (recorder?.state === 'recording') recorder.stop(); cleanup(); }
$('capture').onclick = async () => {
  $('error').textContent = '';
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持音频共享，请使用桌面 Chrome / Edge 或桌面应用。');
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: {echoCancellation: false, noiseSuppression: false}, systemAudio: 'include', selfBrowserSurface: 'exclude'});
    if (!stream.getAudioTracks().length) throw new Error('没有取得共享音频。请选择会议标签页，并勾选「分享音频」。');
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('当前浏览器不支持音频录制。');
    const chunks = [], run = generation;
    recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), {mimeType});
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      cleanup(); if (run !== generation) return;
      lock(true); status('正在转写会议音频…');
      try {
        const blob = new Blob(chunks, {type: mimeType});
        const data = await post('/api/transcribe', blob, mimeType);
        if (run !== generation) return;
        if (!data.text.trim()) { status('未识别到语音，请重新采集'); return; }
        $('question').value = data.text;
        await answer(data.text, run);
      } catch (e) { if (run === generation) { $('error').textContent = e.message; status('转写未完成'); } }
      finally { lock(false); }
    };
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', stop));
    recorder.start(); $('answer').disabled = true; $('stop').disabled = false; $('capture').disabled = true; status('正在采集 · 最多 60 秒'); timer = setTimeout(stop, 60000);
  } catch (e) { cleanup(); $('error').textContent = e.message; status('尚未开始采集'); }
};
$('stop').onclick = stop;
$('answer').onclick = () => { const text = $('question').value.trim(); if (!text) { $('error').textContent = '请先输入问题。'; return; } answer(text); };
$('example').onclick = () => { $('question').value = '在半导体薄膜沉积工艺中，如果晶圆内膜厚均匀性变差，你会如何定位原因？'; };
$('clear').onclick = () => { generation++; stop(); ['question', 'role', 'background'].forEach(id => $(id).value = ''); $('results').replaceChildren(); $('error').textContent = ''; status('本次内容已清空'); };
window.addEventListener('beforeunload', () => { generation++; cleanup(); });
try { const data = await (await fetch('/api/status')).json(); status(data.configured ? '服务已连接 · 等待提问' : '待配置模型密钥'); } catch { status('服务连接失败'); }
