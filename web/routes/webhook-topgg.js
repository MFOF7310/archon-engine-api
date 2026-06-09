module.exports = {
    path: '/webhook/topgg',
    method: 'POST',
    handler(req, res, client, db) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const auth = req.headers.authorization;
                if (process.env.TOPGG_WEBHOOK_SECRET && auth !== process.env.TOPGG_WEBHOOK_SECRET) {
                    res.writeHead(401);
                    return res.end(JSON.stringify({ error: 'Unauthorized' }));
                }

                const data = JSON.parse(body);
                console.log(`\x1b[32m[TOP.GG]\x1b[0m Vote: ${data.user}`);

                if (data.user && client.addCredits) {
                    client.addCredits(data.user, 'DM', 500);
                }

                // Track vote in DB
                try {
                    db.exec(`CREATE TABLE IF NOT EXISTS votes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT NOT NULL,
                        source TEXT DEFAULT 'topgg',
                        voted_at INTEGER DEFAULT (strftime('%s', 'now'))
                    )`);
                    db.prepare(`INSERT INTO votes (user_id, source) VALUES (?, ?)`)
                      .run(data.user, 'topgg');
                } catch (e) {}

                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Bad Request' }));
            }
        });
    }
};
