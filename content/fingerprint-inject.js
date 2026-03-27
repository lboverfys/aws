/**
 * 浏览器指纹注入脚本 — 在 MAIN world 中执行
 * 覆盖浏览器 API 以实现多会话反关联
 *
 * 此函数通过 chrome.scripting.executeScript 的 func 参数注入，
 * 必须是自包含的（不能引用外部模块）。
 */

// eslint-disable-next-line no-unused-vars
export function applyFingerprint(config) {
  'use strict';

  if (!config) return;

  // 基于配置生成确定性种子（用于 performance.memory 等需要随机但稳定的值）
  let hashSeed = 0;
  try {
    const seedStr = JSON.stringify(config.canvas || {});
    for (let i = 0; i < seedStr.length; i++) hashSeed = ((hashSeed << 5) - hashSeed + seedStr.charCodeAt(i)) & 0x7FFFFFFF;
    hashSeed = (hashSeed % 10000) / 10000;
  } catch (_) { hashSeed = 0.5; }

  // ============== Native toString 伪装系统（最先初始化）==============
  const nativeToString = Function.prototype.toString;
  const patchedFunctions = new WeakSet();

  function markAsNative(fn) {
    if (fn) patchedFunctions.add(fn);
  }

  Function.prototype.toString = function () {
    if (patchedFunctions.has(this)) {
      return 'function ' + (this.name || '') + '() { [native code] }';
    }
    return nativeToString.call(this);
  };
  markAsNative(Function.prototype.toString);

  // 保护 toString 伪装不被 Reflect.apply 绕过
  const origReflectApply = Reflect.apply;
  Reflect.apply = function (target, thisArg, argsList) {
    if (target === nativeToString && patchedFunctions.has(thisArg)) {
      return 'function ' + (thisArg.name || '') + '() { [native code] }';
    }
    return origReflectApply(target, thisArg, argsList);
  };
  markAsNative(Reflect.apply);

  // 辅助：定义属性并自动标记 getter 为 native
  // 使用 configurable: true 匹配原生属性行为
  function defProp(obj, prop, getter) {
    const desc = { get: getter, enumerable: true, configurable: true };
    // 某些原生属性有 setter（如 navigator 属性），添加空 setter 保持一致
    const origDesc = Object.getOwnPropertyDescriptor(obj, prop);
    if (origDesc && origDesc.set) {
      desc.set = function () {};
      markAsNative(desc.set);
    }
    Object.defineProperty(obj, prop, desc);
    markAsNative(getter);
  }

  // 辅助：替换方法并自动标记为 native
  function defMethod(obj, name, fn) {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    obj[name] = fn;
    markAsNative(fn);
  }

  // ============== Anti-Automation Detection ==============
  defProp(Navigator.prototype, 'webdriver', () => false);

  // pdfViewerEnabled — 真实 Chrome 始终为 true，headless/自动化环境可能为 false
  defProp(Navigator.prototype, 'pdfViewerEnabled', () => true);

  // 清除 ChromeDriver 痕迹
  try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array; } catch (_) {}
  try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise; } catch (_) {}
  try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol; } catch (_) {}

  // ============== Navigator ==============
  const nav = config.navigator;
  if (nav) {
    defProp(Navigator.prototype, 'userAgent', () => nav.userAgent);
    defProp(Navigator.prototype, 'appVersion', () => nav.userAgent.replace('Mozilla/', ''));
    defProp(Navigator.prototype, 'platform', () => nav.platform);
    defProp(Navigator.prototype, 'languages', () => Object.freeze([...nav.languages]));
    defProp(Navigator.prototype, 'language', () => nav.languages[0]);
    defProp(Navigator.prototype, 'hardwareConcurrency', () => nav.hardwareConcurrency);
    defProp(Navigator.prototype, 'deviceMemory', () => nav.deviceMemory);
    defProp(Navigator.prototype, 'maxTouchPoints', () => nav.maxTouchPoints);

    // userAgentData (Chromium)
    if (navigator.userAgentData) {
      try {
        const chromeVer = nav.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '';
        const majorVer = chromeVer.split('.')[0] || '';

        // 伪装低熵 brands（最关键，直接暴露真实版本）
        const notABrandVer = nav.notABrandVersion || '99';
        const fakeBrands = Object.freeze([
          Object.freeze({ brand: 'Chromium', version: majorVer }),
          Object.freeze({ brand: 'Google Chrome', version: majorVer }),
          Object.freeze({ brand: 'Not-A.Brand', version: notABrandVer }),
        ]);
        defProp(NavigatorUAData.prototype, 'brands', () => fakeBrands);
        defProp(NavigatorUAData.prototype, 'platform', () => 'Windows');
        defProp(NavigatorUAData.prototype, 'mobile', () => false);

        const origGetHigh = NavigatorUAData.prototype.getHighEntropyValues;
        const fakePlatformVersion = nav.platformVersion || '10.0.19045';
        const patchedGetHigh = function (hints) {
          return origGetHigh.call(this, hints).then(result => {
            result.platform = 'Windows';
            result.platformVersion = fakePlatformVersion;
            result.uaFullVersion = chromeVer;
            result.architecture = 'x64';
            result.model = '';
            result.bitness = '64';
            if (result.fullVersionList) {
              result.fullVersionList = result.fullVersionList.map(b => {
                if (b.brand === 'Google Chrome' || b.brand === 'Chromium') {
                  return { ...b, version: chromeVer };
                }
                return b;
              });
            }
            if (result.brands) {
              result.brands = fakeBrands;
            }
            return result;
          });
        };
        defMethod(NavigatorUAData.prototype, 'getHighEntropyValues', patchedGetHigh);

        // toJSON 也需要返回伪装数据
        defMethod(NavigatorUAData.prototype, 'toJSON', function () {
          return { brands: fakeBrands, mobile: false, platform: 'Windows' };
        });
      } catch (_) {}
    }
  }

  // ============== Screen ==============
  const scr = config.screen;
  if (scr) {
    for (const prop of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
      if (scr[prop] !== undefined) {
        defProp(Screen.prototype, prop, () => scr[prop]);
      }
    }
    // outerWidth/outerHeight 使用实际窗口尺寸而非 screen 尺寸
    // （outerWidth/outerHeight 不应大于实际窗口，否则与 innerWidth/innerHeight 矛盾）
    // 保留原生值，不伪装 outerWidth/outerHeight
    if (scr.devicePixelRatio !== undefined) {
      defProp(window, 'devicePixelRatio', () => scr.devicePixelRatio);
    }
  }

  // ============== Canvas ==============
  const canvasCfg = config.canvas;
  if (canvasCfg) {
    // 使用伪随机分布的噪声，避免固定步长被检测
    function addCanvasNoise(data) {
      const len = data.length;
      // 基于数据长度生成伪随机种子
      let seed = len ^ (canvasCfg.noiseR * 17 + canvasCfg.noiseG * 31 + canvasCfg.noiseB * 53);
      for (let i = 0; i < len; i += 4) {
        // LCG 伪随机，使用变化的阈值（5~11），避免固定 1/8 模式被统计检测
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
        const threshold = 5 + ((seed >>> 28) & 7); // 5-12 之间变化
        if ((seed & 15) < threshold) {
          // 噪声幅度也加入微小随机变化
          const vary = ((seed >>> 16) & 1) ? 1 : 0;
          data[i]     = Math.max(0, Math.min(255, data[i] + canvasCfg.noiseR + vary));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + canvasCfg.noiseG));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + canvasCfg.noiseB + vary));
        }
      }
    }

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    defMethod(CanvasRenderingContext2D.prototype, 'getImageData', function (...args) {
      const imageData = origGetImageData.apply(this, args);
      addCanvasNoise(imageData.data);
      return imageData;
    });

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    defMethod(HTMLCanvasElement.prototype, 'toDataURL', function (...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          addCanvasNoise(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        } catch (_) {}
      }
      return origToDataURL.apply(this, args);
    });

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    defMethod(HTMLCanvasElement.prototype, 'toBlob', function (callback, ...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          addCanvasNoise(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        } catch (_) {}
      }
      return origToBlob.call(this, callback, ...args);
    });
  }

  // ============== WebGL ==============
  const webglCfg = config.webgl;
  if (webglCfg) {
    const UNMASKED_VENDOR = 0x9245;
    const UNMASKED_RENDERER = 0x9246;
    const GL_PARAMS = {
      0x0D33: 'maxTextureSize', 0x851C: 'maxCubeMapSize', 0x84E8: 'maxRenderbufferSize',
      0x0D3A: 'maxViewportDims', 0x8869: 'maxVertexAttribs', 0x8DFB: 'maxVertexUniformVectors',
      0x8DFC: 'maxVaryingVectors', 0x8DFD: 'maxFragmentUniformVectors',
      0x8872: 'maxTextureImageUnits', 0x846E: 'aliasedLineWidthRange',
      0x846D: 'aliasedPointSizeRange', 0x84FF: 'maxAnisotropy',
    };
    const params = webglCfg.params || {};

    function patchWebGLContext(proto) {
      const origGetParam = proto.getParameter;
      defMethod(proto, 'getParameter', function (pname) {
        if (pname === UNMASKED_VENDOR) return webglCfg.vendor;
        if (pname === UNMASKED_RENDERER) return webglCfg.renderer;
        const paramName = GL_PARAMS[pname];
        if (paramName && params[paramName] !== undefined) {
          const val = params[paramName];
          if (Array.isArray(val)) {
            return paramName.includes('Line') || paramName.includes('Point')
              ? new Float32Array(val) : new Int32Array(val);
          }
          return val;
        }
        return origGetParam.call(this, pname);
      });

      if (webglCfg.extensions) {
        defMethod(proto, 'getSupportedExtensions', function () {
          return [...webglCfg.extensions];
        });
        const origGetExtObj = proto.getExtension;
        defMethod(proto, 'getExtension', function (name) {
          if (!webglCfg.extensions.includes(name)) return null;
          return origGetExtObj.call(this, name);
        });
      }

      const origReadPixels = proto.readPixels;

      // getShaderPrecisionFormat 伪装
      if (webglCfg.shaderPrecisionFormat) {
        const spfConfig = webglCfg.shaderPrecisionFormat;
        const origGetSPF = proto.getShaderPrecisionFormat;
        defMethod(proto, 'getShaderPrecisionFormat', function (shaderType, precisionType) {
          const result = origGetSPF.call(this, shaderType, precisionType);
          if (!result) return result;
          // 判断是 FLOAT 类型还是 INT 类型
          // HIGH_FLOAT=0x8DF2, MEDIUM_FLOAT=0x8DF1, LOW_FLOAT=0x8DF0
          // HIGH_INT=0x8DF5, MEDIUM_INT=0x8DF4, LOW_INT=0x8DF3
          const isFloat = precisionType >= 0x8DF0 && precisionType <= 0x8DF2;
          const cfg = isFloat ? spfConfig.FLOAT : spfConfig.INT;
          if (cfg) {
            Object.defineProperty(result, 'rangeMin', { value: cfg.rangeMin, writable: false, configurable: true });
            Object.defineProperty(result, 'rangeMax', { value: cfg.rangeMax, writable: false, configurable: true });
            Object.defineProperty(result, 'precision', { value: cfg.precision, writable: false, configurable: true });
          }
          return result;
        });
      }

      defMethod(proto, 'readPixels', function (...args) {
        origReadPixels.apply(this, args);
        const pixels = args[6];
        if (pixels && pixels.length) {
          let seed = pixels.length ^ (webglCfg.noisePixel * 37);
          for (let i = 0; i < pixels.length; i += 4) {
            seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
            if ((seed & 7) === 0) {
              pixels[i] = Math.max(0, Math.min(255, pixels[i] + webglCfg.noisePixel));
            }
          }
        }
      });
    }

    if (typeof WebGLRenderingContext !== 'undefined') patchWebGLContext(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGLContext(WebGL2RenderingContext.prototype);
  }

  // ============== Audio ==============
  const audioCfg = config.audio;
  if (audioCfg && audioCfg.noiseLevel) {
    const noise = audioCfg.noiseLevel;
    if (typeof AnalyserNode !== 'undefined') {
      const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      defMethod(AnalyserNode.prototype, 'getFloatFrequencyData', function (array) {
        origGetFloat.call(this, array);
        for (let i = 0; i < array.length; i++) { array[i] += noise * ((i & 3) - 1.5); }
      });
      const origGetByte = AnalyserNode.prototype.getByteFrequencyData;
      defMethod(AnalyserNode.prototype, 'getByteFrequencyData', function (array) {
        origGetByte.call(this, array);
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.max(0, Math.min(255, array[i] + ((i & 1) ? 1 : -1)));
        }
      });
    }
    if (typeof AudioBuffer !== 'undefined') {
      const origGetChannel = AudioBuffer.prototype.getChannelData;
      defMethod(AudioBuffer.prototype, 'getChannelData', function (channel) {
        const data = origGetChannel.call(this, channel);
        for (let i = 0; i < data.length; i++) { data[i] += noise * ((i & 3) - 1.5); }
        return data;
      });
    }
  }

  // ============== Timezone ==============
  const tzCfg = config.timezone;
  if (tzCfg) {
    defMethod(Date.prototype, 'getTimezoneOffset', function () { return tzCfg.offset; });

    // Date.toString / toTimeString / toLocaleString 会泄露真实时区
    // 用 Intl.DateTimeFormat 重新格式化，确保时区一致
    const origDateToString = Date.prototype.toString;
    const origDateToTimeString = Date.prototype.toTimeString;

    // 构建时区缩写（如 EST, PST）
    function getTzAbbr(date) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tzCfg.name, timeZoneName: 'short'
        }).formatToParts(date);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart ? tzPart.value : 'GMT';
      } catch (_) { return 'GMT'; }
    }

    function getTzLong(date) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tzCfg.name, timeZoneName: 'long'
        }).formatToParts(date);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart ? tzPart.value : '';
      } catch (_) { return ''; }
    }

    function formatOffset(offset) {
      const sign = offset <= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      const h = String(Math.floor(abs / 60)).padStart(2, '0');
      const m = String(abs % 60).padStart(2, '0');
      return `${sign}${h}${m}`;
    }

    defMethod(Date.prototype, 'toString', function () {
      const str = origDateToString.call(this);
      if (isNaN(this.getTime())) return str;
      try {
        const dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: tzCfg.name, weekday: 'short', year: 'numeric', month: 'short',
          day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        });
        const parts = dtf.formatToParts(this);
        const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
        const offset = formatOffset(tzCfg.offset);
        const abbr = getTzAbbr(this);
        const long = getTzLong(this);
        return `${get('weekday')} ${get('month')} ${get('day')} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')} GMT${offset} (${long || abbr})`;
      } catch (_) { return str; }
    });

    defMethod(Date.prototype, 'toTimeString', function () {
      const str = origDateToTimeString.call(this);
      if (isNaN(this.getTime())) return str;
      try {
        const dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: tzCfg.name, hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        });
        const parts = dtf.formatToParts(this);
        const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
        const offset = formatOffset(tzCfg.offset);
        const abbr = getTzAbbr(this);
        const long = getTzLong(this);
        return `${get('hour')}:${get('minute')}:${get('second')} GMT${offset} (${long || abbr})`;
      } catch (_) { return str; }
    });

    defMethod(Date.prototype, 'toLocaleDateString', function (...args) {
      if (args.length === 0) args = [undefined, {}];
      else if (args.length === 1) args = [args[0], {}];
      args[1] = { ...(args[1] || {}), timeZone: tzCfg.name };
      return new Intl.DateTimeFormat(args[0], args[1]).format(this);
    });

    defMethod(Date.prototype, 'toLocaleTimeString', function (...args) {
      if (args.length === 0) args = [undefined, {}];
      else if (args.length === 1) args = [args[0], {}];
      args[1] = { ...(args[1] || {}), timeZone: tzCfg.name };
      return new Intl.DateTimeFormat(args[0], args[1]).format(this);
    });

    defMethod(Date.prototype, 'toLocaleString', function (...args) {
      if (args.length === 0) args = [undefined, {}];
      else if (args.length === 1) args = [args[0], {}];
      args[1] = { ...(args[1] || {}), timeZone: tzCfg.name };
      return new Intl.DateTimeFormat(args[0], args[1]).format(this);
    });

    // 用 Proxy 包装 Intl.DateTimeFormat，保持 instanceof 和 new 调用正确
    const OrigDTF = Intl.DateTimeFormat;
    const DTFProxy = new Proxy(OrigDTF, {
      construct(target, args) {
        if (args.length === 0) args = [undefined, {}];
        else if (args.length === 1) args = [args[0], {}];
        // 只在用户未显式指定 timeZone 时注入伪装时区
        if (!args[1]?.timeZone) {
          args[1] = { ...(args[1] || {}), timeZone: tzCfg.name };
        }
        return new target(...args);
      },
      apply(target, thisArg, args) {
        if (args.length === 0) args = [undefined, {}];
        else if (args.length === 1) args = [args[0], {}];
        if (!args[1]?.timeZone) {
          args[1] = { ...(args[1] || {}), timeZone: tzCfg.name };
        }
        return target(...args);
      },
    });
    // 伪装 Proxy 的 toString，使其看起来像原生函数
    Object.defineProperty(DTFProxy, 'name', { value: 'DateTimeFormat', configurable: true });
    Object.defineProperty(DTFProxy, 'length', { value: 0, configurable: true });
    Object.defineProperty(DTFProxy, 'prototype', { value: OrigDTF.prototype, writable: false, configurable: false });
    markAsNative(DTFProxy);
    Intl.DateTimeFormat = DTFProxy;

    const origResolved = OrigDTF.prototype.resolvedOptions;
    defMethod(OrigDTF.prototype, 'resolvedOptions', function () {
      const opts = origResolved.call(this);
      // 只在用户未显式指定 timeZone 时覆盖（与 Proxy construct 逻辑一致）
      // 如果 resolvedOptions 返回的时区与伪装时区不同，说明是用户显式指定的，保留原值
      // 注意：DTFProxy 的 construct 已经在未指定时注入了 tzCfg.name，
      // 所以这里只需要确保一致性
      opts.timeZone = tzCfg.name;
      return opts;
    });

    // 伪装 Date 构造函数中的时区解析行为
    // 当 new Date(string) 解析含时区的字符串时，结果不受 getTimezoneOffset 影响
    // 但 Date.parse 和 new Date() 无参数版本会使用系统时区，需要保持一致
  }

  // ============== Fonts ==============
  const fontsCfg = config.fonts;
  if (fontsCfg && fontsCfg.allowedFonts) {
    const allowed = new Set(fontsCfg.allowedFonts.map(f => f.toLowerCase()));
    if (typeof FontFaceSet !== 'undefined') {
      const origCheck = FontFaceSet.prototype.check;
      defMethod(FontFaceSet.prototype, 'check', function (font, text) {
        const fontFamily = font.replace(/^[\d.]+px\s+/, '').replace(/["']/g, '').trim();
        if (!allowed.has(fontFamily.toLowerCase())) return false;
        return origCheck.call(this, font, text);
      });

      // FontFaceSet 迭代方法 — 按 allowedFonts 过滤
      const origForEach = FontFaceSet.prototype.forEach;
      defMethod(FontFaceSet.prototype, 'forEach', function (callback, thisArg) {
        origForEach.call(this, function (fontFace, fontFace2, set) {
          if (allowed.has(fontFace.family.toLowerCase())) {
            callback.call(thisArg, fontFace, fontFace2, set);
          }
        });
      });

      const origValues = FontFaceSet.prototype.values;
      defMethod(FontFaceSet.prototype, 'values', function () {
        const iter = origValues.call(this);
        return {
          next() {
            while (true) {
              const result = iter.next();
              if (result.done) return result;
              if (allowed.has(result.value.family.toLowerCase())) return result;
            }
          },
          [Symbol.iterator]() { return this; }
        };
      });

      defMethod(FontFaceSet.prototype, 'entries', function () {
        const iter = origValues.call(this);
        return {
          next() {
            while (true) {
              const result = iter.next();
              if (result.done) return result;
              if (allowed.has(result.value.family.toLowerCase())) {
                return { value: [result.value, result.value], done: false };
              }
            }
          },
          [Symbol.iterator]() { return this; }
        };
      });

      // Symbol.iterator 指向 values
      FontFaceSet.prototype[Symbol.iterator] = FontFaceSet.prototype.values;
      markAsNative(FontFaceSet.prototype[Symbol.iterator]);
    }
  }

  // ============== WebRTC ==============
  const webrtcCfg = config.webrtc;
  if (webrtcCfg && typeof RTCPeerConnection !== 'undefined') {
    // 生成确定性的假内网 IP（基于配置种子，每个会话不同但稳定）
    const fakeLocalIP = (() => {
      const s = hashSeed;
      // 192.168.x.x 范围的假内网 IP
      const octet3 = Math.floor(s * 255) % 256;
      const octet4 = (Math.floor(s * 65535) % 254) + 1; // 1-254
      return `192.168.${octet3}.${octet4}`;
    })();
    const fakeMdns = crypto.randomUUID() + '.local';

    const OrigRTC = window.RTCPeerConnection;

    // 替换 candidate 中的真实 IP
    function sanitizeCandidate(candidate) {
      if (!candidate || !candidate.candidate) return candidate;
      const sdp = candidate.candidate;

      // 匹配 host 类型的候选（包含真实本地 IP）
      // 格式: candidate:... typ host ...
      if (sdp.includes(' typ host ')) {
        // 替换 IP 地址为假 IP（IPv4 格式: x.x.x.x）
        const sanitized = sdp.replace(
          /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/,
          fakeLocalIP
        );
        return new RTCIceCandidate({
          candidate: sanitized,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      }

      // srflx（服务器反射）和 prflx（对端反射）候选包含真实公网 IP，直接丢弃
      if (sdp.includes(' typ srflx ') || sdp.includes(' typ prflx ')) {
        return null;
      }

      // relay 候选保留（TURN 服务器 IP，不泄露用户信息）
      return candidate;
    }

    const RTCProxy = new Proxy(OrigRTC, {
      construct(target, args) {
        const pc = new target(...args);

        // 拦截 onicecandidate 事件
        const origAddEventListener = pc.addEventListener.bind(pc);
        pc.addEventListener = function (type, listener, options) {
          if (type === 'icecandidate' && typeof listener === 'function') {
            const wrappedListener = function (event) {
              if (event.candidate) {
                const sanitized = sanitizeCandidate(event.candidate);
                if (sanitized === null) return; // 丢弃 srflx 候选
                // 创建新事件对象
                const newEvent = new RTCPeerConnectionIceEvent('icecandidate', {
                  candidate: sanitized,
                });
                listener.call(this, newEvent);
              } else {
                // null candidate 表示收集完成，正常传递
                listener.call(this, event);
              }
            };
            return origAddEventListener('icecandidate', wrappedListener, options);
          }
          return origAddEventListener(type, listener, options);
        };
        markAsNative(pc.addEventListener);

        // 拦截 onicecandidate 属性赋值
        let _onicecandidateHandler = null;
        Object.defineProperty(pc, 'onicecandidate', {
          get: () => _onicecandidateHandler,
          set: (handler) => {
            _onicecandidateHandler = handler;
            if (typeof handler === 'function') {
              origAddEventListener('icecandidate', function (event) {
                if (event.candidate) {
                  const sanitized = sanitizeCandidate(event.candidate);
                  if (sanitized === null) return;
                  const newEvent = new RTCPeerConnectionIceEvent('icecandidate', {
                    candidate: sanitized,
                  });
                  handler.call(pc, newEvent);
                } else {
                  handler.call(pc, event);
                }
              });
            }
          },
          configurable: true,
          enumerable: true,
        });

        // 拦截 createOffer/createAnswer 的 SDP，替换其中的 IP
        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = function (...offerArgs) {
          return origCreateOffer(...offerArgs).then(desc => {
            if (desc && desc.sdp) {
              // 替换 SDP 中 host 候选的 IP
              desc.sdp = desc.sdp.replace(
                /(a=candidate:.*? typ host .*?)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
                (match, prefix) => prefix + fakeLocalIP
              );
              // 移除 srflx 和 prflx 候选行
              desc.sdp = desc.sdp.replace(/a=candidate:.*? typ (?:srflx|prflx) .*?\r?\n/g, '');
            }
            return desc;
          });
        };
        markAsNative(pc.createOffer);

        const origCreateAnswer = pc.createAnswer.bind(pc);
        pc.createAnswer = function (...answerArgs) {
          return origCreateAnswer(...answerArgs).then(desc => {
            if (desc && desc.sdp) {
              desc.sdp = desc.sdp.replace(
                /(a=candidate:.*? typ host .*?)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
                (match, prefix) => prefix + fakeLocalIP
              );
              desc.sdp = desc.sdp.replace(/a=candidate:.*? typ srflx .*?\r?\n/g, '');
            }
            return desc;
          });
        };
        markAsNative(pc.createAnswer);

        return pc;
      },
    });
    Object.defineProperty(RTCProxy, 'name', { value: 'RTCPeerConnection', configurable: true });
    Object.defineProperty(RTCProxy, 'prototype', { value: OrigRTC.prototype, writable: false, configurable: false });
    markAsNative(RTCProxy);
    Object.defineProperty(window, 'RTCPeerConnection', { value: RTCProxy, writable: true, configurable: true });

    // 同时伪装 webkitRTCPeerConnection（部分指纹脚本使用 webkit 前缀）
    if (window.webkitRTCPeerConnection) {
      Object.defineProperty(window, 'webkitRTCPeerConnection', { value: RTCProxy, writable: true, configurable: true });
    }
  }

  // ============== ClientRects ==============
  const crCfg = config.clientRects;
  if (crCfg) {
    const nx = crCfg.noiseX || 0;
    const ny = crCfg.noiseY || 0;
    function noisifyDOMRect(rect) {
      return new DOMRect(rect.x + nx, rect.y + ny, rect.width + nx, rect.height + ny);
    }
    function noisifyDOMRectList(list) {
      const rects = [];
      for (let i = 0; i < list.length; i++) rects.push(noisifyDOMRect(list[i]));
      rects.item = (idx) => rects[idx] || null;
      return rects;
    }
    const origGetBCR = Element.prototype.getBoundingClientRect;
    defMethod(Element.prototype, 'getBoundingClientRect', function () {
      return noisifyDOMRect(origGetBCR.call(this));
    });
    const origGetCR = Element.prototype.getClientRects;
    defMethod(Element.prototype, 'getClientRects', function () {
      return noisifyDOMRectList(origGetCR.call(this));
    });
    if (typeof Range !== 'undefined') {
      const origRBCR = Range.prototype.getBoundingClientRect;
      defMethod(Range.prototype, 'getBoundingClientRect', function () {
        return noisifyDOMRect(origRBCR.call(this));
      });
      const origRCR = Range.prototype.getClientRects;
      defMethod(Range.prototype, 'getClientRects', function () {
        return noisifyDOMRectList(origRCR.call(this));
      });
    }
  }

  // ============== Navigator Connection ==============
  const connCfg = config.connection;
  if (connCfg && navigator.connection) {
    const connProto = Object.getPrototypeOf(navigator.connection);
    defProp(connProto, 'downlink', () => connCfg.downlink);
    defProp(connProto, 'effectiveType', () => connCfg.effectiveType);
    defProp(connProto, 'rtt', () => connCfg.rtt);
    defProp(connProto, 'saveData', () => connCfg.saveData);
  }

  // ============== Performance.now ==============
  // 注意：不降低 performance.now 精度，因为真实 Chrome 不会这样做，
  // 降低精度反而成为可检测的 bot 特征。保留原生行为。

  // ============== MediaDevices ==============
  const mediaCfg = config.mediaDevices;
  if (mediaCfg && navigator.mediaDevices) {
    defMethod(navigator.mediaDevices, 'enumerateDevices', function () {
      const devices = [];
      const kinds = ['audioinput', 'audiooutput', 'videoinput'];
      for (const kind of kinds) {
        for (let i = 0; i < (mediaCfg[kind] || 0); i++) {
          devices.push({
            deviceId: '', groupId: '', kind, label: '',
            toJSON() { return { deviceId: '', groupId: '', kind, label: '' }; }
          });
        }
      }
      return Promise.resolve(devices);
    });
  }

  // ============== Storage Estimate ==============
  const storageCfg = config.storage;
  if (storageCfg && navigator.storage) {
    defMethod(navigator.storage, 'estimate', function () {
      return Promise.resolve({ quota: storageCfg.quota, usage: storageCfg.usage });
    });
  }

  // ============== SpeechSynthesis ==============
  const speechCfg = config.speechVoices;
  if (speechCfg && typeof speechSynthesis !== 'undefined') {
    const voiceNames = [
      'Microsoft David - English (United States)',
      'Microsoft Zira - English (United States)',
      'Microsoft Mark - English (United States)',
      'Google US English', 'Google UK English Female',
      'Google UK English Male',
    ];
    const fakeVoices = voiceNames.slice(0, speechCfg.count || 4).map((name, i) => ({
      default: i === 0, lang: 'en-US', localService: i < 2, name, voiceURI: name,
    }));
    defMethod(speechSynthesis, 'getVoices', function () { return fakeVoices; });
  }

  // ============== Plugins & MimeTypes ==============
  // 返回真实 Chrome 内置 PDF 插件列表，避免空列表被检测
  const pdfMimeType = {
    type: 'application/pdf',
    suffixes: 'pdf',
    description: 'Portable Document Format',
    enabledPlugin: null, // 后面回填
  };
  const pdfMimeType2 = {
    type: 'application/x-google-chrome-pdf',
    suffixes: 'pdf',
    description: 'Portable Document Format',
    enabledPlugin: null,
  };

  const pluginNames = [
    'PDF Viewer',
    'Chrome PDF Viewer',
    'Chromium PDF Viewer',
    'Microsoft Edge PDF Viewer',
    'WebKit built-in PDF',
  ];

  const fakePlugins = pluginNames.map((name, idx) => {
    const mt = { ...pdfMimeType, enabledPlugin: null };
    const plugin = {
      name,
      description: 'Portable Document Format',
      filename: 'internal-pdf-viewer',
      length: 1,
      0: mt,
      item: (i) => i === 0 ? mt : null,
      namedItem: (n) => n === 'application/pdf' ? mt : null,
      [Symbol.iterator]: function* () { yield mt; },
    };
    mt.enabledPlugin = plugin;
    return plugin;
  });

  defProp(Navigator.prototype, 'plugins', () => {
    const list = Object.create(PluginArray.prototype);
    for (let i = 0; i < fakePlugins.length; i++) {
      list[i] = fakePlugins[i];
    }
    Object.defineProperty(list, 'length', { value: fakePlugins.length, writable: false, enumerable: true, configurable: true });
    list.item = (idx) => fakePlugins[idx] || null;
    list.namedItem = (name) => fakePlugins.find(p => p.name === name) || null;
    list.refresh = () => {};
    list[Symbol.iterator] = function* () { for (const p of fakePlugins) yield p; };
    markAsNative(list.item);
    markAsNative(list.namedItem);
    markAsNative(list.refresh);
    return list;
  });

  const fakeMimeTypes = [pdfMimeType, pdfMimeType2];
  defProp(Navigator.prototype, 'mimeTypes', () => {
    const list = Object.create(MimeTypeArray.prototype);
    for (let i = 0; i < fakeMimeTypes.length; i++) {
      list[i] = fakeMimeTypes[i];
    }
    Object.defineProperty(list, 'length', { value: fakeMimeTypes.length, writable: false, enumerable: true, configurable: true });
    list.item = (idx) => fakeMimeTypes[idx] || null;
    list.namedItem = (name) => fakeMimeTypes.find(m => m.type === name) || null;
    list[Symbol.iterator] = function* () { for (const m of fakeMimeTypes) yield m; };
    markAsNative(list.item);
    markAsNative(list.namedItem);
    return list;
  });

  // ============== Battery API ==============
  if (navigator.getBattery) {
    defMethod(navigator, 'getBattery', function () {
      return Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0,
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        onchargingchange: null, onchargingtimechange: null,
        ondischargingtimechange: null, onlevelchange: null,
      });
    });
  }

  // ============== matchMedia 屏幕一致性 + CSS 媒体特征伪装 ==============
  if (config.screen) {
    const sw = config.screen.width;
    const origMatchMedia = window.matchMedia;
    defMethod(window, 'matchMedia', function (query) {
      let q = query;
      // 屏幕宽度一致性
      q = q.replace(/\(\s*(max-|min-)?device-width\s*:\s*\d+px\s*\)/g, (m, prefix) => {
        return `(${prefix || ''}device-width: ${sw}px)`;
      });
      // 强制 prefers-color-scheme: light（避免暗色模式泄露系统偏好）
      q = q.replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '(prefers-color-scheme: __never_match__)');
      q = q.replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, '(prefers-color-scheme: light)');
      // 强制 prefers-reduced-motion: no-preference
      q = q.replace(/\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/gi, '(prefers-reduced-motion: __never_match__)');
      // 强制 forced-colors: none
      q = q.replace(/\(\s*forced-colors\s*:\s*active\s*\)/gi, '(forced-colors: __never_match__)');
      // 强制 prefers-contrast: no-preference
      q = q.replace(/\(\s*prefers-contrast\s*:\s*(more|less|custom)\s*\)/gi, '(prefers-contrast: __never_match__)');
      return origMatchMedia.call(window, q);
    });
  }

  // ============== performance.memory 伪装 ==============
  if (typeof Performance !== 'undefined' && performance.memory) {
    const memCfg = config.performanceMemory || {};
    const fakeJsHeapSizeLimit = memCfg.jsHeapSizeLimit || (2172649472 + Math.floor(hashSeed * 1073741824));
    const fakeTotalJSHeapSize = Math.floor(fakeJsHeapSizeLimit * (0.15 + hashSeed * 0.25));
    const fakeUsedJSHeapSize = Math.floor(fakeTotalJSHeapSize * (0.5 + hashSeed * 0.4));
    const fakeMemory = {
      jsHeapSizeLimit: fakeJsHeapSizeLimit,
      totalJSHeapSize: fakeTotalJSHeapSize,
      usedJSHeapSize: fakeUsedJSHeapSize,
    };
    Object.freeze(fakeMemory);
    defProp(Performance.prototype, 'memory', () => fakeMemory);
  }

  // ============== OffscreenCanvas ==============
  if (typeof OffscreenCanvas !== 'undefined') {
    const origOCGetContext = OffscreenCanvas.prototype.getContext;
    defMethod(OffscreenCanvas.prototype, 'getContext', function (type, ...args) {
      const ctx = origOCGetContext.call(this, type, ...args);
      if (!ctx) return ctx;

      // 2D Canvas 噪声
      if (type === '2d' && canvasCfg) {
        const origOCGetImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function (...gdArgs) {
          const imageData = origOCGetImageData(...gdArgs);
          const data = imageData.data;
          let seed = data.length ^ (canvasCfg.noiseR * 17);
          for (let i = 0; i < data.length; i += 4) {
            seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
            const threshold = 5 + ((seed >>> 28) & 7);
            if ((seed & 15) < threshold) {
              const vary = ((seed >>> 16) & 1) ? 1 : 0;
              data[i]     = Math.max(0, Math.min(255, data[i] + canvasCfg.noiseR + vary));
              data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + canvasCfg.noiseG));
              data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + canvasCfg.noiseB + vary));
            }
          }
          return imageData;
        };
        markAsNative(ctx.getImageData);
      }

      // WebGL 上下文伪装（防止通过 OffscreenCanvas 获取真实 GPU 信息）
      if ((type === 'webgl' || type === 'webgl2') && webglCfg) {
        const UNMASKED_VENDOR_OC = 0x9245;
        const UNMASKED_RENDERER_OC = 0x9246;
        const origOCGetParam = ctx.getParameter.bind(ctx);
        ctx.getParameter = function (pname) {
          if (pname === UNMASKED_VENDOR_OC) return webglCfg.vendor;
          if (pname === UNMASKED_RENDERER_OC) return webglCfg.renderer;
          return origOCGetParam(pname);
        };
        markAsNative(ctx.getParameter);
      }

      return ctx;
    });
  }

  // ============== Permissions API ==============
  if (navigator.permissions) {
    const origQuery = navigator.permissions.query;
    defMethod(navigator.permissions, 'query', function (desc) {
      const sensitive = ['camera', 'microphone', 'geolocation', 'notifications', 'midi'];
      if (desc && sensitive.includes(desc.name)) {
        return Promise.resolve({
          state: 'prompt', name: desc.name, onchange: null,
          addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        });
      }
      return origQuery.call(this, desc);
    });
  }

  // ============== Performance Entries 过滤 ==============
  // 过滤掉包含 chrome-extension:// 的条目，防止扩展暴露
  if (typeof Performance !== 'undefined') {
    const extPattern = 'chrome-extension://';

    const origGetEntries = Performance.prototype.getEntries;
    defMethod(Performance.prototype, 'getEntries', function () {
      return origGetEntries.call(this).filter(e => !e.name.includes(extPattern));
    });

    const origGetEntriesByType = Performance.prototype.getEntriesByType;
    defMethod(Performance.prototype, 'getEntriesByType', function (type) {
      return origGetEntriesByType.call(this, type).filter(e => !e.name.includes(extPattern));
    });

    const origGetEntriesByName = Performance.prototype.getEntriesByName;
    defMethod(Performance.prototype, 'getEntriesByName', function (name, type) {
      if (name.includes(extPattern)) return [];
      return origGetEntriesByName.call(this, name, type).filter(e => !e.name.includes(extPattern));
    });

    // PerformanceObserver 代理：过滤 chrome-extension:// 条目
    if (typeof PerformanceObserver !== 'undefined') {
      const OrigPerfObserver = PerformanceObserver;
      const PerfObserverProxy = new Proxy(OrigPerfObserver, {
        construct(target, args) {
          const origCallback = args[0];
          if (typeof origCallback === 'function') {
            args[0] = function (list, observer) {
              const origGetEntries = list.getEntries.bind(list);
              list.getEntries = function () {
                return origGetEntries().filter(e => !e.name || !e.name.includes(extPattern));
              };
              return origCallback.call(this, list, observer);
            };
          }
          return new target(...args);
        }
      });
      Object.defineProperty(PerfObserverProxy, 'name', { value: 'PerformanceObserver', configurable: true });
      Object.defineProperty(PerfObserverProxy, 'prototype', { value: OrigPerfObserver.prototype, writable: false, configurable: false });
      markAsNative(PerfObserverProxy);
      window.PerformanceObserver = PerfObserverProxy;
    }
  }

  // ============== Error.stack 清理 ==============
  // 过滤掉包含 chrome-extension:// 的栈帧
  const origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (error, structuredStack) {
    const filtered = structuredStack.filter(frame => {
      const fileName = frame.getFileName();
      return !fileName || !fileName.includes('chrome-extension://');
    });
    if (origPrepareStackTrace) {
      return origPrepareStackTrace(error, filtered);
    }
    // 默认格式化
    const lines = filtered.map(frame => `    at ${frame}`);
    return `${error.name}: ${error.message}\n${lines.join('\n')}`;
  };

  // ============== DNS Prefetch 禁用 ==============
  // 防止浏览器通过 DNS prefetch 泄露真实 DNS 请求
  try {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'x-dns-prefetch-control';
    meta.content = 'off';
    (document.head || document.documentElement).appendChild(meta);
  } catch (_) {}

  // ============== 额外隐私属性一致性 ==============
  // globalPrivacyControl — 真实 Chrome 默认不存在此属性，确保不泄露
  if ('globalPrivacyControl' in navigator) {
    try { delete Navigator.prototype.globalPrivacyControl; } catch (_) {
      defProp(Navigator.prototype, 'globalPrivacyControl', () => undefined);
    }
  }

  // 注入完成（不输出日志，避免被页面检测）
}