import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {answerMessages, validateInput} from './logic.js';
import {getSettings, publicSettings, saveSettings} from './settings.js';
const port = Number(process.env.PORT || 3000);
const files = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8']};
async function body(req, max) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) { const e = new Error('请求过大。'); e.status = 413; throw e; } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function json(res, status, data) { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data)); }
async function api(path, options, config = getSettings()) {
  const {apiKey: key, baseURL: base} = config;
  const response = await fetch(`${base}/${path}`, {...options, headers: {...options.headers, Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(45000)});
  if (!response.ok) {
    const explanations = {400: '请求参数或接口类型不兼容，请检查模型 ID 与接口类型。', 401: '密钥无效或已撤销，请在模型设置中更新。', 403: '没有模型调用权限，请检查是否已开通该模型。', 404: '模型 ID 或服务地址不存在，请核对控制台调用示例。', 429: '额度不足或请求过于频繁，请检查方舟账户余额和限额。'};
    throw new Error(`模型服务请求失败（${response.status}）：${explanations[response.status] || '请稍后重试或检查服务配置。'}`);
  }
  return response.json();
}
export const server = http.createServer(async (req, res) => {
  try {
    const localHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!localHosts.includes(req.headers.host)) return json(res, 403, {error: '仅允许本机访问。'});
    if (req.method === 'GET' && req.url === '/api/status') return json(res, 200, publicSettings());
    if (req.method === 'POST' && req.url === '/api/settings') {
      if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, {error: '请从听题窗口保存设置。'});
      try { const saved = await saveSettings(JSON.parse((await body(req, 12000)).toString())); return json(res, 200, saved); }
      catch (e) { return json(res, e.status || 400, {error: e.code ? '本机配置保存失败，请检查文件夹写入权限。' : e.message}); }
    }
    if (req.method === 'POST' && ['/api/answer', '/api/transcribe'].includes(req.url)) {
      const config = getSettings();
      if (!config.apiKey) return json(res, 503, {error: '尚未配置模型服务。请打开左侧「模型设置」，填写 API 密钥并保存，无需重启。'});
      // Only same-origin browser requests may invoke the paid API.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, {error: '不允许跨站调用。'});
      if (req.url === '/api/answer') {
        let data;
        try { data = validateInput(JSON.parse((await body(req, 70000)).toString())); } catch (e) { return json(res, e.status || 400, {error: e.message}); }
        const messages = answerMessages(data);
        let content;
        if (config.style === 'responses') {
          const result = await api('responses', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: config.model, instructions: messages[0].content, input: messages[1].content, max_output_tokens: 4096})}, config);
          content = result.output_text || result.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
        } else {
          const result = await api('chat/completions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: config.model, messages, response_format: {type: 'json_object'}, temperature: 0.3, max_tokens: 1200})}, config);
          content = result.choices?.[0]?.message?.content;
        }
        let answer;
        try { answer = JSON.parse((content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
        catch { throw new Error('模型未返回完整的回答数据，请检查接口类型或更换模型后重试。'); }
        if (!(answer.question === null || typeof answer.question === 'string') || !(answer.answer === null || typeof answer.answer === 'string')) throw new Error('模型返回格式不正确，请重试。');
        return json(res, 200, answer);
      }
      if (new URL(config.baseURL).hostname.endsWith('volces.com')) return json(res, 422, {error: '豆包文字回答已接入；当前录音转写尚未适配火山语音服务，请先手动输入问题。'});
      const audio = await body(req, 12 * 1024 * 1024);
      if (!audio.length) return json(res, 400, {error: '未收到音频。'});
      const type = req.headers['content-type']?.split(';')[0];
      const extension = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4'}[type];
      if (!extension) return json(res, 415, {error: '不支持的音频格式。'});
      const form = new FormData(); form.append('file', new Blob([audio], {type}), `audio.${extension}`); form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1'); form.append('language', 'zh');
      const result = await api('audio/transcriptions', {method: 'POST', body: form}, config);
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
