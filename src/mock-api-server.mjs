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

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    try {
      const body = await readJsonBody(req);
      const query = extractQuery(body);
      const content = `MOCK_REPLY: ${query || "(empty query)"}`;

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
