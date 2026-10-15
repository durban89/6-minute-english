import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBuffer, fetchText, getFirstContentUrl, parseEpisode } from "./scraper.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "tmp");

async function main(): Promise<void> {
  const originalAddress = await getFirstContentUrl();
  console.log(`Original address: ${originalAddress}`);

  const html = await fetchText(originalAddress);
  const episode = parseEpisode(html, originalAddress);

  const id = episode.episodeCode ? `ep-${episode.episodeCode}` : new URL(originalAddress).pathname.split("/").filter(Boolean).pop() ?? "episode";
  const dir = path.join(OUTPUT_DIR, id);
  await mkdir(dir, { recursive: true });

  const audioPath = path.join(dir, "audio.mp3");
  const transcriptPdfPath = path.join(dir, "transcript.pdf");
  const transcriptTextPath = path.join(dir, "transcript.txt");
  const indexMdPath = path.join(dir, "index.md");
  const metaPath = path.join(dir, "meta.json");

  const [audio, transcriptPdf] = await Promise.all([
    fetchBuffer(episode.audioUrl),
    fetchBuffer(episode.transcriptUrl),
  ]);

  await writeFile(audioPath, audio);
  await writeFile(transcriptPdfPath, transcriptPdf);
  await writeFile(transcriptTextPath, `${episode.transcriptText}\n`);
  await writeFile(indexMdPath, buildIndexMd(episode));

  const meta = {
    originalAddress,
    title: episode.title,
    date: episode.date,
    episodeCode: episode.episodeCode,
    audioUrl: episode.audioUrl,
    transcriptUrl: episode.transcriptUrl,
    files: {
      audio: path.relative(process.cwd(), audioPath),
      transcriptPdf: path.relative(process.cwd(), transcriptPdfPath),
      transcriptText: path.relative(process.cwd(), transcriptTextPath),
      indexMd: path.relative(process.cwd(), indexMdPath),
    },
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  const rel = path.relative(process.cwd(), dir);
  console.log(`Saved episode files to ${rel}/`);
  console.log(`  audio.mp3        ${audio.length} bytes`);
  console.log(`  transcript.pdf   ${transcriptPdf.length} bytes`);
  console.log(`  transcript.txt   ${episode.transcriptText.length} chars`);
  console.log(`  index.md         ${episode.transcriptMarkdown.length} chars`);
  console.log(`  meta.json`);
}

function buildIndexMd(episode: {
  title: string;
  date: string;
  episodeCode: string;
  originalAddress: string;
  transcriptMarkdown: string;
}): string {
  const frontMatter = [
    "---",
    `title: ${JSON.stringify(episode.title)}`,
    `date: ${new Date().toISOString()}`,
    `type: "6-minute-english"`,
    `draft: false`,
    `categories: ["English", "6 Minute English"]`,
    `tags: ["bbc", "listening", "vocabulary", "6-minute-english"]`,
    `slug: ${JSON.stringify(`ep-${episode.episodeCode}`)}`,
    `episode_id: ${JSON.stringify(episode.episodeCode)}`,
    `original_address: ${JSON.stringify(episode.originalAddress)}`,
    `audio: "audio.mp3"`,
    `transcript: "transcript.txt"`,
    `transcript_pdf: "transcript.pdf"`,
    "---",
    "",
  ].join("\n");

  const body = [
    `{{< audio src="audio.mp3" >}}`,
    "",
    "## Transcript",
    "",
    episode.transcriptMarkdown,
    "",
  ].join("\n");

  return `${frontMatter}\n${body}`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
