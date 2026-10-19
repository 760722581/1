import {recordingToWav} from './audio.js';
const $ = id => document.getElementById(id);
let stream, recorder, timer, busy = false, generation = 0, speechReady = false;
function status(text) { $('status').textContent = text; }
async function post(path, body, type = 'application/json') {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': type}, body});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function lock(value) { busy = value; $('answer').disabled = value; $('capture').disabled = value || Boolean(stream); $('audio-file').disabled = value || Boolean(stream); }
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
function cleanup() { clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; $('stop').disabled = true; $('capture').disabled = busy; $('answer').disabled = busy; $('audio-file').disabled = busy; }
function stop() { if (recorder?.state === 'recording') recorder.stop(); cleanup(); }
$('capture').onclick = async () => {
  $('error').textContent = '';
  try {
    if (!speechReady) throw new Error('请先在左侧保存语音识别凭证，再采集会议音频。');
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
        const blob = await recordingToWav(new Blob(chunks, {type: mimeType}));
        if (run !== generation) return;
        const data = await post('/api/transcribe', blob, 'audio/wav');
        if (run !== generation) return;
        if (!data.text.trim()) { status('未识别到语音，请重新采集'); return; }
        $('question').value = data.text;
        await answer(data.text, run);
      } catch (e) { if (run === generation) { $('error').textContent = e.message; status('转写未完成'); } }
      finally { lock(false); }
    };
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', stop));
    recorder.start(); $('audio-file').disabled = true; $('answer').disabled = true; $('stop').disabled = false; $('capture').disabled = true; status('正在采集 · 最多 60 秒'); timer = setTimeout(stop, 60000);
  } catch (e) { cleanup(); $('error').textContent = e.message; status('尚未开始采集'); }
};
$('stop').onclick = stop;
$('answer').onclick = () => { const text = $('question').value.trim(); if (!text) { $('error').textContent = '请先输入问题。'; return; } answer(text); };
$('example').onclick = () => { $('question').value = '在半导体薄膜沉积工艺中，如果晶圆内膜厚均匀性变差，你会如何定位原因？'; };
$('clear').onclick = () => { generation++; stop(); ['question', 'role', 'background'].forEach(id => $(id).value = ''); $('results').replaceChildren(); $('error').textContent = ''; status('本次内容已清空'); };
window.addEventListener('beforeunload', () => { generation++; cleanup(); });
function fillSettings(data) {
  $('base-url').value = data.baseURL;
  $('model-id').value = data.model;
  $('api-style').value = data.style;
  $('provider').value = data.baseURL.includes('volces.com') ? 'doubao' : data.baseURL === 'https://api.openai.com/v1' ? 'openai' : 'custom';
  fillSpeechSettings(data.speech);
  $('api-key').value = '';
  $('api-key').placeholder = data.configured ? '已保存；留空保留现有密钥' : '粘贴密钥，不要发给他人';
  status(data.configured ? '密钥已配置 · 可测试连接' : '请先填写左侧模型设置');
}
$('provider').onchange = () => {
  if ($('provider').value === 'doubao') { $('base-url').value = 'https://ark.cn-beijing.volces.com/api/v3'; $('model-id').value = 'doubao-seed-2-0-lite-260428'; $('api-style').value = 'responses'; }
  if ($('provider').value === 'openai') { $('base-url').value = 'https://api.openai.com/v1'; $('model-id').value = 'gpt-4o-mini'; $('api-style').value = 'chat'; }
  $('settings-status').textContent = '请填写该服务的密钥后保存，再测试连接。';
};
$('save-settings').onclick = async () => {
  $('save-settings').disabled = true;
  try {
    const data = await post('/api/settings', JSON.stringify({apiKey: $('api-key').value, baseURL: $('base-url').value.trim(), model: $('model-id').value.trim(), style: $('api-style').value}));
    fillSettings(data); $('settings-status').textContent = '已保存到本机并立即生效。下一步点击「测试连接」。';
  } catch (e) { $('settings-status').textContent = e.message; }
  finally { $('save-settings').disabled = false; }
};
$('test-settings').onclick = async () => {
  $('test-settings').disabled = true; $('settings-status').textContent = '正在测试已保存的配置…';
  try {
    const data = await post('/api/answer', JSON.stringify({text: '请用一句话解释什么是半导体？', role: '半导体工艺工程师'}));
    if (!data.question || !data.answer) throw new Error('服务已响应，但未生成预期的测试回答。');
    $('settings-status').textContent = '连接成功：' + data.answer;
  } catch (e) { $('settings-status').textContent = e.message; }
  finally { $('test-settings').disabled = false; }
};
try { fillSettings(await (await fetch('/api/status')).json()); } catch { status('服务连接失败'); }

function showSpeechFields() {
  const volc = $('speech-provider').value === 'volcengine';
  $('speech-auth-fields').hidden = !volc;
  $('speech-legacy-fields').hidden = $('speech-auth').value !== 'legacy';
  $('speech-key-fields').hidden = $('speech-auth').value !== 'apiKey';
}
function fillSpeechSettings(data) {
  if (!data) return;
  speechReady = data.configured;
  $('speech-provider').value = data.provider;
  $('speech-auth').value = data.authMode;
  $('speech-app-id').value = data.appId;
  $('speech-resource').value = data.resourceId;
  $('speech-token').value = ''; $('speech-key').value = '';
  $('speech-token').placeholder = data.configured ? '已保存，留空保留' : '语音服务 Access Token';
  $('speech-key').placeholder = data.configured ? '已保存，留空保留' : '语音服务专用 API Key';
  $('speech-status').textContent = data.configured ? '语音凭证已配置，可采集会议音频或上传录音测试。' : '尚未配置语音凭证。文字模型设置可保留。';
  showSpeechFields();
}
$('speech-provider').onchange = showSpeechFields;
$('speech-auth').onchange = showSpeechFields;
$('save-speech').onclick = async () => {
  $('save-speech').disabled = true;
  try {
    const data = await post('/api/speech-settings', JSON.stringify({provider: $('speech-provider').value, authMode: $('speech-auth').value, appId: $('speech-app-id').value.trim(), accessToken: $('speech-token').value.trim(), apiKey: $('speech-key').value.trim(), resourceId: $('speech-resource').value.trim()}));
    fillSpeechSettings(data.speech); $('speech-status').textContent = '语音设置已保存并生效。请采集或上传一段有声音的录音测试。';
  } catch (e) { $('speech-status').textContent = e.message; }
  finally { $('save-speech').disabled = false; }
};
$('audio-file').onchange = async () => {
  const file = $('audio-file').files[0]; if (!file) return;
  const run = generation; lock(true); $('error').textContent = ''; status('正在转写上传的录音…');
  try {
    if (!speechReady) throw new Error('请先在左侧保存语音识别凭证。');
    if (file.size > 15 * 1024 * 1024) throw new Error('上传的录音请控制在 15 MB、60 秒以内。');
    const wav = await recordingToWav(file); if (run !== generation) return;
    const data = await post('/api/transcribe', wav, 'audio/wav'); if (run !== generation) return;
    if (!data.text.trim()) throw new Error('未识别到语音，请选择有人说话的录音。');
    $('question').value = data.text; await answer(data.text, run);
  } catch (e) { if (run === generation) { $('error').textContent = e.message; status('转写未完成'); } }
  finally { $('audio-file').value = ''; lock(false); }
};
