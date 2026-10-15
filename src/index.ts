import { mkdir, writeFile, access, rm, copyFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fetchBuffer, fetchText, getFirstContentUrl, parseEpisode } from "./scraper.js";
import { spawn } from "node:child_process";
import { config } from "dotenv";

config();

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

  await syncToRepo(dir, id);
}

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${err.trim() || out.trim()}`));
    });
  });
}

function withToken(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  if (!/^https?:\/\//.test(repoUrl)) return repoUrl;
  const u = new URL(repoUrl);
  u.username = token;
  u.password = "";
  return u.toString();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDirContents(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirContents(from, to);
    } else {
      await copyFile(from, to);
    }
  }
}

async function syncToRepo(bundleDir: string, id: string): Promise<void> {
  const enabled = (process.env.GIT_SYNC_ENABLED ?? "").toLowerCase();
  if (enabled !== "true" && enabled !== "1" && enabled !== "yes") {
    console.log("Git sync disabled (set GIT_SYNC_ENABLED=true to enable).");
    return;
  }

  const repoUrl = process.env.GIT_SYNC_REPO;
  if (!repoUrl) {
    throw new Error("GIT_SYNC_ENABLED is set but GIT_SYNC_REPO is missing.");
  }

  const branch = process.env.GIT_SYNC_BRANCH || "main";
  const contentDir = (process.env.GIT_SYNC_CONTENT_DIR || "content/6-minute-english").replace(/^\/+|\/+$/g, "");
  const workDir = path.resolve(process.env.GIT_SYNC_WORKDIR || path.join(process.cwd(), "tmp", ".sync-repo"));
  const token = process.env.GIT_SYNC_TOKEN;
  const cloneUrl = withToken(repoUrl, token);
  const commitMessage =
    process.env.GIT_SYNC_COMMIT_MESSAGE || `chore: sync ${id} (6 minute english)`;

  const authorName = process.env.GIT_SYNC_COMMIT_NAME;
  const authorEmail = process.env.GIT_SYNC_COMMIT_EMAIL;

  console.log(`Syncing ${id} to ${repoUrl} (${branch}:${contentDir}/)...`);

  try {
    if (!(await pathExists(path.join(workDir, ".git")))) {
      await rm(workDir, { recursive: true, force: true });
      await mkdir(path.dirname(workDir), { recursive: true });
      await run("git", ["clone", "--branch", branch, "--depth", "1", cloneUrl, workDir]);
    } else {
      await run("git", ["remote", "set-url", "origin", cloneUrl], workDir);
      await run("git", ["fetch", "origin", branch, "--depth", "1"], workDir);
      await run("git", ["checkout", branch], workDir);
      await run("git", ["reset", "--hard", `origin/${branch}`], workDir);
    }
  } catch (err) {
    throw new Error(`Failed to prepare sync repo: ${err instanceof Error ? err.message : err}`);
  }

  const destDir = path.join(workDir, contentDir, id);
  await copyDirContents(bundleDir, destDir);

  const git = (args: string[]) => run("git", args, workDir);
  if (authorName) await git(["config", "user.name", authorName]);
  if (authorEmail) await git(["config", "user.email", authorEmail]);

  await git(["add", "--", path.join(contentDir, id)]);

  const status = await git(["status", "--porcelain"]);
  if (!status) {
    console.log("No changes to sync (already up to date).");
    return;
  }

  await git(["commit", "-m", commitMessage]);
  await git(["push", "origin", branch]);
  console.log(`Pushed ${id} -> ${repoUrl} (${branch}/${contentDir}/${id})`);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTomlString(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const items = v.map((x) => JSON.stringify(x)).join(", ");
    return `[${items}]`;
  }
  return JSON.stringify(v);
}

function buildIndexMd(episode: {
  title: string;
  date: string;
  episodeCode: string;
  originalAddress: string;
  transcriptMarkdown: string;
}): string {
  const baseSlug = slugify(episode.title) || `ep-${episode.episodeCode}`;
  const slug = baseSlug.endsWith(`-${episode.episodeCode}`)
    ? baseSlug
    : `${baseSlug}-${episode.episodeCode}`;

  const lines: string[] = [];
  lines.push("+++", "title = " + toTomlString(episode.title), "date = " + toTomlString(new Date().toISOString()), 'type = "6-minute-english"', "draft = false", 'categories = ["English", "6 Minute English"]', 'tags = ["bbc", "listening", "vocabulary", "6-minute-english"]', "slug = " + toTomlString(slug), "episode_id = " + toTomlString(episode.episodeCode), "original_address = " + toTomlString(episode.originalAddress), 'audio = "audio.mp3"', 'transcript = "transcript.txt"', 'transcript_pdf = "transcript.pdf"', "+++", "");

  const body = [
    `{{< audio src="audio.mp3" >}}`,
    "",
    "## Transcript",
    "",
    episode.transcriptMarkdown,
    "",
  ].join("\n");

  return lines.join("\n") + body;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
