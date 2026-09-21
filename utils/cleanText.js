import { load as cheerioLoad } from "cheerio";

/**
 * HTML/富文本 -> 纯文本清洗：
 * 1. 去脚本样式  2. 块级标签转换行  3. 实体解码  4. 压缩空白  5. 超长截断
 */
export function cleanText(html, maxChars = 20000) {
  if (!html) return "";
  let raw = String(html);

  // 纯文本（无标签）直接走压缩逻辑
  if (!/<[a-z!][\s\S]*>/i.test(raw)) {
    return compress(raw, maxChars);
  }

  const $ = cheerioLoad(`<div id="__root">${raw}</div>`);
  $("script, style, noscript, iframe, ins, svg").remove();

  // 图片替换为 [图片: url] 占位，保留图链供 LLM 引用
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src) $(el).replaceWith(`[图片: ${src}]`);
    else $(el).remove();
  });

  // 链接保留文字与 href（href 与文字不同才有价值）
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    if (href && /^https?:/i.test(href) && text && href !== text) {
      $(el).replaceWith(`${text} (${href})`);
    }
  });

  // 块级标签边界补换行，保留段落结构
  $("p, div, br, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre").each(
    (_, el) => {
      $(el).after("\n");
    }
  );

  const text = $("#__root").text();
  return compress(text, maxChars);
}

function compress(text, maxChars) {
  const out = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((s) => s.trim())
    .join("\n")
    .trim();

  if (out.length <= maxChars) return out;
  return out.slice(0, maxChars) + `\n\n[...已截断，原文约 ${out.length} 字符，如需继续请提高 max_length]`;
}

/** 生成列表用的短摘要 */
export function makeSummary(text, maxLen = 160) {
  const t = cleanText(text, maxLen * 3).replace(/\n+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}
