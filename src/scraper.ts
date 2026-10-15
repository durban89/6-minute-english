import * as cheerio from "cheerio";

export const LISTING_URL =
  "https://www.bbc.co.uk/learningenglish/features/6-minute-english";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) {
    throw new Error(`Request failed for ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Download failed for ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function getFirstContentUrl(): Promise<string> {
  const html = await fetchText(LISTING_URL);
  const $ = cheerio.load(html);

  const article = $('div[role="article"]').first();
  if (article.length === 0) {
    throw new Error('Could not find <div role="article">');
  }

  const href = article
    .find(".widget-bbcle-coursecontentlist a[href]")
    .first()
    .attr("href");

  if (!href) {
    throw new Error("Could not find a content link in the article");
  }

  return new URL(href, LISTING_URL).toString();
}

export interface EpisodeAssets {
  originalAddress: string;
  title: string;
  date: string;
  episodeCode: string;
  audioUrl: string;
  transcriptUrl: string;
  transcriptText: string;
  transcriptMarkdown: string;
}

export function parseEpisode(html: string, episodeUrl: string): EpisodeAssets {
  const normalized = html.replace(/<br\s*\/?>/gi, "\n");
  const $ = cheerio.load(normalized);

  const rawTitle = $("title").text().trim();
  const title = rawTitle.includes(" / ")
    ? rawTitle.split(" / ").slice(1).join(" / ").trim()
    : rawTitle;

  const slug = new URL(episodeUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  const episodeCode = slug.replace(/^ep-/, "");

  const downloads = $(".widget-pagelink-download");

  const audioHref = downloads.find('a[href$=".mp3"]').first().attr("href");
  if (!audioHref) {
    throw new Error("Audio (mp3) link not found");
  }

  const transcriptHref = downloads
    .find('a[href$=".pdf"]')
    .filter((_, el) => /transcript\.pdf$/i.test($(el).attr("href") ?? ""))
    .first()
    .attr("href");
  if (!transcriptHref) {
    throw new Error("Transcript (pdf) link not found");
  }

  const transcript = extractTranscript($);

  return {
    originalAddress: episodeUrl,
    title,
    date: deriveDate(episodeCode),
    episodeCode,
    audioUrl: new URL(audioHref, episodeUrl).toString(),
    transcriptUrl: new URL(transcriptHref, episodeUrl).toString(),
    transcriptText: transcript.text,
    transcriptMarkdown: transcript.markdown,
  };
}

function deriveDate(episodeCode: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(episodeCode);
  if (!match) {
    return new Date().toISOString();
  }
  const [, yy, mm, dd] = match;
  return `20${yy}-${mm}-${dd}T00:00:00Z`;
}

function isSpeaker(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= 30 &&
    !text.includes(":") &&
    !/\.$/.test(text) &&
    /^[A-Z][A-Za-z'’.-]*(?: [A-Z][A-Za-z'’.-]*){0,3}$/.test(text)
  );
}

function cleanLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function extractTranscript($: cheerio.CheerioAPI): { text: string; markdown: string } {
  const widget = $("div.widget-richtext").first();
  const textLines: string[] = [];
  const mdBlocks: string[] = [];
  let started = false;
  let stop = false;

  widget.find("p").each((_, el) => {
    if (stop) {
      return false;
    }

    const parts: { speaker?: string; text: string }[] = [];
    let current: { speaker?: string; text: string } = { text: "" };

    $(el)
      .contents()
      .each((__, node: any) => {
        if (node?.type === "text") {
          current.text += node.data ?? "";
        } else if (node?.name === "br") {
          current.text += "\n";
        } else if (node?.name === "strong") {
          const label = $(node).text().replace(/\u00a0/g, " ").trim();
          if (isSpeaker(label)) {
            if (current.text.trim() || current.speaker) {
              parts.push(current);
            }
            current = { speaker: label, text: "" };
          } else {
            current.text += $(node).text();
          }
        } else {
          current.text += $(node).text();
        }
      });

    if (current.text.trim() || current.speaker) {
      parts.push(current);
    }

    for (const part of parts) {
      const lines = cleanLines(part.text);
      const joined = lines.join(" ");

      if (!started) {
        if (/not a word-for-word transcript/i.test(joined)) {
          started = true;
          textLines.push(...lines);
          mdBlocks.push(joined);
        }
        continue;
      }

      if (
        /what do you think of the new version/i.test(joined) ||
        /learningenglish@bbc\.co\.uk/i.test(joined)
      ) {
        stop = true;
        break;
      }

      if (part.speaker) {
        textLines.push(part.speaker, ...lines);
        mdBlocks.push(joined ? `**${part.speaker}:** ${joined}` : `**${part.speaker}:**`);
      } else if (lines.length > 0) {
        textLines.push(...lines);
        mdBlocks.push(joined);
      }
    }
  });

  return {
    text: textLines.join("\n"),
    markdown: mdBlocks.join("\n\n"),
  };
}
