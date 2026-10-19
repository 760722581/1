import {readFile, writeFile, mkdir, rename, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const envPath = process.env.MODEL_ENV_FILE || resolve('.env');
const settingsPath = process.env.MODEL_SETTINGS_FILE || resolve('.model-settings.json');
let env = {};
try { env = parseEnv(await readFile(envPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const value = name => process.env[name]?.trim() || env[name]?.trim();
const baseURL = (value('OPENAI_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
const speechDefaults = {provider: baseURL.includes('volces.com') ? 'volcengine' : 'openai', authMode: 'legacy', appId: '', accessToken: '', apiKey: '', resourceId: 'volc.bigasr.auc_turbo'};
let settings = {
  speech: {...speechDefaults},
  apiKey: value('OPENAI_API_KEY') || '', baseURL,
  model: value('ANSWER_MODEL') || (baseURL.includes('volces.com') ? 'doubao-seed-2-0-lite-260428' : 'gpt-4o-mini'),
  style: value('ANSWER_API_STYLE') || (baseURL.includes('volces.com') ? 'responses' : 'chat')
};
try { settings = validateSettings({...settings, ...JSON.parse(await readFile(settingsPath, 'utf8'))}, false); }
catch (e) { if (e.code !== 'ENOENT') throw new Error('本机模型配置无法读取，请检查 model-settings.json 文件格式。'); }
export function getSettings() { return {...settings, speech: {...settings.speech}}; }
export function publicSettings() {
  const {apiKey, speech, ...safe} = settings;
  const {accessToken, apiKey: speechKey, ...publicSpeech} = speech;
  return {...safe, configured: Boolean(apiKey), speech: {...publicSpeech, configured: speech.provider === 'openai' ? Boolean(apiKey) : speech.authMode === 'apiKey' ? Boolean(speechKey) : Boolean(speech.appId && accessToken)}};
}
export function validateSettings(data, requireKey = true) {
  if (typeof data.apiKey !== 'string' || (requireKey && !data.apiKey.trim()) || data.apiKey.length > 4096 || /\s/.test(data.apiKey.trim())) throw new Error('请填写有效的 API 密钥，不能含有空格或换行。');
  if (typeof data.model !== 'string' || !data.model.trim() || data.model.length > 300 || /[\r\n]/.test(data.model)) throw new Error('请填写模型 ID。');
  let url;
  try { url = new URL(data.baseURL); } catch { throw new Error('服务地址格式不正确。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('服务地址必须使用 HTTPS，且不能包含密钥、用户名或查询参数。');
  if (!['chat', 'responses'].includes(data.style)) throw new Error('请选择支持的接口类型。');
  return {apiKey: data.apiKey.trim(), baseURL: url.href.replace(/\/+$/, ''), model: data.model.trim(), style: data.style, speech: validateSpeechSettings({...speechDefaults, ...data.speech}, false)};
}
export async function saveSettings(data) {
  const next = validateSettings({...settings, ...data, speech: settings.speech, apiKey: data.apiKey?.trim() || settings.apiKey});
  return persist(next);
}
async function persist(next) {
  await mkdir(dirname(settingsPath), {recursive: true});
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(next, null, 2), {mode: 0o600}); await rename(temporary, settingsPath); }
  finally { await rm(temporary, {force: true}); }
  settings = next;
  return publicSettings();
}

export function validateSpeechSettings(data, requireCredentials = true) {
  if (!['volcengine', 'openai'].includes(data.provider) || !['legacy', 'apiKey'].includes(data.authMode)) throw new Error('请选择支持的语音服务与认证方式。');
  for (const field of ['appId', 'accessToken', 'apiKey', 'resourceId']) if (typeof data[field] !== 'string' || data[field].length > 4096 || /\s/.test(data[field])) throw new Error('语音凭证和资源 ID 不能含有空格或换行。');
  if (data.provider === 'volcengine') {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(data.resourceId)) throw new Error('请填写控制台中的语音资源 ID。');
    if (requireCredentials && (data.authMode === 'apiKey' ? !data.apiKey : !data.appId || !data.accessToken)) throw new Error(data.authMode === 'apiKey' ? '请填写语音服务专用的 API Key，不能使用方舟文字密钥。' : '请填写语音服务应用的 APP ID 和 Access Token。');
  }
  return {provider: data.provider, authMode: data.authMode, appId: data.appId, accessToken: data.accessToken, apiKey: data.apiKey, resourceId: data.resourceId};
}
export async function saveSpeechSettings(data) {
  const previous = settings.speech;
  const next = validateSpeechSettings({...previous, ...data, accessToken: data.accessToken?.trim() || previous.accessToken, apiKey: data.apiKey?.trim() || previous.apiKey});
  return persist({...settings, speech: next});
}
