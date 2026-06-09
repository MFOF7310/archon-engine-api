module.exports = {
    path: '/webhook/dodo',
    method: 'POST',
    handler(req, res, client, db) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                console.log(`\x1b[36m[DODO]\x1b[0m Event: ${data.event || 'unknown'}`);

                if (data.event === 'payment.success' && data.user_id && client.addCredits) {
                    client.addCredits(data.user_id, 'DM', data.credits || data.amount || 0);
                }

                res.writeHead(200);
                res.end('OK');
            } catch (e) {
                res.writeHead(400);
                res.end('Bad Request');
            }
        });
    }
};
