import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../public/audio.js';
import {validateWav, buildVolcRequest, parseVolcResponse, transcribeVolc, VOLC_FLASH_URL} from '../speech.js';
const samples = new Float32Array(1600).map((_, i) => Math.sin(i / 8) * 0.2);
const wav = Buffer.from(encodeWav(samples));
const legacy = {appId: 'fake-app-id', accessToken: 'fake-access-token', authMode: 'legacy', resourceId: 'volc.bigasr.auc_turbo'};
test('browser WAV encoder produces valid mono 16 kHz PCM; truncated, silent and long audio are rejected', () => {
  assert.equal(validateWav(wav).duration, 0.1);
  assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt16LE(34), 16);
  assert.throws(() => validateWav(wav.subarray(0, 80)), /不完整/);
  assert.throws(() => validateWav(Buffer.from('bad audio')), /WAV/);
  assert.throws(() => validateWav(Buffer.from(encodeWav(new Float32Array(100)))), /没有可用声音/);
  assert.throws(() => validateWav(Buffer.from(encodeWav(new Float32Array(16000 * 62).fill(0.1)))), /60 秒/);
});
test('Volcengine flash requests use dedicated credentials and real WAV bytes', () => {
  const request = buildVolcRequest(wav, legacy);
  assert.equal(request.headers['X-Api-App-Key'], legacy.appId);
  assert.equal(request.headers['X-Api-Access-Key'], legacy.accessToken);
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers['X-Api-Resource-Id'], legacy.resourceId);
  assert.match(request.headers['X-Api-Request-Id'], /^[a-f0-9-]{36}$/);
  const data = JSON.parse(request.body);
  assert.deepEqual(Buffer.from(data.audio.data, 'base64'), wav); assert.equal(data.audio.format, 'wav'); assert.equal(data.request.model_name, 'bigmodel');
  const apiKey = buildVolcRequest(wav, {...legacy, authMode: 'apiKey', apiKey: 'fake-speech-api-key'});
  assert.equal(apiKey.headers['X-Api-Key'], 'fake-speech-api-key'); assert.equal(apiKey.headers['X-Api-Access-Key'], undefined);
});
test('flash response parsing distinguishes HTTP failure, business failure, silence, and valid transcript', async () => {
  const success = new Response(JSON.stringify({result: {text: '请解释化学气相沉积。'}}), {headers: {'X-Api-Status-Code': '20000000'}});
  const result = await transcribeVolc(wav, legacy, async (url, options) => { assert.equal(url, VOLC_FLASH_URL); assert.ok(options.signal); return success; });
  assert.equal(result.text, '请解释化学气相沉积。');
  assert.deepEqual(parseVolcResponse(new Response(), {result: {text: ''}}), {text: ''});
  assert.throws(() => parseVolcResponse(new Response('', {status: 401}), {message: 'secret-do-not-show'}), error => /语音服务专用凭证/.test(error.message) && !error.message.includes('secret-do-not-show'));
  assert.throws(() => parseVolcResponse(new Response('', {headers: {'X-Api-Status-Code': '45000030'}}), {result: {text: 'must-not-pass'}}), /45000030/);
  assert.throws(() => parseVolcResponse(new Response(), {}), /未返回有效转写/);
});
