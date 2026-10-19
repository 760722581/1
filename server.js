import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {answerMessages, validateInput} from './logic.js';
const port = Number(process.env.PORT || 3000);
const key = process.env.OPENAI_API_KEY;
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const files = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
async function body(req, max) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) { const e = new Error('请求过大。'); e.status = 413; throw e; } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function json(res, status, data) { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data)); }
async function api(path, options) {
  const response = await fetch(`${base}/${path}`, {...options, headers: {...options.headers, Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(45000)});
  if (!response.ok) { console.error('Model API status:', response.status); throw new Error(`模型服务请求失败（${response.status}），请检查服务端密钥、额度和模型配置。`); }
  return response.json();
}
export const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') return json(res, 200, {configured: Boolean(key)});
    if (req.method === 'POST' && ['/api/answer', '/api/transcribe'].includes(req.url)) {
      if (!key) return json(res, 503, {error: '尚未配置模型服务。请在服务器 .env 中填写 OPENAI_API_KEY 后重启。'});
      // Only same-origin browser requests may invoke the paid API.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, {error: '不允许跨站调用。'});
      if (req.url === '/api/answer') {
        let data;
        try { data = validateInput(JSON.parse((await body(req, 70000)).toString())); } catch (e) { return json(res, e.status || 400, {error: e.message}); }
        const result = await api('chat/completions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: process.env.ANSWER_MODEL || 'gpt-4o-mini', messages: answerMessages(data), response_format: {type: 'json_object'}, temperature: 0.3, max_tokens: 650})});
        const answer = JSON.parse(result.choices?.[0]?.message?.content || '{}');
        if (!(answer.question === null || typeof answer.question === 'string') || !(answer.answer === null || typeof answer.answer === 'string')) throw new Error('模型返回格式不正确，请重试。');
        return json(res, 200, answer);
      }
      const audio = await body(req, 12 * 1024 * 1024);
      if (!audio.length) return json(res, 400, {error: '未收到音频。'});
      const type = req.headers['content-type']?.split(';')[0];
      const extension = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4'}[type];
      if (!extension) return json(res, 415, {error: '不支持的音频格式。'});
      const form = new FormData(); form.append('file', new Blob([audio], {type}), `audio.${extension}`); form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1'); form.append('language', 'zh');
      const result = await api('audio/transcriptions', {method: 'POST', body: form});
      return json(res, 200, {text: result.text || ''});
    }
    if (req.method === 'GET' && files[req.url]) {
      const [file, type] = files[req.url]; res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); return res.end(await readFile(new URL(`public/${file}`, import.meta.url)));
    }
    json(res, 404, {error: '页面不存在。'});
  } catch (e) { json(res, 502, {error: e.name === 'TimeoutError' ? '模型服务超时，请重试。' : e.message}); }
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(`Interview assistant listening on port ${server.address().port}`);
