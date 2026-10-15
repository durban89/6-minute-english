# 6 Minute English Scraper

用于抓取 BBC Learning English "6 Minute English" 的首条内容（最新一期），记录原始地址，下载音频和 Transcript，并生成 Hugo 兼容的页面。

## 日常逻辑（记录）

脚本的逻辑固定如下（建议每天执行一次）：

1. 抓取列表页：`https://www.bbc.co.uk/learningenglish/features/6-minute-english`
2. 从 `<div role="article">` 中提取内容列表首个条目的链接（`.widget-bbcle-coursecontentlist a[href]`）
3. 将该链接作为 **原始地址** 记录下来（写入 `tmp/<ep-YYMMDD>/meta.json` 的 `originalAddress`）
4. 访问该原始地址，解析页面：
   - 提取 MP3 下载链接（`.widget-pagelink-download a[href$=".mp3"]`）
   - 提取 Transcript PDF 下载链接（`.widget-pagelink-download a[href$="transcript.pdf"]`）
   - 从富文本区块中提取内嵌 Transcript 文本并格式化为 Markdown
5. 将以下文件保存到 `tmp/ep-YYMMDD/`：
   - `audio.mp3`：下载的音频
   - `transcript.pdf`：下载的官方 Transcript PDF
   - `transcript.txt`：解析出的纯文本 Transcript（供后续处理使用）
   - `index.md`：符合 Hugo 框架要求的页面 bundle（包含 front matter、audio shortcode 和 Transcript Markdown）
   - `meta.json`：元数据（原始地址、标题、日期、资源 URL、文件相对路径、抓取时间）

## 使用方式

```bash
pnpm install
pnpm build && pnpm start
# 或
pnpm dev
```

脚本运行后，输出原始地址及保存路径，例如：`tmp/ep-261008/`

## Hugo 集成

`tmp/<ep-YYMMDD>/` 是一个 Hugo page bundle。可将该目录复制到 Hugo 站点的 `content/6-minute-english/` 下。

### 所需文件（已提供）

本项目在 `hugo/` 目录下提供了最小可用的模板：

- `hugo/layouts/shortcodes/audio.html` — `audio` shortcode，支持 page resource 播放
- `hugo/layouts/6-minute-english/single.html` — `6-minute-english` 类型的 single layout（渲染标题、日期、PDF 下载、audio shortcode、Transcript）

### 放置位置

将这些文件复制到你的 Hugo 站点根目录：

```
<your-hugo-site>/
  layouts/
    shortcodes/
      audio.html        -> 复制自 hugo/layouts/shortcodes/audio.html
    6-minute-english/
      single.html       -> 复制自 hugo/layouts/6-minute-english/single.html
```

### 注意

- `index.md` 已在 body 中使用 `{{< audio src="audio.mp3" >}}`，因此需要 `audio` shortcode 存在。
- `type: "6-minute-english"` 对应 `layouts/6-minute-english/single.html`；如果不使用此 layout，Hugo 将回退到 `_default/single.html`。
- Transcript 可从 `transcript.txt`（纯文本）或 `transcript.pdf` 获取；`index.md` body 中也包含了格式化的 Markdown 版。

## 定时运行（建议）

每天运行一次即可获取最新一期。可配合 cron：

```cron
0 9 * * * cd /path/to/tmp-scripts && pnpm start >> /path/to/log.txt 2>&1
```

## 说明

- 日期从 episode code（`ep-YYMMDD`）推导：`261008 → 2026-10-08T00:00:00Z`
- Transcript 提取基于页面富文本结构，依赖 `not a word-for-word transcript` 标记及结束标记（`What do you think of the new version` 或 `learningenglish@bbc.co.uk`）；如页面结构变化可能需微调。
- 仅抓取内容列表首个条目（即当前最新一期）。
