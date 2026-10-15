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

这些内容作为一个**独立的 section** 放在 `/6-minute-english/`，与你的技术博客（`content/posts/`）完全分开，使用独立的 layout，不会影响博客原本风格。

目录结构（Hugo 站点）：

```
<your-hugo-site>/
  content/
    6-minute-english/          <- 独立 section（一个独立 page）
      _index.md                <- section 列表页（只需创建一次）
      ep-261008/               <- 每期内容（脚本每天生成，复制进来即可）
        index.md
        audio.mp3
        transcript.pdf
        transcript.txt
        meta.json
  layouts/
    shortcodes/
      audio.html
    6-minute-english/
      list.html                <- section 列表页 layout
      single.html              <- 每期内容 layout
```

### 所需文件（已提供）

本项目在 `hugo/` 目录下已提供全部文件：

- `hugo/content/6-minute-english/_index.md` — section 首页（列表页）
- `hugo/layouts/6-minute-english/list.html` — 列表 layout
- `hugo/layouts/6-minute-english/single.html` — 详情 layout
- `hugo/layouts/shortcodes/audio.html` — `audio` shortcode（page resource 播放）
- `hugo/static/css/6min.css` — Tailwind CSS v4 编译出的自包含样式（含暗色模式、prose 样式）
- `hugo/static/robots.txt` — 阻止搜索引擎收录 `/6-minute-english/`（可选）

### 放置位置

把 `hugo/` 下的文件对应复制到你 Hugo 站点根目录：

```
hugo/content/6-minute-english/_index.md  ->  <site>/content/6-minute-english/_index.md
hugo/layouts/6-minute-english/list.html   ->  <site>/layouts/6-minute-english/list.html
hugo/layouts/6-minute-english/single.html ->  <site>/layouts/6-minute-english/single.html
hugo/layouts/shortcodes/audio.html        ->  <site>/layouts/shortcodes/audio.html
hugo/static/css/6min.css                 ->  <site>/static/css/6min.css
hugo/static/robots.txt                   ->  <site>/static/robots.txt  （可选）
```

然后每天把脚本生成的 `tmp/<ep-YYMMDD>/` 整个复制到 `<site>/content/6-minute-english/`。

### 添加后直接可见

- 把新的 `ep-YYMMDD/` 目录放进 `content/6-minute-english/` 后，`/6-minute-english/` 列表页会**自动**出现该条目（Hugo 按 section 下所有子页面自动生成列表），无需手动维护列表。
- 列表按日期倒序（`ByDate.Reverse`），所以最新一期在最上面。
- 想放进站点的导航菜单，可在 `_index.md` 的 front matter 里加：

  ```yaml
  menu:
    main:
      name: "6 Minute English"
      weight: 10
  ```

### 注意

- `index.md` 已在 body 中使用 `{{< audio src="audio.mp3" >}}`，因此需要 `audio` shortcode 存在。
- `_index.md` 中用 `cascade` 给所有子页面设置 `type: "6-minute-english"`，即使某期 front matter 漏写 type 也会使用该 layout。
- `type: "6-minute-english"` 对应 `layouts/6-minute-english/single.html`；如果不想用此 layout，Hugo 会回退到 `_default/single.html`。
- Transcript 可从 `transcript.txt`（纯文本）或 `transcript.pdf` 获取；`index.md` body 中也包含了格式化的 Markdown 版。

## 同步到另一个 GitHub 仓库（自动部署）

脚本每次执行后，可选地把生成的 `tmp/<ep-YYMMDD>/` 内容同步到**另一个 Hugo 仓库**的指定目录，并直接提交到目标分支（默认 `main`）。目标仓库更新后即可自动触发 Netlify 构建。

### 配置

复制 `.env.example` 为 `.env` 并填写：

```dotenv
GIT_SYNC_ENABLED=true
GIT_SYNC_REPO=git@github.com:user/hugo-site.git
GIT_SYNC_BRANCH=main
GIT_SYNC_CONTENT_DIR=content/6-minute-english
# GIT_SYNC_WORKDIR=tmp/.sync-repo
# GIT_SYNC_TOKEN=            # HTTPS 仓库专用
# GIT_SYNC_COMMIT_NAME=bot
# GIT_SYNC_COMMIT_EMAIL=bot@example.com
```

说明：

- `GIT_SYNC_REPO`：目标仓库（SSH 或 HTTPS）。SSH 方式依赖本机 SSH key / ssh-agent；HTTPS 方式可配 `GIT_SYNC_TOKEN`。
- 同步会把 `tmp/<ep-YYMMDD>/` 下的文件写入目标仓库的 `<GIT_SYNC_CONTENT_DIR>/<ep-YYMMDD>/`。
- 目录**已存在则覆盖更新**（例如重跑同一天），随后提交并 push 到目标分支，无变化时不会产生提交。
- `GIT_SYNC_WORKDIR` 是本地缓存的克隆目录（默认 `tmp/.sync-repo`，已被 `.gitignore` 忽略）。

> 注意：`index.md` 的 `date` 为脚本运行时间，因此**每天运行都会更新该字段并生成一次提交**（进而触发一次 Netlify 构建）。若只想在新一期发布时提交，可在 cron 中判断是否出现新目录，或改为使用节目日期。

## 定时运行（建议）

每天运行一次即可获取最新一期。可配合 cron：

```cron
0 9 * * * cd /path/to/tmp-scripts && pnpm start >> /path/to/log.txt 2>&1
```

## 说明

- `index.md` 的 front matter 使用 **TOML**（`+++` 包裹），字段包含 `title`、`date`、`type`、`slug`、`episode_id`、`original_address`、`audio`、`transcript`、`transcript_pdf` 等。
- `index.md` 的 `date` 使用**生成时间**（脚本运行/创建当前页面时），不是网站内容日期。
- `meta.json` 中的 `date` 为节目日期，由 episode code 推导：`261008 → 2026-10-08T00:00:00Z`。
- Transcript 提取基于页面富文本结构，依赖 `not a word-for-word transcript` 标记及结束标记（`What do you think of the new version` 或 `learningenglish@bbc.co.uk`）；如页面结构变化可能需微调。
- 仅抓取内容列表首个条目（即当前最新一期）。
