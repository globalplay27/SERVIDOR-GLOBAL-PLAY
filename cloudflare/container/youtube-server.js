import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const active = new Map();

function json(res, status, value) {
  const raw = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(raw.length),
    "cache-control": "no-store"
  });
  res.end(raw);
}

async function bodyJson(req, max = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function youtubeUrl(value) {
  const raw = String(value || "").trim();
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || !["youtube.com","youtu.be"].includes(host)) {
    throw new Error("invalid_trailer_url");
  }
  return url.toString();
}

async function notifyFailure(jobId, clientId, error) {
  try {
    await fetch("http://nexus-status/fail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId,
        clientId,
        error: String(error?.message || error || "trailer_download_failed").slice(0, 500)
      })
    });
  } catch {}
}

async function runImport(job) {
  const { jobId, clientId, sourceUrl, title } = job;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nexus-"));
  const output = path.join(dir, "video.%(ext)s");
  try {
    const url = youtubeUrl(sourceUrl);
    const common = [
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout", "30",
      "--retries", "3",
      "--fragment-retries", "3",
      "--concurrent-fragments", "4",
      "--max-filesize", "750M",
      "--merge-output-format", "mp4",
      "--restrict-filenames",
      "-o", output
    ];

    let lastError = null;
    for (const extra of [
      ["--extractor-args", "youtube:player_client=web_embedded", "--referer", "https://www.youtube.com/"],
      []
    ]) {
      try {
        await execFileAsync("yt-dlp", [
          ...common,
          ...extra,
          "-f", "b[ext=mp4][height<=480]/b[height<=480]/best[height<=480]",
          url
        ], { timeout: 8 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;

    const entries = await fs.promises.readdir(dir);
    const candidate = entries
      .filter(name => /^video\./.test(name))
      .map(name => ({ name, full: path.join(dir, name) }))
      .map(item => ({ ...item, size: fs.statSync(item.full).size }))
      .filter(item => item.size > 0)
      .sort((a,b) => b.size - a.size)[0];
    if (!candidate) throw new Error("trailer_download_empty");
    if (candidate.size > 750 * 1024 * 1024) throw new Error("video_too_large");

    const ext = path.extname(candidate.name).toLowerCase() || ".mp4";
    const contentType = ext === ".webm" ? "video/webm" : "video/mp4";
    const safeTitle = String(title || "trailer").replace(/[\r\n]/g, " ").slice(0, 160);

    const upload = await fetch("http://nexus-r2/upload", {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "content-length": String(candidate.size),
        "x-nexus-job-id": String(jobId),
        "x-nexus-client-id": String(clientId),
        "x-nexus-title": encodeURIComponent(safeTitle),
        "x-nexus-extension": ext.replace(/^\./, "")
      },
      body: Readable.toWeb(fs.createReadStream(candidate.full)),
      duplex: "half"
    });
    if (!upload.ok) {
      const detail = await upload.text().catch(() => "");
      throw new Error("r2_upload_failed_" + upload.status + ":" + detail.slice(0, 200));
    }
  } catch (error) {
    await notifyFailure(jobId, clientId, error);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    active.delete(jobId);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") return json(res, 200, { ok: true, active: active.size });
    if (url.pathname !== "/import" || req.method !== "POST") {
      return json(res, 404, { error: "not_found" });
    }
    const body = await bodyJson(req);
    const jobId = String(body.jobId || "").trim();
    const clientId = String(body.clientId || "").trim();
    const sourceUrl = String(body.sourceUrl || "").trim();
    if (!jobId || !clientId || !sourceUrl) return json(res, 400, { error: "missing_fields" });
    youtubeUrl(sourceUrl);
    if (!active.has(jobId)) {
      const promise = runImport({
        jobId,
        clientId,
        sourceUrl,
        title: String(body.title || "trailer")
      });
      active.set(jobId, promise);
    }
    return json(res, 202, { ok: true, jobId, status: "accepted" });
  } catch (error) {
    return json(res, 400, { error: String(error?.message || error) });
  }
});

server.listen(PORT, "0.0.0.0");
