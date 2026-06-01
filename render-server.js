// ============================================================
// Archon Engine — Render Standalone API Server
// Deployed on: Render (free tier)
// Connects to: Your Pterodactyl bot via shared database
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

// ============================================================
// DATABASE — Direct connection to your SQLite file
// ============================================================
const fs = require('fs');
const dbPath = '/tmp/database.sqlite';
const db = new Database(dbPath, { timeout: 10000 });
db.pragma('journal_mode = WAL');
console.log('[DB] Connected to database');

// Create guild_settings table if not exists
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
// CORS — Allow your GitHub Pages frontend
// ============================================================
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://MFOF7310.github.io',
    credentials: true
}));

app.use(cookieParser());
app.use(express.json());

// ============================================================
// ROOT — Redirect to frontend
// ============================================================
app.get('/', (req, res) => {
    const frontend = process.env.FRONTEND_URL || 'https://MFOF7310.github.io';
    res.redirect(`${frontend}/archon-engine-web/`);
});

// ============================================================
// API ENDPOINTS
// ============================================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'operational', service: 'archon-dashboard-api', timestamp: Date.now() });
});

// ============================================================
// LIVE STATS CACHE — Updated by bot via sync endpoint
// ============================================================
let liveStats = {
    servers: '---',
    users: '---',
    ping: '---',
    lastUpdated: null
};

// Public stats endpoint — returns cached live data
app.get('/api/stats', (req, res) => {
    res.json({
        servers: liveStats.servers,
        users: liveStats.users,
        ping: liveStats.ping,
        lastUpdated: liveStats.lastUpdated
    });
});

// Stats sync endpoint — called by Pterodactyl bot
app.post('/api/stats/sync', (req, res) => {
    const { secret, servers, users, ping } = req.body;

    // Verify the request comes from your bot
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

// OAuth2 Login
app.get('/api/auth/login', (req, res) => {
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.append('client_id', process.env.DISCORD_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', process.env.REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'identify guilds');

    const state = Math.random().toString(36).substring(2, 15);
    authUrl.searchParams.append('state', state);

    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000
    });

    res.redirect(authUrl.toString());
});

// OAuth2 Callback
app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies.oauth_state;

    if (!state || state !== storedState) {
        return res.status(403).send('Invalid state parameter.');
    }

    res.clearCookie('oauth_state');

    if (!code) {
        return res.status(400).send('No code provided.');
    }

    try {
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', process.env.DISCORD_CLIENT_ID);
        tokenParams.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', process.env.REDIRECT_URI);

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: tokenParams,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const userData = await userResponse.json();

        const sessionPayload = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            authenticatedAt: Date.now()
        };

        const sessionToken = jwt.sign(sessionPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.cookie('session', sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

       const frontendHome = `${process.env.FRONTEND_URL}/archon-engine-web/?token=${sessionToken}`;
res.redirect(frontendHome);

    } catch (error) {
        console.error('[AUTH] Error:', error);
        res.status(500).send('Authentication failed.');
    }
});

// Auth check
app.get('/api/auth/me', (req, res) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ authenticated: false });

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ authenticated: true, user });
    } catch (err) {
        res.status(401).json({ authenticated: false });
    }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect(`${process.env.FRONTEND_URL}/archon-engine-web/`);
});

// Guild list — reads from database
app.get('/api/auth/guilds', async (req, res) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        
        // Return all guilds that have settings stored
        const guilds = db.prepare('SELECT guild_id as id, prefix FROM guild_settings').all();
        
        // Add placeholder names since we don't have client.guilds.cache
        const guildList = guilds.map(g => ({
            id: g.id,
            name: `Server ${g.id.slice(-4)}`,
            icon: null
        }));

        res.json(guildList);
    } catch (err) {
        res.status(401).json({ error: 'Invalid session' });
    }
});

// Get guild settings
app.get('/api/guilds/:guildId/settings', async (req, res) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        const { guildId } = req.params;

        let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);

        if (!settings) {
    db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    settings = {
        guild_id: guildId,
        prefix: '!',
        welcome_channel_id: null,
        welcome_message: 'Welcome to the server, {user}!',
        auto_role_id: null,
        automod_enabled: 0,
        xp_multiplier: 1.0,
        afk_enabled: 0
    };
}

        res.json({
            settings,
            channels: [],
            roles: [],
            guildName: `Server ${guildId.slice(-4)}`,
            guildIcon: null
        });

    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Save guild settings
app.post('/api/guilds/:guildId/settings', async (req, res) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        const { guildId } = req.params;
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
        `).run(guildId, prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled ?? 0, xp_multiplier ?? 1.0, afk_enabled ?? 0,
               prefix, welcome_channel_id, welcome_message, auto_role_id, automod_enabled ?? 0, xp_multiplier ?? 1.0, afk_enabled ?? 0);

        res.json({ success: true, message: 'Settings saved' });

    } catch (err) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[RENDER] Archon Dashboard API running on port ${PORT}`);
});