/**
 * 指纹配置生成器
 * 为每个注册会话生成独立的随机浏览器指纹配置
 */

// ============== 数据池 ==============

// 固定 Windows 平台，避免与 D3D11 GPU 配置产生矛盾
const PLATFORM = { platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64' };

const CHROME_VERSIONS = [
  '131.0.6778.69', '131.0.6778.108',
  '132.0.6834.57', '132.0.6834.110',
  '133.0.6943.53', '133.0.6943.98',
  '134.0.6998.35', '134.0.6998.89',
  '135.0.7049.42', '135.0.7049.84',
  '136.0.7103.49', '136.0.7103.93',
];

const LANGUAGE_SETS = [
  ['en-US', 'en'],
  ['en-GB', 'en'],
  ['zh-CN', 'zh', 'en-US', 'en'],
  ['ja', 'en-US', 'en'],
  ['ko', 'en-US', 'en'],
  ['de', 'en-US', 'en'],
  ['fr', 'en-US', 'en'],
];

const SCREEN_CONFIGS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

// Windows D3D11 GPU 配置（去掉 Apple OpenGL，与 Win32 平台一致）
const GPU_CONFIGS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];
const TIMEZONES = [
  { name: 'America/New_York', offset: 300 },
  { name: 'America/Chicago', offset: 360 },
  { name: 'America/Denver', offset: 420 },
  { name: 'America/Los_Angeles', offset: 480 },
  { name: 'Europe/London', offset: 0 },
  { name: 'Europe/Berlin', offset: -60 },
  { name: 'Asia/Tokyo', offset: -540 },
  { name: 'Asia/Shanghai', offset: -480 },
];

const COMMON_FONTS = [
  'Arial', 'Verdana', 'Helvetica', 'Times New Roman', 'Georgia',
  'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS',
  'Palatino Linotype', 'Lucida Console', 'Tahoma', 'Lucida Sans Unicode',
  'Gill Sans', 'Century Gothic', 'Candara', 'Calibri', 'Cambria',
  'Segoe UI', 'Consolas', 'Franklin Gothic Medium', 'Book Antiqua',
  'Garamond',
];

// WebGL 扩展池（Chrome on Windows 常见组合）
const WEBGL_EXTENSION_SETS = [
  // 高端 NVIDIA
  [
    'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float',
    'EXT_float_blend', 'EXT_frag_depth', 'EXT_shader_texture_lod',
    'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
    'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'KHR_parallel_shader_compile',
    'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
    'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
    'OES_texture_half_float_linear', 'OES_vertex_array_object',
    'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc',
    'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info',
    'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
    'WEBGL_lose_context', 'WEBGL_multi_draw',
  ],
  // 中端 AMD
  [
    'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_float_blend',
    'EXT_frag_depth', 'EXT_shader_texture_lod', 'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic',
    'EXT_sRGB', 'KHR_parallel_shader_compile', 'OES_element_index_uint',
    'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
    'OES_texture_float_linear', 'OES_texture_half_float',
    'OES_texture_half_float_linear', 'OES_vertex_array_object',
    'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc',
    'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info',
    'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context',
    'WEBGL_multi_draw',
  ],
  // Intel 集显
  [
    'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_frag_depth',
    'EXT_shader_texture_lod', 'EXT_texture_compression_rgtc',
    'EXT_texture_filter_anisotropic', 'EXT_sRGB',
    'KHR_parallel_shader_compile', 'OES_element_index_uint',
    'OES_standard_derivatives', 'OES_texture_float',
    'OES_texture_float_linear', 'OES_texture_half_float',
    'OES_texture_half_float_linear', 'OES_vertex_array_object',
    'WEBGL_compressed_texture_s3tc', 'WEBGL_debug_renderer_info',
    'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context',
  ],
];

// WebGL 参数配置池（与 GPU 等级对应）
const WEBGL_PARAM_SETS = [
  // 高端
  { maxTextureSize: 16384, maxCubeMapSize: 16384, maxRenderbufferSize: 16384,
    maxViewportDims: [32767, 32767], maxVertexAttribs: 16, maxVertexUniformVectors: 4096,
    maxVaryingVectors: 30, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16,
    aliasedLineWidthRange: [1, 1], aliasedPointSizeRange: [1, 1024], maxAnisotropy: 16 },
  // 中端
  { maxTextureSize: 16384, maxCubeMapSize: 16384, maxRenderbufferSize: 16384,
    maxViewportDims: [16384, 16384], maxVertexAttribs: 16, maxVertexUniformVectors: 4096,
    maxVaryingVectors: 30, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16,
    aliasedLineWidthRange: [1, 1], aliasedPointSizeRange: [1, 1024], maxAnisotropy: 16 },
  // 低端
  { maxTextureSize: 8192, maxCubeMapSize: 8192, maxRenderbufferSize: 8192,
    maxViewportDims: [8192, 8192], maxVertexAttribs: 16, maxVertexUniformVectors: 256,
    maxVaryingVectors: 15, maxFragmentUniformVectors: 224, maxTextureImageUnits: 16,
    aliasedLineWidthRange: [1, 1], aliasedPointSizeRange: [1, 255], maxAnisotropy: 8 },
];

// 网络连接配置
const CONNECTION_CONFIGS = [
  { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false },
  { downlink: 5.6, effectiveType: '4g', rtt: 100, saveData: false },
  { downlink: 2.3, effectiveType: '4g', rtt: 150, saveData: false },
  { downlink: 1.4, effectiveType: '3g', rtt: 300, saveData: false },
  { downlink: 8.7, effectiveType: '4g', rtt: 50, saveData: false },
  { downlink: 15, effectiveType: '4g', rtt: 25, saveData: false },
];

// 媒体设备模板
const MEDIA_DEVICE_SETS = [
  // 笔记本（内置摄像头+麦克风+扬声器）
  { audioinput: 1, audiooutput: 2, videoinput: 1 },
  // 台式机（无摄像头，有麦克风+扬声器）
  { audioinput: 1, audiooutput: 1, videoinput: 0 },
  // 台式机+外接设备
  { audioinput: 2, audiooutput: 2, videoinput: 1 },
  // 笔记本+外接显示器
  { audioinput: 1, audiooutput: 3, videoinput: 1 },
];

// ============== 哈希工具 ==============

/**
 * 将字符串哈希为 0~1 之间的浮点数（确定性）
 */
function hashToNumber(str, salt = '') {
  const input = str + salt;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return (Math.abs(hash) % 10000) / 10000;
}

/**
 * 从数组中确定性选择一个元素
 */
function pickOne(arr, uuid, salt = '') {
  const idx = Math.floor(hashToNumber(uuid, salt) * arr.length);
  return arr[idx];
}

/**
 * 从数组中确定性选择 n 个不重复元素
 */
function pickN(arr, n, uuid, salt = '') {
  const shuffled = [...arr];
  // Fisher-Yates with deterministic seed
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(hashToNumber(uuid, salt + i) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ============== IP 地理位置 → 指纹映射 ==============

const GEO_FINGERPRINT_MAP = {
  'US': { timezones: ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles'], langs: [['en-US','en']] },
  'GB': { timezones: ['Europe/London'], langs: [['en-GB','en']] },
  'DE': { timezones: ['Europe/Berlin'], langs: [['de','en-US','en']] },
  'JP': { timezones: ['Asia/Tokyo'], langs: [['ja','en-US','en']] },
  'CN': { timezones: ['Asia/Shanghai'], langs: [['zh-CN','zh','en-US','en']] },
  'KR': { timezones: ['Asia/Seoul'], langs: [['ko','en-US','en']] },
  'FR': { timezones: ['Europe/Paris'], langs: [['fr','en-US','en']] },
  'CA': { timezones: ['America/Toronto','America/Vancouver'], langs: [['en-US','en'],['fr','en-US','en']] },
  'AU': { timezones: ['Australia/Sydney','Australia/Melbourne'], langs: [['en-AU','en']] },
  'IN': { timezones: ['Asia/Kolkata'], langs: [['en-IN','en']] },
  'BR': { timezones: ['America/Sao_Paulo'], langs: [['pt-BR','pt','en-US','en']] },
  'RU': { timezones: ['Europe/Moscow'], langs: [['ru','en-US','en']] },
  'IT': { timezones: ['Europe/Rome'], langs: [['it','en-US','en']] },
  'ES': { timezones: ['Europe/Madrid'], langs: [['es','en-US','en']] },
  'NL': { timezones: ['Europe/Amsterdam'], langs: [['nl','en-US','en']] },
  'SG': { timezones: ['Asia/Singapore'], langs: [['en-SG','en','zh-CN','zh']] },
  'HK': { timezones: ['Asia/Hong_Kong'], langs: [['zh-HK','zh','en-US','en']] },
  'TW': { timezones: ['Asia/Taipei'], langs: [['zh-TW','zh','en-US','en']] },
  'TH': { timezones: ['Asia/Bangkok'], langs: [['th','en-US','en']] },
  'VN': { timezones: ['Asia/Ho_Chi_Minh'], langs: [['vi','en-US','en']] },
  'PH': { timezones: ['Asia/Manila'], langs: [['en-PH','en']] },
  'ID': { timezones: ['Asia/Jakarta'], langs: [['id','en-US','en']] },
  'MY': { timezones: ['Asia/Kuala_Lumpur'], langs: [['ms','en-US','en']] },
  'SE': { timezones: ['Europe/Stockholm'], langs: [['sv','en-US','en']] },
  'PL': { timezones: ['Europe/Warsaw'], langs: [['pl','en-US','en']] },
  'TR': { timezones: ['Europe/Istanbul'], langs: [['tr','en-US','en']] },
  'UA': { timezones: ['Europe/Kiev'], langs: [['uk','en-US','en']] },
  'MX': { timezones: ['America/Mexico_City'], langs: [['es-MX','es','en-US','en']] },
  'AR': { timezones: ['America/Argentina/Buenos_Aires'], langs: [['es-AR','es','en-US','en']] },
  'CL': { timezones: ['America/Santiago'], langs: [['es-CL','es','en-US','en']] },
  'CO': { timezones: ['America/Bogota'], langs: [['es-CO','es','en-US','en']] },
  'ZA': { timezones: ['Africa/Johannesburg'], langs: [['en-ZA','en']] },
  'AE': { timezones: ['Asia/Dubai'], langs: [['ar','en-US','en']] },
  'SA': { timezones: ['Asia/Riyadh'], langs: [['ar','en-US','en']] },
  'IL': { timezones: ['Asia/Jerusalem'], langs: [['he','en-US','en']] },
  'NO': { timezones: ['Europe/Oslo'], langs: [['nb','en-US','en']] },
  'DK': { timezones: ['Europe/Copenhagen'], langs: [['da','en-US','en']] },
  'FI': { timezones: ['Europe/Helsinki'], langs: [['fi','en-US','en']] },
  'CZ': { timezones: ['Europe/Prague'], langs: [['cs','en-US','en']] },
  'AT': { timezones: ['Europe/Vienna'], langs: [['de-AT','de','en-US','en']] },
  'CH': { timezones: ['Europe/Zurich'], langs: [['de-CH','de','fr','en-US','en']] },
  'PT': { timezones: ['Europe/Lisbon'], langs: [['pt-PT','pt','en-US','en']] },
  'IE': { timezones: ['Europe/Dublin'], langs: [['en-IE','en']] },
  'NZ': { timezones: ['Pacific/Auckland'], langs: [['en-NZ','en']] },
  'BD': { timezones: ['Asia/Dhaka'], langs: [['bn','en-US','en']] },
  'PK': { timezones: ['Asia/Karachi'], langs: [['ur','en-US','en']] },
};

// 时区名称 → offset 映射（用于指纹配置）
// 动态计算当前 offset，自动适配夏令时
function getTimezoneOffset(tzName) {
  try {
    const now = new Date();
    // 用 Intl 获取目标时区的本地时间字符串，再计算与 UTC 的差值
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: tzName });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    // getTimezoneOffset 返回的是 UTC - local（分钟），正值表示西半球
    return Math.round((utcDate - tzDate) / 60000);
  } catch (_) {
    return 0;
  }
}

// 支持的时区名称列表（用于校验）
const SUPPORTED_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'America/Vancouver',
  'America/Sao_Paulo', 'America/Mexico_City',
  'America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Bogota',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'Europe/Rome', 'Europe/Madrid', 'Europe/Amsterdam',
  'Europe/Moscow', 'Europe/Stockholm', 'Europe/Warsaw',
  'Europe/Istanbul', 'Europe/Kiev', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Prague',
  'Europe/Vienna', 'Europe/Zurich', 'Europe/Lisbon', 'Europe/Dublin',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Taipei',
  'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Manila',
  'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Asia/Kolkata',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Jerusalem',
  'Asia/Dhaka', 'Asia/Karachi',
  'Australia/Sydney', 'Australia/Melbourne',
  'Africa/Johannesburg',
  'Pacific/Auckland',
];

// ============== 主函数 ==============
/**
 * 生成指纹配置
 * 使用 uuid 作为种子，保证同一会话内指纹一致
 * @param {string} uuid 可选的种子 UUID
 * @param {object} geoInfo 可选的 IP 地理位置信息 { countryCode, timezone }
 */
export function generateFingerprintConfig(uuid, geoInfo) {
  if (!uuid) {
    uuid = crypto.randomUUID();
  }

  const chromeVer = pickOne(CHROME_VERSIONS, uuid, 'chrome');

  // 如果有 geoInfo，使用 IP 地理位置匹配时区和语言
  let langs, tz;
  if (geoInfo && geoInfo.countryCode && GEO_FINGERPRINT_MAP[geoInfo.countryCode]) {
    const geoMap = GEO_FINGERPRINT_MAP[geoInfo.countryCode];

    // 优先使用 API 返回的精确时区，否则从映射表随机选
    let tzName;
    if (geoInfo.timezone && SUPPORTED_TIMEZONES.includes(geoInfo.timezone)) {
      tzName = geoInfo.timezone;
    } else {
      tzName = pickOne(geoMap.timezones, uuid, 'geoTz');
    }
    const tzOffset = getTimezoneOffset(tzName);
    tz = { name: tzName, offset: tzOffset };

    langs = pickOne(geoMap.langs, uuid, 'geoLang');
  } else {
    // 回退到原有随机选择逻辑
    langs = pickOne(LANGUAGE_SETS, uuid, 'lang');
    const tzBase = pickOne(TIMEZONES, uuid, 'tz');
    tz = { name: tzBase.name, offset: getTimezoneOffset(tzBase.name) };
  }

  const screenCfg = pickOne(SCREEN_CONFIGS, uuid, 'screen');
  const gpuCfg = pickOne(GPU_CONFIGS, uuid, 'gpu');

  // hardwareConcurrency: 2, 4, 8, 12, 16
  const cores = [2, 4, 8, 12, 16];
  const hardwareConcurrency = pickOne(cores, uuid, 'cores');

  // deviceMemory: 2, 4, 8, 16
  const memOptions = [2, 4, 8, 16];
  const deviceMemory = pickOne(memOptions, uuid, 'mem');

  // maxTouchPoints: 0 for desktop
  const maxTouchPoints = 0;

  // devicePixelRatio: 常见 Windows 缩放比例
  const dprOptions = [1, 1, 1, 1.25, 1.5, 2];
  const devicePixelRatio = pickOne(dprOptions, uuid, 'dpr');

  // 构建 User-Agent（固定 Windows）
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;

  // Canvas 噪声 -2~+2
  const noiseR = Math.floor(hashToNumber(uuid, 'cR') * 5) - 2;
  const noiseG = Math.floor(hashToNumber(uuid, 'cG') * 5) - 2;
  const noiseB = Math.floor(hashToNumber(uuid, 'cB') * 5) - 2;

  // WebGL 像素噪声
  const noisePixel = Math.floor(hashToNumber(uuid, 'glP') * 5) - 2;

  // Audio 噪声级别
  const audioNoise = hashToNumber(uuid, 'audio') * 0.0001;

  // 字体子集 12-18 种
  const fontCount = 12 + Math.floor(hashToNumber(uuid, 'fontN') * 7);
  const allowedFonts = pickN(COMMON_FONTS, fontCount, uuid, 'fonts');

  // WebGL 扩展和参数（按 GPU 等级选择）
  const gpuIdx = GPU_CONFIGS.indexOf(gpuCfg);
  let gpuTier; // 0=高端, 1=中端, 2=低端
  if (gpuIdx <= 3) gpuTier = 0;      // NVIDIA
  else if (gpuIdx <= 5) gpuTier = 1;  // AMD
  else gpuTier = 2;                    // Intel
  const webglExtensions = WEBGL_EXTENSION_SETS[gpuTier];
  const webglParams = WEBGL_PARAM_SETS[gpuTier];

  // ClientRects 亚像素噪声
  const clientRectsNoiseX = (hashToNumber(uuid, 'crX') - 0.5) * 0.002;
  const clientRectsNoiseY = (hashToNumber(uuid, 'crY') - 0.5) * 0.002;

  // 网络连接
  const connectionCfg = pickOne(CONNECTION_CONFIGS, uuid, 'conn');

  // 媒体设备
  const mediaDeviceCfg = pickOne(MEDIA_DEVICE_SETS, uuid, 'media');

  // Performance.now 精度降低（四舍五入到 N 微秒）
  const perfPrecision = pickOne([0.1, 0.05, 0.025, 0.01], uuid, 'perf');

  // Storage 估算值
  const storageQuota = pickOne(
    [2147483648, 4294967296, 6442450944, 8589934592, 10737418240],
    uuid, 'storageQ'
  );
  const storageUsage = Math.floor(hashToNumber(uuid, 'storageU') * 50000000);

  // Speech 语音数量
  const speechVoiceCount = pickOne([3, 4, 5, 6], uuid, 'speech');

  return {
    navigator: {
      userAgent,
      platform: PLATFORM.platform,
      languages: langs,
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints,
    },
    screen: {
      width: screenCfg.width,
      height: screenCfg.height,
      availWidth: screenCfg.width,
      availHeight: screenCfg.height - 40, // taskbar
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio,
    },
    canvas: { noiseR, noiseG, noiseB },
    webgl: {
      vendor: gpuCfg.vendor,
      renderer: gpuCfg.renderer,
      noisePixel,
      extensions: webglExtensions,
      params: webglParams,
    },
    audio: { noiseLevel: audioNoise },
    timezone: { name: tz.name, offset: tz.offset },
    fonts: { allowedFonts },
    webrtc: { blockLocal: true },
    clientRects: { noiseX: clientRectsNoiseX, noiseY: clientRectsNoiseY },
    connection: connectionCfg,
    mediaDevices: mediaDeviceCfg,
    performance: { precision: perfPrecision },
    storage: { quota: storageQuota, usage: storageUsage },
    speechVoices: { count: speechVoiceCount },
  };
}
