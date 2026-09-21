import { apiGet, friendlyError, CONF } from "../utils/apiClient.js";
import { makeSummary } from "../utils/cleanText.js";
import { log } from "../utils/logger.js";

/**
 * search_post：关键词检索研报文章
 * 远程返回结构未知，做常见形态兼容：{rows|list|data|records|articles:[...]}，
 * 单条字段兼容 id|post_id|articleId / title|post_title / content|summary|excerpt / publish_time|createTime|created_at
 */
function pickList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const direct = data.rows || data.list || data.data || data.records || data.articles || data.items || data.posts;
  if (Array.isArray(direct)) return direct;
  // 再剥一层 { data: { list: [...] } } / { result: [...] }
  for (const k of ["data", "result", "payload"]) {
    const nested = data[k];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === "object") {
      const inner = nested.rows || nested.list || nested.records || nested.items || nested.articles;
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

function normItem(it) {
  const o = it || {};
  const content = o.content || o.summary || o.excerpt || o.description || o.intro || "";
  return {
    id: o.id ?? o.post_id ?? o.postId ?? o.articleId ?? o.article_id ?? null,
    title: o.title || o.post_title || o.name || "(无标题)",
    summary: makeSummary(o.summary || o.excerpt || o.description || content),
    publish_time: o.publish_time || o.published_at || o.createTime || o.created_at || o.create_time || null,
  };
}

export async function searchPost(args) {
  const keyword = String(args.keyword || "").trim();
  const category = args.category === undefined || args.category === null || args.category === ""
    ? null
    : Number(args.category);
  const page = Math.max(1, Number(args.page) || 1);
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));

  if (!keyword && category === null) {
    return {
      content: [{ type: "text", text: "参数错误：keyword 与 category 至少提供一个。" }],
      isError: true,
    };
  }

  // RuoYi 风格参数：keyword + category + pageNum/pageSize
  const params = { pageNum: page, pageSize: limit };
  if (keyword) params.keyword = keyword;
  if (category !== null) {
    if (!Number.isFinite(category)) {
      return { content: [{ type: "text", text: "参数错误：category 必须是数字栏目 ID。" }], isError: true };
    }
    params.category = category;
  }

  let raw = null;
  try {
    raw = await apiGet(CONF.searchPath, params);
  } catch (err) {
    return { content: [{ type: "text", text: friendlyError(err, CONF.searchPath) }], isError: true };
  }

  const items = pickList(raw).slice(0, limit).map(normItem).filter((x) => x.id != null);
  log("search hits", items.length, `total=${raw?.total ?? "?"}`);

  if (!items.length) {
    const hint = category !== null ? `（栏目 ${category}）` : "";
    return {
      content: [{ type: "text", text: `未找到${keyword ? `与「${keyword}」相关` : ""}的文章${hint}。可尝试换个关键词（如 MLCC、CPO、储能、美股、油价、PCB）。` }],
    };
  }

  const text = items
    .map((x, i) => `${i + 1}. [${x.id}] ${x.title}\n   时间：${x.publish_time || "未知"}\n   摘要：${x.summary}`)
    .join("\n\n");
  return {
    content: [{ type: "text", text: `搜索「${keyword || `栏目:${category}`}」第 ${page} 页，命中 ${items.length} 条（total=${raw?.total ?? "?"}）：\n\n${text}\n\n> 用 get_post_detail(post_id=...) 可查看完整正文。` }],
  };
}
