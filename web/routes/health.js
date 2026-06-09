module.exports = {
    path: '/health',
    method: 'GET',
    handler(req, res, client, db) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            service: 'architect-cg223',
            version: client.version || '2.0.0',
            servers: client.guilds?.cache?.size || 0,
            users: client.guilds?.cache?.reduce((a, g) => a + g.memberCount, 0) || 0,
            uptime: process.uptime(),
            node: 'BAMAKO_223',
            timestamp: new Date().toISOString()
        }));
    }
};
