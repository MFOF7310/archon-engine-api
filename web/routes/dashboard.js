module.exports = {
    path: '/',
    method: 'GET',
    handler(req, res, client, db) {
        const guilds = client.guilds?.cache?.size || 0;
        const users = client.guilds?.cache?.reduce((a, g) => a + g.memberCount, 0) || 0;
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
        const uptimeSec = process.uptime();
        const uptimeStr = `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>ARCHITECT CG-223</title><style>
body{background:#0a0a0f;color:#00ff88;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.container{border:1px solid #00ff88;padding:40px;max-width:600px;width:90%}
h1{text-align:center;text-shadow:0 0 10px #00ff88}
.stat{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #003311}
.endpoints{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:20px}
.endpoint{background:#00ff88;color:#0a0a0f;padding:3px 10px;font-size:.7rem;font-weight:bold}
.footer{text-align:center;font-size:.75rem;opacity:.5;margin-top:20px;border-top:1px solid #00ff88;padding-top:20px}
</style></head>
<body>
<div class="container">
<h1>⚡ ARCHITECT CG-223</h1>
<div class="stat"><span>Servers</span><span>${guilds}</span></div>
<div class="stat"><span>Users</span><span>${users.toLocaleString()}</span></div>
<div class="stat"><span>Memory</span><span>${mem} MB</span></div>
<div class="stat"><span>Uptime</span><span>${uptimeStr}</span></div>
<div class="stat"><span>Ping</span><span>${Math.round(client.ws.ping || 0)}ms</span></div>
<div class="stat"><span>Version</span><span>v${client.version || '2.0.0'}</span></div>
<div class="endpoints">
<div class="endpoint">GET /health</div>
<div class="endpoint">GET /api/status</div>
<div class="endpoint">POST /webhook/topgg</div>
<div class="endpoint">POST /webhook/dodo</div>
</div>
<div class="footer">
Built by Moussa Fofana // BAMAKO_223 🇲🇱<br>
Server: 556108
</div>
</div>
</body>
</html>`);
    }
};
