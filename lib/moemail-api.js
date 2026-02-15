/**
 * MoeMail API 客户端
 * 基于 Cloudflare 的临时邮箱服务，支持 API 自动收取验证码
 */

export class MoeMailClient {
  constructor({ apiUrl, apiKey, domain }) {
    // 去掉末尾斜杠
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.domain = domain || this._inferDomain(apiUrl);
    this.inboxId = null;
    this.address = null;
  }

  /**
   * 从 API URL 推断邮箱域名
   */
  _inferDomain(apiUrl) {
    try {
      const url = new URL(apiUrl);
      return url.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 通用请求方法
   */
  async _request(method, path, body = null) {
    const url = `${this.apiUrl}${path}`;
    const options = {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`MoeMail API 错误 (${response.status}): ${text}`);
    }
    return response.json();
  }

  /**
   * 生成临时邮箱
   * POST /api/emails/generate
   */
  async createInbox(options = {}) {
    const body = {
      expiryTime: 1000 * 60 * 60 * 24 * 3,  // 3天（MoeMail 可选值: 3600000/86400000/259200000/0）
    };
    if (this.domain) {
      body.domain = this.domain;
    }

    const result = await this._request('POST', '/api/emails/generate', body);
    this.inboxId = result.id || result.data?.id;
    this.address = result.email || result.address || result.data?.email || result.data?.address;

    if (!this.inboxId || !this.address) {
      throw new Error('MoeMail 返回数据缺少 id 或 address');
    }

    console.log(`[MoeMail] 创建邮箱: ${this.address} (id: ${this.inboxId})`);
    return this.address;
  }

  /**
   * 轮询收件箱，提取 6 位验证码
   * @param {number} timeout 超时时间（毫秒），默认 120 秒
   * @returns {string|null} 验证码或 null
   */
  async waitForVerificationCode(timeout = 120000) {
    if (!this.inboxId) {
      throw new Error('邮箱未创建，请先调用 createInbox');
    }

    const startTime = Date.now();
    const pollInterval = 3000; // 3 秒轮询
    let lastMessageCount = 0;

    console.log(`[MoeMail] 开始轮询验证码 (超时: ${timeout / 1000}s)`);

    while (Date.now() - startTime < timeout) {
      try {
        const messages = await this._request('GET', `/api/emails/${this.inboxId}?type=received`);
        const msgList = Array.isArray(messages) ? messages : (messages.data || messages.emails || []);

        if (msgList.length > lastMessageCount) {
          lastMessageCount = msgList.length;
          // 检查最新的邮件
          for (let i = msgList.length - 1; i >= 0; i--) {
            const msg = msgList[i];
            const code = this._extractCode(msg);
            if (code) {
              console.log(`[MoeMail] 提取到验证码: ${code}`);
              return code;
            }

            // 如果邮件只有 id，需要获取完整内容
            if (msg.id && !msg.content && !msg.html && !msg.text) {
              try {
                const fullMsg = await this._request('GET', `/api/emails/${this.inboxId}/${msg.id}`);
                const code = this._extractCode(fullMsg);
                if (code) {
                  console.log(`[MoeMail] 提取到验证码: ${code}`);
                  return code;
                }
              } catch (e) {
                console.warn(`[MoeMail] 获取邮件详情失败:`, e.message);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[MoeMail] 轮询出错:`, e.message);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.warn(`[MoeMail] 验证码获取超时`);
    return null;
  }

  /**
   * 从邮件内容中提取 6 位验证码
   */
  _extractCode(msg) {
    // 尝试从多个字段提取
    const sources = [
      msg.content,
      msg.html,
      msg.text,
      msg.body,
      msg.data?.content,
      msg.data?.html,
      msg.data?.text,
    ].filter(Boolean);

    for (const source of sources) {
      // 先去掉 HTML 标签
      const text = source.replace(/<[^>]+>/g, ' ');
      // 匹配 6 位数字验证码
      const match = text.match(/\b(\d{6})\b/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * 删除临时邮箱
   * DELETE /api/emails/{id}
   */
  async deleteInbox() {
    if (!this.inboxId) return;

    try {
      await this._request('DELETE', `/api/emails/${this.inboxId}`);
      console.log(`[MoeMail] 已删除邮箱: ${this.address}`);
    } catch (e) {
      console.warn(`[MoeMail] 删除邮箱失败:`, e.message);
    } finally {
      this.inboxId = null;
      this.address = null;
    }
  }
}
