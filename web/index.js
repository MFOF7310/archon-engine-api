const http = require('http');
const fs = require('fs');
const path = require('path');

module.exports = function startWebLayer(client, db, port) {
    const routes = new Map();

    // Auto-discover all route files
    const routesDir = path.join(__dirname, 'routes');
    if (fs.existsSync(routesDir)) {
        fs.readdirSync(routesDir)
            .filter(f => f.endsWith('.js'))
            .forEach(file => {
                try {
                    const mod = require(path.join(routesDir, file));
                    if (mod.path && typeof mod.handler === 'function') {
                        const key = `${mod.method || 'GET'}:${mod.path}`;
                        routes.set(key, mod.handler);
                        console.log(`\x1b[36m[WEB]\x1b[0m Mounted ${key} (${file})`);
                    }
                } catch (e) {
                    console.log(`\x1b[33m[WEB]\x1b[0m Skipped ${file}: ${e.message}`);
                }
            });
    }

    const server = http.createServer((req, res) => {
        // Universal CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            return res.end();
        }

        const lookupKey = `${req.method}:${req.url}`;
        const handler = routes.get(lookupKey) || routes.get(`GET:${req.url}`);

        if (handler) {
            return handler(req, res, client, db);
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
    });

    server.listen(port, () => {
        console.log(`\x1b[32m[WEB]\x1b[0m Layer active on port ${port} — ${routes.size} route(s)`);
        console.log(`\x1b[32m[WEB]\x1b[0m Dashboard: http://localhost:${port}/`);
        console.log(`\x1b[32m[WEB]\x1b[0m API: http://localhost:${port}/api/status`);
        console.log(`\x1b[32m[WEB]\x1b[0m Webhooks: /webhook/topgg | /webhook/dodo`);
    }).on('error', (err) => {
        console.log(`\x1b[33m[WEB]\x1b[0m Port ${port} unavailable: ${err.message}`);
    });
};
