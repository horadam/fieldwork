import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { MAX_JOB_SOURCE_CHARS } from "./domain";

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export class JobPageError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
const denied = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(ip, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(ip, prefix, "ipv6");
export function publicAddress(ip: string) {
  const version = isIP(ip);
  return version === 4
    ? !denied.check(ip, "ipv4")
    : version === 6 && globalV6.check(ip, "ipv6") && !denied.check(ip, "ipv6");
}
export function publicPageUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JobPageError(
      "Enter a complete public HTTPS job listing URL.",
      400,
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    raw.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (!hostname.includes(".") && !isIP(hostname)) ||
    /(^|\.)(localhost|local|internal|test|invalid)\.?$/i.test(hostname) ||
    (isIP(hostname) && !publicAddress(hostname))
  )
    throw new JobPageError(
      "Use a public HTTPS job listing without login credentials or a custom port. You can paste the JD text instead.",
      400,
    );
  url.hash = "";
  return url;
}
type Address = { address: string; family: number };
type Hop = {
  status: number;
  location?: string;
  contentType: string;
  body: Uint8Array;
};
type Resolve = (hostname: string) => Promise<Address[]>;
type Transport = (
  url: URL,
  address: Address,
  signal: AbortSignal,
) => Promise<Hop>;
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export const httpsPage: Transport = (url, address, signal) =>
  new Promise((resolve, reject) => {
    // DNS is checked once and pinned into the socket lookup. TLS verification still
    // checks the original hostname. Do not replace this with an unpinned fetch().
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        family: address.family,
        signal,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          Accept: gemApiUrl(url)
            ? "application/json"
            : "text/html,application/xhtml+xml,text/plain",
          "Accept-Encoding": "identity",
          "User-Agent": "Fieldwork-Job-Import/1.0",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          resolve({
            status,
            location: response.headers.location,
            contentType: "",
            body: new Uint8Array(),
          });
          return;
        }
        if (status !== 200) {
          response.destroy();
          resolve({ status, contentType: "", body: new Uint8Array() });
          return;
        }
        const contentType = response.headers["content-type"] || "";
        if (
          !/^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/i.test(
            contentType,
          ) &&
          !(gemApiUrl(url) && /^application\/json(;|$)/i.test(contentType))
        ) {
          response.destroy();
          reject(
            new JobPageError(
              "This URL did not return a readable HTML/text page. Paste the job description instead.",
            ),
          );
          return;
        }
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy();
          reject(
            new JobPageError(
              "This site requires a page format the importer cannot read. Paste the JD text instead.",
            ),
          );
          return;
        }
        if (Number(response.headers["content-length"]) > MAX_PAGE_BYTES) {
          response.destroy();
          reject(
            new JobPageError(
              "This page is too large to import. Paste just the job description instead.",
              413,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_PAGE_BYTES) {
            response.destroy(
              new JobPageError(
                "This page is too large to import. Paste just the job description instead.",
                413,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({ status, contentType, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  hellip: "…",
};
function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, key: string) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] ?? whole;
    const value =
      key[1]?.toLowerCase() === "x"
        ? parseInt(key.slice(2), 16)
        : parseInt(key.slice(1), 10);
    return value > 0 &&
      value <= 0x10ffff &&
      !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : "�";
  });
}
// Bounded tag matching plus forward-only skips keep malformed pages from
// repeatedly scanning the entire remaining document for a missing closing tag.
export function htmlText(html: string) {
  const lower = html.toLowerCase(),
    parts: string[] = [];
  const tags = /<!--|<\/?([a-z][a-z0-9:-]*)\b[^<>]{0,4096}>/gi;
  let cursor = 0,
    match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    parts.push(html.slice(cursor, match.index));
    if (match[0] === "<!--") {
      const end = html.indexOf("-->", tags.lastIndex);
      cursor = end < 0 ? html.length : end + 3;
      tags.lastIndex = cursor;
      continue;
    }
    const name = match[1].toLowerCase();
    if (
      !match[0].startsWith("</") &&
      /^(script|style|noscript|template|svg|nav|footer|header|form)$/.test(name)
    ) {
      const end = lower.indexOf(`</${name}`, tags.lastIndex),
        close = end < 0 ? -1 : html.indexOf(">", end);
      cursor = close < 0 ? html.length : close + 1;
      tags.lastIndex = cursor;
      parts.push(" ");
      continue;
    }
    parts.push(
      name === "br" ||
        (match[0].startsWith("</") &&
          /^(p|div|li|h[1-6]|section|article|main|tr)$/.test(name))
        ? "\n"
        : " ",
    );
    cursor = tags.lastIndex;
  }
  parts.push(html.slice(cursor));
  return decodeEntities(parts.join(""))
    .replace(/\r/g, "")
    .replace(/[\t \f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function contents(input: string, name: string) {
  const open = new RegExp(`<${name}\\b[^<>]{0,4096}>`, "i").exec(input);
  if (!open) return undefined;
  const end = input
    .toLowerCase()
    .indexOf(`</${name}`, open.index + open[0].length);
  return end < 0 ? undefined : input.slice(open.index + open[0].length, end);
}

function postings(
  value: unknown,
  found: Record<string, unknown>[],
  depth = 0,
): void {
  if (depth > 15 || found.length >= 10 || !value || typeof value !== "object")
    return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) postings(item, found, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    record["@type"] === "JobPosting" ||
    (Array.isArray(record["@type"]) && record["@type"].includes("JobPosting"))
  )
    found.push(record);
  if (record["@graph"]) postings(record["@graph"], found, depth + 1);
}
export function extractPageText(input: string, contentType = "text/html") {
  if (contentType.startsWith("text/plain"))
    return { title: "", text: input.trim(), warnings: [] as string[] };
  const title = htmlText(contents(input, "title") || "").slice(0, 300);
  const found: Record<string, unknown>[] = [];
  const scripts = /<script\b[^<>]{0,4096}>/gi;
  let script: RegExpExecArray | null;
  const lower = input.toLowerCase();
  while ((script = scripts.exec(input))) {
    const end = lower.indexOf("</script", scripts.lastIndex);
    if (end < 0) break;
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(script[0])) {
      try {
        postings(JSON.parse(input.slice(scripts.lastIndex, end)), found);
      } catch {
        /* Fall back to readable HTML. */
      }
    }
    scripts.lastIndex = end + 8;
  }
  if (found.length === 1 && typeof found[0].description === "string") {
    const job = found[0],
      org = job.hiringOrganization as Record<string, unknown> | undefined;
    const text = [
      typeof job.title === "string" ? job.title : "",
      org && typeof org.name === "string" ? org.name : "",
      htmlText(job.description as string),
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      title,
      text,
      warnings: [
        "Read from the page’s structured job listing. Review it against the visible listing before saving.",
      ],
    };
  }
  const main =
    contents(input, "main") ??
    contents(input, "article") ??
    input.replace(/<head\b[^<>]{0,4096}>[\s\S]*?<\/head\s*>/i, "");
  return {
    title,
    text: htmlText(main),
    warnings: [
      found.length > 1
        ? "This page contains multiple jobs. Keep only the intended job description before extraction."
        : "Review the extracted text: navigation or unrelated page content may remain.",
    ],
  };
}
function gemApiUrl(url: URL) {
  return (
    url.hostname === "api.gem.com" &&
    /^\/job_board\/v0\/[a-zA-Z0-9_-]+\/job_posts\/(?:[a-zA-Z0-9_-]+)?$/.test(
      url.pathname,
    )
  );
}
function gemListing(url: URL) {
  if (url.hostname !== "jobs.gem.com") return null;
  const parts = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/?$/);
  return parts ? { board: parts[1], id: parts[2] } : null;
}
function gemJobText(raw: unknown, listing: URL) {
  const target = gemListing(listing)!;
  // Never choose a job by a fuzzy title or by its position in a board response.
  const matches = (record: Record<string, unknown>) => {
    if (
      ["id", "external_id", "externalId"].some(
        (key) => record[key] === target.id,
      )
    )
      return true;
    return [
      "url",
      "absolute_url",
      "job_post_url",
      "jobPostUrl",
      "apply_url",
    ].some((key) => {
      if (typeof record[key] !== "string") return false;
      try {
        const candidate = new URL(record[key]);
        const item = gemListing(candidate);
        return (
          candidate.protocol === "https:" &&
          item?.board === target.board &&
          item.id === target.id
        );
      } catch {
        return false;
      }
    });
  };
  const candidates: Record<string, unknown>[] = [];
  function collect(value: unknown, depth = 0) {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 2000)) collect(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (matches(record)) candidates.push(record);
    for (const key of [
      "data",
      "job_post",
      "jobPost",
      "job_posts",
      "jobs",
      "job",
    ])
      if (record[key]) collect(record[key], depth + 1);
  }
  collect(raw);
  if (candidates.length !== 1) return null;
  const job = candidates[0];
  const description = [
    "description",
    "content",
    "description_html",
    "descriptionHtml",
  ]
    .map((key) => job[key])
    .find((value) => typeof value === "string" && htmlText(value).length >= 80);
  if (typeof description !== "string") return null;
  const title = typeof job.title === "string" ? job.title : "";
  const company =
    typeof job.company_name === "string"
      ? job.company_name
      : typeof job.company === "string"
        ? job.company
        : "";
  const intro = typeof job.intro === "string" ? htmlText(job.intro) : "";
  const outro = typeof job.outro === "string" ? htmlText(job.outro) : "";
  return {
    title,
    text: [company, title, intro, htmlText(description), outro]
      .filter(Boolean)
      .join("\n\n"),
    warnings: [
      "Read from Gem’s public job data. Review the full description against the listing before saving.",
    ],
  };
}
export async function fetchJobPage(
  raw: string,
  signal?: AbortSignal,
  deps: { resolve?: Resolve; transport?: Transport } = {},
) {
  const deadline = AbortSignal.timeout(15000),
    combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  const resolve =
    deps.resolve ?? ((host) => lookup(host, { all: true, verbatim: true }));
  const transport = deps.transport ?? httpsPage;
  const original = publicPageUrl(raw);
  async function read(initial: URL) {
    let url = initial;
    const seen = new Set<string>();
    for (let hop = 0; hop <= 3; hop++) {
      combined.throwIfAborted();
      if (seen.has(url.href))
        throw new JobPageError(
          "This page has a redirect loop. Paste the JD text instead.",
        );
      seen.add(url.href);
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await bounded(resolve(host), combined);
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new JobPageError(
          "This URL is not a public job listing. Paste the JD text instead.",
          400,
        );
      const response = await bounded(
        transport(url, addresses[0], combined),
        combined,
      );
      if (response.body.length > MAX_PAGE_BYTES)
        throw new JobPageError(
          "This page is too large. Paste the JD text instead.",
          413,
        );
      if (response.status >= 300 && response.status < 400) {
        if (!response.location || hop === 3)
          throw new JobPageError(
            "This page has too many redirects. Paste the JD text instead.",
          );
        url = publicPageUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status !== 200)
        throw new JobPageError(
          `This site could not be read (HTTP ${response.status}). It may require login, block fetching, or have removed the listing. Paste the JD text instead.`,
          response.status === 404 ? 404 : 422,
        );
      const charset =
        response.contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ||
        "utf-8";
      let content: string;
      try {
        content = new TextDecoder(charset).decode(response.body);
      } catch {
        throw new JobPageError(
          "The page’s text encoding is unsupported. Paste the JD text instead.",
        );
      }
      return { content, contentType: response.contentType, url };
    }
    throw new JobPageError(
      "The page could not be imported. Paste the JD text instead.",
    );
  }
  try {
    const page = await read(original);
    let result = extractPageText(page.content, page.contentType);
    const gem = gemListing(page.url);
    if (result.text.length < 80 && gem) {
      const base = `https://api.gem.com/job_board/v0/${gem.board}/job_posts/`;
      try {
        let response;
        try {
          response = await read(new URL(`${base}${gem.id}`));
        } catch (error) {
          if (!(error instanceof JobPageError) || error.status !== 404)
            throw error;
          response = await read(new URL(base));
        }
        if (!/^application\/json(;|$)/i.test(response.contentType))
          throw new Error("Not job JSON");
        const job = gemJobText(JSON.parse(response.content), page.url);
        if (job) result = job;
      } catch (error) {
        if (combined.aborted)
          throw error; /* Keep the manual fallback; never use unrelated jobs or expose API bodies. */
      }
      if (result.text.length < 80)
        throw new JobPageError(
          "Gem returned a JavaScript page, and its public job data did not provide a matching description. Open the listing, copy the JD, and paste it below.",
        );
    }
    if (result.text.length < 80)
      throw new JobPageError(
        "Not enough readable job text was found. This page may need JavaScript or login. Paste the JD text instead.",
      );
    if (result.text.length > MAX_JOB_SOURCE_CHARS)
      throw new JobPageError(
        "This page contains too much text. Paste just the job description (up to 30,000 characters) instead.",
        413,
      );
    return { ...result, url: page.url.href };
  } catch (error) {
    if (error instanceof JobPageError) throw error;
    if (combined.aborted)
      throw new JobPageError(
        signal?.aborted
          ? "Page fetching was cancelled."
          : "Page fetching timed out after 15 seconds. Paste the JD text instead.",
        signal?.aborted ? 499 : 504,
      );
    throw new JobPageError(
      "The page could not be fetched. Check the URL or paste the job description instead.",
      502,
    );
  }
}
