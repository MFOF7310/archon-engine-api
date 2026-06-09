module.exports = {
    path: '/api/status',
    method: 'GET',
    handler(req, res, client, db) {
        const mem = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            online: true,
            version: client.version || '2.0.0',
            servers: client.guilds?.cache?.size || 0,
            users: client.guilds?.cache?.reduce((a, g) => a + g.memberCount, 0) || 0,
            ping: Math.round(client.ws.ping || 0),
            memory: {
                used: (mem.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
                total: (mem.heapTotal / 1024 / 1024).toFixed(1) + ' MB'
            },
            uptime: {
                seconds: Math.floor(process.uptime()),
                formatted: `${Math.floor(process.uptime() / 86400)}d ${Math.floor((process.uptime() % 86400) / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
            },
            webhooks: {
                topgg: !!process.env.TOPGG_WEBHOOK_SECRET,
                dodo: !!process.env.DODO_WEBHOOK_SECRET
            }
        }));
    }
};
