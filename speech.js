import {randomUUID} from 'node:crypto';
export const VOLC_FLASH_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export function validateWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('请上传有效的 WAV 录音。');
  let format, pcm;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const name = audio.toString('ascii', offset, offset + 4), size = audio.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > audio.length) throw new Error('录音数据不完整，请重新录制。');
    if (name === 'fmt ' && size >= 16) format = {type: audio.readUInt16LE(start), channels: audio.readUInt16LE(start + 2), rate: audio.readUInt32LE(start + 4), bits: audio.readUInt16LE(start + 14)};
    if (name === 'data') pcm = audio.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (!format || !pcm?.length || format.type !== 1 || format.channels !== 1 || format.rate !== 16000 || format.bits !== 16 || pcm.length % 2) throw new Error('录音必须为 16 kHz、单声道、16 位 PCM WAV。');
  const seconds = pcm.length / 32000;
  if (seconds > 61) throw new Error('单段录音请控制在 60 秒以内。');
  let peak = 0; for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  if (peak < 10) throw new Error('录音没有可用声音，请确认会议正在播放且已共享音频。');
  return {duration: seconds};
}
export function buildVolcRequest(audio, config) {
  validateWav(audio);
  const headers = {'Content-Type': 'application/json', 'X-Api-Resource-Id': config.resourceId, 'X-Api-Request-Id': randomUUID(), 'X-Api-Sequence': '-1'};
  if (config.authMode === 'apiKey') headers['X-Api-Key'] = config.apiKey;
  else { headers['X-Api-App-Key'] = config.appId; headers['X-Api-Access-Key'] = config.accessToken; }
  return {method: 'POST', headers, body: JSON.stringify({user: {uid: 'tingti-desktop'}, audio: {data: audio.toString('base64'), format: 'wav', rate: 16000, bits: 16, channel: 1}, request: {model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true}})};
}
export function parseVolcResponse(response, data) {
  const code = response.headers.get('X-Api-Status-Code') || data?.code;
  const requestId = response.headers.get('X-Tt-Logid') || response.headers.get('X-Api-Request-Id');
  const suffix = requestId && /^[a-zA-Z0-9_-]{1,160}$/.test(requestId) ? `（请求编号：${requestId}）` : '';
  if (!response.ok || (code !== undefined && code !== null && String(code) !== '20000000' && String(code) !== '0')) {
    const details = response.status === 401 || response.status === 403 || /^450/.test(String(code)) ? '请检查语音服务专用凭证、资源 ID，并确认已开通录音文件识别极速版；方舟文字密钥不能代替语音凭证。' : response.status === 429 ? '语音服务额度不足或请求频率受限，请检查账户额度。' : '请检查语音服务是否开通、资源 ID 和录音格式，稍后重试。';
    throw new Error(`语音识别失败（HTTP ${response.status}${code ? `，状态 ${String(code).replace(/[^0-9]/g, '').slice(0, 12)}` : ''}）：${details}${suffix}`);
  }
  const text = data?.result?.text;
  if (typeof text !== 'string') throw new Error(`语音服务未返回有效转写，请核对所开通的接口与资源 ID。${suffix}`);
  return {text};
}
export async function transcribeVolc(audio, config, fetchImpl = fetch) {
  const response = await fetchImpl(VOLC_FLASH_URL, {...buildVolcRequest(audio, config), signal: AbortSignal.timeout(60000)});
  let data; try { data = await response.json(); } catch { throw new Error('语音服务未返回有效数据，请稍后重试。'); }
  return parseVolcResponse(response, data);
}
