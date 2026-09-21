import { apiGet, friendlyError, CONF } from "../utils/apiClient.js";
import { cleanText } from "../utils/cleanText.js";
import { log } from "../utils/logger.js";

/**
 * get_post_detail：按 post_id 获取单篇完整文章
 * 详情数据兼容 {data:{...}} / {...} / {rows:[{...}]}；字段兼容 html|content|body
 */
function unwrap(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.rows) && data.rows.length) return data.rows[0];
  if (Array.isArray(data.data) && data.data.length) return data.data[0];
  if (data.data && typeof data.data === "object") return data.data;
  if (data.result && typeof data.result === "object") return data.result;
  // 本体就是文章对象（有 title/content 任一）
  if (data.title || data.content || data.post_title) return data;
  return null;
}

export async function getPostDetail(args) {
  const id = args.post_id ?? args.id;
  if (id === undefined || id === null || String(id).trim() === "") {
    return { content: [{ type: "text", text: "参数错误：post_id 不能为空。" }], isError: true };
  }
  const maxChars = Math.min(50000, Math.max(500, Number(args.max_length) || CONF.maxChars));

  // 先试 /:id，再试 ?id=
  let raw = null;
  let lastErr = null;
  for (const url of [`${CONF.detailPath}/${id}`, CONF.detailPath]) {
    try {
      raw = await apiGet(url, url === CONF.detailPath ? { id } : undefined);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status !== 404) break;
    }
  }
  if (lastErr) {
    return { content: [{ type: "text", text: friendlyError(lastErr, CONF.detailPath) }], isError: true };
  }

  const post = unwrap(raw);
  if (!post) {
    log("detail unwrap failed, raw keys:", raw && Object.keys(raw));
    return { content: [{ type: "text", text: `post_id=${id} 未找到对应文章，或返回结构无法解析（详见 mcp-debug.log）。` }], isError: true };
  }

  const title = post.title || post.post_title || "(无标题)";
  const publishTime = post.publish_time || post.published_at || post.createTime || post.created_at || "未知";
  const content = cleanText(post.html || post.content || post.body || post.text || "", maxChars);

  if (!content) {
    return { content: [{ type: "text", text: `文章 [${id}] ${title} 无正文内容。` }] };
  }

  return {
    content: [{
      type: "text",
      text: `# ${title}\n\n发布时间：${publishTime}\npost_id：${id}\n\n${content}`,
    }],
  };
}
