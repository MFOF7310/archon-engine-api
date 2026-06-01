// ============================================================
// Archon Engine — Render Standalone API Server
// Deployed on: Render (free tier)
// Full OAuth2 + Guild Management + Stats Sync
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const app = express();

// ============================================================
// DATABASE
// ============================================================
const fs = require('fs');
const dbPath = '/tmp/database.sqlite';
const db = new Database(dbPath, { timeout: 10000 });
db.pragma('journal_mode = WAL');
console.log('[DB] Connected to database');

db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        prefix TEXT DEFAULT '!',
        welcome_channel_id TEXT DEFAULT NULL,
        welcome_message TEXT DEFAULT 'Welcome to the server, {user}!',
        auto_role_id TEXT DEFAULT NULL,
        automod_enabled INTEGER DEFAULT 0,
        xp_multiplier REAL DEFAULT 1.0,
        afk_enabled INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
    )
`);
console.log('[DB] Guild settings table ready');

// ============================================================
// CORS
// ============================================================
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://MFOF7310.github.io',
    credentials: true
}));

app.use(cookieParser());
app.use(express.json());

// ============================================================
// ROOT
// ============================================================
app.get('/', (req, res) => {
    const frontend = process.env.FRONTEND_URL || 'https://MFOF7310.github.io';
    res.redirect(`${frontend}/archon-engine-web/`);
});

// ============================================================
// HEALTH
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'operational', service: 'archon-dashboard-api', timestamp: Date.now() });
});

// ============================================================
// LIVE STATS CACHE
// ============================================================
let liveStats = { servers: '---', users: '---', ping: '---', lastUpdated: null };

app.get('/api/stats', (req, res) => {
    res.json(liveStats);
});

app.post('/api/stats/sync', (req, res) => {
    const { secret, servers, users, ping } = req.body;
    if (secret !== process.env.JWT_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    liveStats = {
        servers: servers || '---',
        users: users || '---',
        ping: ping || '---',
        lastUpdated: new Date().toISOString()
    };
    console.log(`[STATS] Synced — ${liveStats.servers} servers | ${liveStats.users} users | ${liveStats.ping}ms`);
    res.json({ success: true, stats: liveStats });
});

// ============================================================
// OAUTH2 — LOGIN
// ============================================================
app.get('/api/auth/login', (req, res) => {
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.append('client_id', process.env.DISCORD_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', process.env.REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'identify guilds');

    const state = Math.random().toString(36).substring(2, 15);
    authUrl.searchParams.append('state', state);

    res.cookie('oauth_state', state, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 5 * 60 * 1000
    });

    res.redirect(authUrl.toString());
});

// ============================================================
// OAUTH2 — CALLBACK (WITH GUILD PERMISSIONS)
// ============================================================
app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies.oauth_state;

    if (!state || state !== storedState) {
        return res.status(403).send('Invalid state parameter.');
    }
    res.clearCookie('oauth_state');
    if (!code) return res.status(400).send('No code provided.');

    try {
        // Exchange code for token
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', process.env.DISCORD_CLIENT_ID);
        tokenParams.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', process.env.REDIRECT_URI);

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST', body: tokenParams,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        // Fetch user profile
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const userData = await userResponse.json();

        // Fetch user's guilds
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const userGuilds = await guildsResponse.json();

        // Filter guilds where user has MANAGE_GUILD (0x20) or is owner
        const managedGuilds = userGuilds
            .filter(g => (parseInt(g.permissions) & 0x20) === 0x20 || g.owner)
            .map(g => g.id);

        // Fetch bot's guilds for names/icons
        const botGuildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        }).catch(() => null);

        // Create session
        const sessionPayload = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            managedGuilds: managedGuilds,
            accessToken: access_token,
            authenticatedAt: Date.now()
        };

        const sessionToken = jwt.sign(sessionPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.cookie('session', sessionToken, {
            httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log(`[AUTH] User ${userData.username} authenticated — manages ${managedGuilds.length} servers`);

        const frontendHome = `${process.env.FRONTEND_URL}/archon-engine-web/index.html?token=${sessionToken}`;
        res.redirect(frontendHome);

    } catch (error) {
        console.error('[AUTH] Error:', error);
        res.status(500).send('Authentication failed.');
    }
});

// ============================================================
// TOKEN HELPER — Extracts token from cookie or Bearer header
// ============================================================
function extractToken(req) {
    let token = req.cookies.session;
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }
    return token;
}

// ============================================================
// AUTH CHECK
// ============================================================
app.get('/api/auth/me', (req, res) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ authenticated: false });

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar
            }
        });
    } catch (err) {
        res.status(401).json({ authenticated: false });
    }
});

// ============================================================
// LOGOUT
// ============================================================
app.get('/api/auth/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect(`${process.env.FRONTEND_URL}/archon-engine-web/`);
});

// ============================================================
// GUILD LIST — Only servers user manages + bot is in
// ============================================================
app.get('/api/auth/guilds', async (req, res) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const userData = jwt.verify(token, process.env.JWT_SECRET);
        if (!userData.managedGuilds || userData.managedGuilds.length === 0) {
            return res.json([]);
        }

        // Get bot's guilds from database (servers that have settings)
        const botGuilds = db.prepare('SELECT guild_id FROM guild_settings').all();
        const botGuildIds = botGuilds.map(g => g.guild_id);

        // Intersection: user manages AND bot is in
        const mutualGuilds = userData.managedGuilds.filter(id => botGuildIds.includes(id));

        // Fetch names and icons from Discord
        const guildDetails = [];
        for (const guildId of mutualGuilds) {
            try {
                const r = await fetch(`https://discord.com/api/guilds/${guildId}`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                });
                if (r.ok) {
                    const details = await r.json();
                    guildDetails.push({ id: guildId, name: details.name, icon: details.icon });
                } else {
                    guildDetails.push({ id: guildId, name: `Server ${guildId.slice(-4)}`, icon: null });
                }
            } catch (e) {
                guildDetails.push({ id: guildId, name: `Server ${guildId.slice(-4)}`, icon: null });
            }
        }

        res.json(guildDetails);
    } catch (err) {
        res.status(401).json({ error: 'Invalid session' });
    }
});

// ============================================================
// GET GUILD SETTINGS
// ============================================================
app.get('/api/guilds/:guildId/settings', async (req, res) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const userData = jwt.verify(token, process.env.JWT_SECRET);
        const { guildId } = req.params;

        // Permission check
        if (!userData.managedGuilds || !userData.managedGuilds.includes(guildId)) {
            return res.status(403).json({ error: 'You do not manage this server.' });
        }

        let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);

        if (!settings) {
            db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guildId);
            settings = {
                guild_id: guildId, prefix: '!', welcome_channel_id: null,
                welcome_message: 'Welcome to the server, {user}!', auto_role_id: null,
                automod_enabled: 0, xp_multiplier: 1.0, afk_enabled: 0
            };
        }

        // Fetch guild details
        let guildName = `Server ${guildId.slice(-4)}`;
        let guildIcon = null;
        let channels = [];
        let roles = [];

        try {
            const [guildRes, channelsRes, rolesRes] = await Promise.all([
                fetch(`https://discord.com/api/guilds/${guildId}`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                }),
                fetch(`https://discord.com/api/guilds/${guildId}/channels`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                }),
                fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
                    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
                })
            ]);

            if (guildRes.ok) {
                const g = await guildRes.json();
                guildName = g.name;
                guildIcon = g.icon;
            }
            if (channelsRes.ok) {
                const ch = await channelsRes.json();
                channels = ch.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
            }
            if (rolesRes.ok) {
                const rl = await rolesRes.json();
                roles = rl.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({ id: r.id, name: r.name }));
            }
        } catch (e) {
            console.warn('[SETTINGS] Could not fetch guild details:', e.message);
        }

        res.json({ settings, channels, roles, guildName, guildIcon });

    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// ============================================================
// SAVE GUILD SETTINGS
// ============================================================
app.post('/api/guilds/:guildId/settings', async (req, res) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const userData = jwt.verify(token, process.env.JWT_SECRET);
        const { guildId } = req.params;

        // Permission check
        if (!userData.managedGuilds || !userData.managedGuilds.includes(guildId)) {
            return res.status(403).json({ error: 'You do not manage this server.' });
        }

        const { prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled, xp_multiplier, afk_enabled } = req.body;

        db.prepare(`
            INSERT INTO guild_settings (guild_id, prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled, xp_multiplier, afk_enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(guild_id) DO UPDATE SET
                prefix = COALESCE(?, prefix),
                welcome_channel_id = COALESCE(?, welcome_channel_id),
                welcome_message = COALESCE(?, welcome_message),
                auto_role_id = COALESCE(?, auto_role_id),
                automod_enabled = COALESCE(?, automod_enabled),
                xp_multiplier = COALESCE(?, xp_multiplier),
                afk_enabled = COALESCE(?, afk_enabled),
                updated_at = datetime('now')
        `).run(
            guildId, prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled ?? 0, xp_multiplier ?? 1.0, afk_enabled ?? 0,
            prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled ?? 0, xp_multiplier ?? 1.0, afk_enabled ?? 0
        );

        console.log(`[SETTINGS] Updated guild ${guildId}`);
        res.json({ success: true, message: 'Settings saved successfully' });

    } catch (err) {
        console.error('[SETTINGS] Save error:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[RENDER] Archon Dashboard API running on port ${PORT}`);
});