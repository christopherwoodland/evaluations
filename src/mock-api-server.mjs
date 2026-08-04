import http from "node:http";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function extractQuery(body) {
  if (typeof body?.query === "string" && body.query.trim()) return body.query;
  const msg = body?.messages?.[0]?.content;
  if (typeof msg === "string" && msg.trim()) return msg;
  return "";
}

function extractProvidedReferences(promptText) {
  const text = String(promptText || "");
  const marker = "Provided document references:";
  const idx = text.indexOf(marker);
  if (idx < 0) return [];

  const lines = text.slice(idx + marker.length).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const refs = [];
  let current = null;

  for (const line of lines) {
    if (/^Please provide citations\/sources/i.test(line)) break;
    if (line.startsWith("- Source title:")) {
      if (current) refs.push(current);
      current = { title: line.replace(/^- Source title:\s*/i, "").trim() };
      continue;
    }
    if (/^URL:/i.test(line)) {
      if (!current) current = {};
      current.url = line.replace(/^URL:\s*/i, "").trim();
      continue;
    }
    if (/^Ref path:/i.test(line)) {
      if (!current) current = {};
      current.ref = line.replace(/^Ref path:\s*/i, "").trim();
      continue;
    }
  }

  if (current) refs.push(current);
  return refs.filter((ref) => ref.title || ref.url || ref.ref);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    try {
      const body = await readJsonBody(req);
      const query = extractQuery(body);
      const refs = extractProvidedReferences(query);
      const sourceBlock = refs.length
        ? `\n\n**Sources**\n\n${refs.map((ref) => [
            `- Source title: ${ref.title || "Unknown"}`,
            ref.url ? `URL: ${ref.url}` : "",
            ref.ref ? `Ref path: ${ref.ref}` : "",
          ].filter(Boolean).join("\n")).join("\n")}`
        : "";
      const content = `MOCK_REPLY: ${query || "(empty query)"}${sourceBlock}`;

      const payload = {
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const requestedPort = Number(process.env.MOCK_API_PORT || "17991");
const host = "127.0.0.1";

server.listen(requestedPort, host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  console.log(`MOCK_API_READY http://${host}:${port}/chat`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
