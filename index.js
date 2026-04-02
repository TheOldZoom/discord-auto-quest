import { readFileSync } from 'node:fs';
import https from 'node:https';
import WebSocket from 'ws';

const env = {};
try {
    const lines = readFileSync('.env', 'utf-8').split('\n');
    for (const line of lines) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
} catch { }

const rawTokens = env.DISCORD_TOKEN || process.env.DISCORD_TOKEN;
const TOKENS = typeof rawTokens === 'string'
    ? rawTokens.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
if (TOKENS.length === 0) {
    console.error('[FATAL] DISCORD_TOKEN not found in .env or environment variables (use comma-separated tokens for multiple users)');
    process.exit(1);
}

const VALID_PRESENCE_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);
const rawPresence = (env.DISCORD_PRESENCE || process.env.DISCORD_PRESENCE || 'dnd').toLowerCase().trim();
const PRESENCE_STATUS = VALID_PRESENCE_STATUSES.has(rawPresence) ? rawPresence : 'dnd';
if (rawPresence && !VALID_PRESENCE_STATUSES.has(rawPresence)) {
    console.warn(`[quests] Invalid DISCORD_PRESENCE "${rawPresence}", using ${PRESENCE_STATUS}`);
}

const API = 'https://discord.com/api/v9';
const GATEWAY = 'wss://gateway.discord.gg/?v=9&encoding=json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9182 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36';
const SUPER_PROPS = {
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: '1.0.9182',
    os_version: '10.0.22631',
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'en-US',
    browser_user_agent: UA,
    device: '',
    client_build_number: 507104,
};
const SUPER_PROPS_B64 = Buffer.from(JSON.stringify(SUPER_PROPS)).toString('base64');
const rawCheckMinutes = env.CHECK_INTERVAL_MINUTES ?? process.env.CHECK_INTERVAL_MINUTES;
const parsedCheckMinutes = rawCheckMinutes != null && String(rawCheckMinutes).trim() !== ''
    ? parseFloat(String(rawCheckMinutes).trim())
    : NaN;
const CHECK_INTERVAL_MS = !Number.isNaN(parsedCheckMinutes) && parsedCheckMinutes > 0
    ? Math.max(1000, Math.round(parsedCheckMinutes * 60 * 1000))
    : 5 * 60 * 1000;
const WEBHOOK_NEW = (env.QUEST_WEBHOOK_NEW || process.env.QUEST_WEBHOOK_NEW || env.QUEST_WEBHOOK_URL || process.env.QUEST_WEBHOOK_URL || '').trim() || null;
const WEBHOOK_COMPLETED = (env.QUEST_WEBHOOK_COMPLETED || process.env.QUEST_WEBHOOK_COMPLETED || env.QUEST_WEBHOOK_URL || process.env.QUEST_WEBHOOK_URL || '').trim() || null;
const WEBHOOK_GATEWAY = (env.QUEST_WEBHOOK_GATEWAY || process.env.QUEST_WEBHOOK_GATEWAY || env.QUEST_WEBHOOK_URL || process.env.QUEST_WEBHOOK_URL || '').trim() || null;
const HEARTBEAT_INTERVAL_MS = 30_000;
const VIDEO_TICK_MS = 5_000;
const VIDEO_INCREMENT = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;
const PRESENCE_SETTLE_MS = 3_000;

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[91m',
    green: '\x1b[92m',
    yellow: '\x1b[93m',
    blue: '\x1b[94m',
    magenta: '\x1b[95m',
    cyan: '\x1b[96m',
    white: '\x1b[97m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
};

const LEVEL_STYLE = {
    INFO: `${c.bgBlue}${c.bold}${c.white} INFO  ${c.reset}`,
    WARN: `${c.bgYellow}${c.bold}${c.white} WARN  ${c.reset}`,
    ERROR: `${c.bgRed}${c.bold}${c.white} ERROR ${c.reset}`,
    QUEST: `${c.bgMagenta}${c.bold}${c.white} QUEST ${c.reset}`,
    OK: `${c.bgGreen}${c.bold}${c.white}  OK   ${c.reset}`,
};

function timestamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${c.gray}${hh}:${mm}:${ss}${c.reset}`;
}

function log(level, ...args) {
    const tag = LEVEL_STYLE[level] || LEVEL_STYLE.INFO;
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    const out = `${timestamp()} ${tag} ${msg}`;
    if (level === 'ERROR') console.error(out);
    else console.log(out);
}

function userLogForIndex(index) {
    const p = `${c.dim}[#${index + 1}]${c.reset} `;
    return (level, ...args) => log(level, p, ...args);
}

function accountLabel(user) {
    if (!user) return '?';
    const d = user.discriminator;
    if (d && d !== '0') return `${user.username}#${d}`;
    if (user.global_name) return `${user.global_name} (${user.username})`;
    return user.username;
}

function userLogForAccount(user) {
    const p = `${c.dim}[${accountLabel(user)}]${c.reset} `;
    return (level, ...args) => log(level, p, ...args);
}

async function postWebhook(urlStr, payload) {
    if (!urlStr) return;
    try {
        const res = await fetch(urlStr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
        }
    } catch (e) {
        log('WARN', `Webhook failed: ${e.message}`);
    }
}

function webhookBodyWithUserPing(user, line, rest) {
    const uid = user?.id != null ? String(user.id) : '';
    const mention = uid ? `<@${uid}> ` : '';
    const body = {
        content: `${mention}${line}`,
        ...rest,
    };
    if (uid) {
        body.allowed_mentions = { users: [uid] };
    }
    return body;
}

function notifyNewQuest(user, quest) {
    if (!WEBHOOK_NEW) return;
    const name = quest.config?.messages?.quest_name || quest.id;
    postWebhook(WEBHOOK_NEW, webhookBodyWithUserPing(user, `**New quest** — ${name} · ${accountLabel(user)}`, {
        event: 'new_quest',
        account: accountLabel(user),
        quest_id: quest.id,
        quest_name: name,
        expires_at: quest.config?.expires_at ?? null,
        at: new Date().toISOString(),
    }));
}

function notifyQuestCompleted(user, quest) {
    if (!WEBHOOK_COMPLETED) return;
    const name = quest.config?.messages?.quest_name || quest.id;
    postWebhook(WEBHOOK_COMPLETED, webhookBodyWithUserPing(user, `**Quest completed** — ${name} · ${accountLabel(user)}`, {
        event: 'quest_completed',
        account: accountLabel(user),
        quest_id: quest.id,
        quest_name: name,
        at: new Date().toISOString(),
    }));
}

function notifyGatewayConnected(user, snap) {
    if (!WEBHOOK_GATEWAY) return;
    let line = `**Gateway connected** — ${accountLabel(user)}`;
    if (snap) {
        line += ` · **${snap.leftToClaim}** left to claim (${snap.active.length} active, ${snap.pending.length} pending, ${snap.completed.length} done)`;
    }
    postWebhook(WEBHOOK_GATEWAY, webhookBodyWithUserPing(user, line, {
        event: 'gateway_connected',
        account: accountLabel(user),
        user_id: user.id,
        at: new Date().toISOString(),
        ...(snap && {
            active_quests: snap.active.length,
            pending: snap.pending.length,
            completed: snap.completed.length,
            left_to_claim: snap.leftToClaim,
        }),
    }));
}

function createClient(token) {
    function request(method, urlStr, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlStr);
            const headers = {
                'Authorization': token,
                'Content-Type': 'application/json',
                'User-Agent': UA,
                'X-Super-Properties': SUPER_PROPS_B64,
            };
            const payload = body ? JSON.stringify(body) : null;
            if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

            const req = https.request({
                hostname: url.hostname,
                path: url.pathname + url.search,
                method,
                headers,
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        const json = data ? JSON.parse(data) : null;
                        if (res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${json?.message || data}`));
                        } else {
                            resolve(json);
                        }
                    } catch {
                        resolve(data);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(REQUEST_TIMEOUT_MS, () => {
                req.destroy();
                reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
            });
            if (payload) req.write(payload);
            req.end();
        });
    }

    function api(method, path, body) {
        return request(method, `${API}${path}`, body);
    }

    function connectGateway(userLog) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(GATEWAY);
            let hbInterval = null;
            let seq = null;

            const send = (data) => ws.send(JSON.stringify(data));
            const heartbeat = () => send({ op: 1, d: seq });

            const setPresence = (activities) => {
                send({ op: 3, d: { since: null, activities, status: PRESENCE_STATUS, afk: false } });
            };

            ws.on('message', (raw) => {
                const msg = JSON.parse(raw);
                if (msg.s) seq = msg.s;

                if (msg.op === 10) {
                    hbInterval = setInterval(heartbeat, msg.d.heartbeat_interval);
                    heartbeat();
                    send({
                        op: 2,
                        d: {
                            token,
                            capabilities: 30717,
                            properties: SUPER_PROPS,
                            presence: { status: PRESENCE_STATUS, since: 0, activities: [], afk: false },
                            compress: false,
                            client_state: {
                                guild_versions: {},
                                highest_last_message_id: '0',
                                read_state_version: 0,
                                user_guild_settings_version: -1,
                                user_settings_version: -1,
                                private_channels_version: '0',
                                api_code_version: 0,
                            },
                        },
                    });
                }

                if (msg.t === 'READY') {
                    const sessionUser = msg.d.user;
                    (async () => {
                        let snap = null;
                        try {
                            snap = await fetchActiveQuestSnapshot(api);
                        } catch (e) {
                            userLog('WARN', `Could not load quest / claim status: ${e.message}`);
                        }
                        if (snap) {
                            userLog('INFO', `Claim status: ${c.bold}${snap.leftToClaim}${c.reset} left to claim ${c.dim}(${snap.active.length} active · ${snap.pending.length} pending · ${snap.completed.length} completed)${c.reset}`);
                        }
                        notifyGatewayConnected(sessionUser, snap);
                        resolve({ ws, user: sessionUser, setPresence });
                    })();
                }
            });

            ws.on('close', (code) => {
                clearInterval(hbInterval);
                userLog('WARN', `Gateway disconnected ${c.dim}(code: ${code})${c.reset} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
                setTimeout(() => {
                    connectGateway(userLog).then(resolve).catch(reject);
                }, RECONNECT_DELAY_MS);
            });

            ws.on('error', (e) => userLog('ERROR', `Gateway error: ${e.message}`));
        });
    }

    return { api, connectGateway };
}

function requestJSON(method, urlStr, body, extraHeaders) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': UA,
            ...extraHeaders,
        };
        const payload = body ? JSON.stringify(body) : null;
        if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = data ? JSON.parse(data) : null;
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${json?.message || json?.error || data}`));
                    } else {
                        resolve(json);
                    }
                } catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error(`Request timed out`));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

function getTaskInfo(quest) {
    const tasks = quest.config?.task_config_v2?.tasks || quest.config?.task_config?.tasks;
    if (!tasks) return { type: null, required: 900 };
    const first = Object.values(tasks)[0];
    return { type: first.type || first.event_name, required: first.target || 900 };
}

function getProgress(quest) {
    if (!quest.user_status?.progress) return 0;
    const first = Object.values(quest.user_status.progress)[0];
    return first?.value || 0;
}

function isCompleted(quest) {
    return !!quest.user_status?.completed_at;
}

function isRewardClaimed(quest) {
    const us = quest.user_status;
    if (!us) return false;
    if (us.claimed_at != null || us.claimedAt != null) return true;
    if (us.reward_claimed_at != null || us.rewardClaimedAt != null) return true;
    if (us.claimed === true || us.reward_claimed === true) return true;
    const rs = us.reward_state ?? us.rewardState;
    if (rs === 'CLAIMED' || rs === 'claimed') return true;
    if (rs === 'UNCLAIMED' || rs === 'unclaimed') return false;
    return false;
}

async function fetchActiveQuestSnapshot(api) {
    const data = await api('GET', '/quests/@me');
    const quests = data?.quests || [];
    const now = new Date();
    const active = quests.filter((q) => new Date(q.config?.expires_at) > now);
    const pending = active.filter((q) => !isCompleted(q));
    const completed = active.filter((q) => isCompleted(q));
    const leftToClaim = completed.filter((q) => !isRewardClaimed(q)).length;
    return { active, pending, completed, leftToClaim };
}

function formatProgress(current, total) {
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const filled = Math.round(pct / 5);
    const bar = `${c.green}${'█'.repeat(filled)}${c.gray}${'░'.repeat(20 - filled)}${c.reset}`;
    const pctColor = pct >= 100 ? c.green : pct >= 50 ? c.yellow : c.cyan;
    return `${bar} ${pctColor}${c.bold}${pct}%${c.reset} ${c.dim}(${current}/${total}s)${c.reset}`;
}

async function completeQuest(quest, setPresence, api, userLog, user) {
    const questId = quest.id;
    const { type, required } = getTaskInfo(quest);
    let progress = getProgress(quest);
    const name = quest.config?.messages?.quest_name || questId;
    const fireCompleted = (q) => notifyQuestCompleted(user, q);

    userLog('QUEST', `${c.bold}${c.cyan}${name}${c.reset} ${c.dim}(${type})${c.reset}`);
    userLog('INFO', formatProgress(progress, required));

    if (isCompleted(quest)) {
        userLog('OK', `${c.dim}Quest "${name}" already completed${c.reset}`);
        return;
    }

    if (type === 'PLAY_ACTIVITY') {
        const streamKey = `call:${questId}:1`;
        userLog('INFO', `Activity heartbeats for "${c.bold}${name}${c.reset}"`);

        return new Promise((resolve) => {
            const sendHB = async () => {
                try {
                    const res = await api('POST', `/quests/${questId}/heartbeat`, {
                        stream_key: streamKey,
                        terminal: false,
                    });
                    if (res?.progress) {
                        const taskProgress = res.progress[type];
                        if (taskProgress) {
                            progress = taskProgress.value || progress;
                        }
                    }
                    userLog('INFO', `${c.magenta}[${name}]${c.reset} ${formatProgress(progress, required)}`);
                    if (res?.completed_at || progress >= required) {
                        return true;
                    }
                    return false;
                } catch (e) {
                    userLog('ERROR', `${c.red}[${name}]${c.reset} Heartbeat failed: ${e.message}`);
                    return false;
                }
            };

            sendHB().then(done => {
                if (done) {
                    userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                    fireCompleted(quest);
                    resolve();
                    return;
                }
                const iv = setInterval(async () => {
                    const complete = await sendHB();
                    if (complete) {
                        clearInterval(iv);
                        userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                        fireCompleted(quest);
                        resolve();
                    }
                }, HEARTBEAT_INTERVAL_MS);
            });
        });
    }

    if (type === 'ACHIEVEMENT_IN_ACTIVITY') {
        const taskConfig = quest.config?.task_config || quest.config?.task_config_v2;
        const task = taskConfig?.tasks?.ACHIEVEMENT_IN_ACTIVITY;
        const devAppId = taskConfig?.developer_application_id || task?.applications?.[0]?.id;
        const appId = quest.config?.application?.id;
        const targetAppId = devAppId || appId;

        userLog('INFO', `Achievement in activity ${c.dim}(app: ${targetAppId})${c.reset}`);
        userLog('INFO', `Getting OAuth2 auth code...`);

        let authCode = null;
        try {
            const oauthRes = await api('POST',
                `/oauth2/authorize?client_id=${targetAppId}&response_type=code&scope=identify%20applications.entitlements&state=`,
                { authorize: true }
            );
            const location = oauthRes?.location;
            if (location) {
                authCode = new URL(location).searchParams.get('code');
            }
        } catch (e) {
            userLog('ERROR', `OAuth2 authorize failed: ${e.message}`);
        }

        if (!authCode) {
            userLog('ERROR', `Could not get auth code for app ${targetAppId}`);
            return;
        }
        userLog('INFO', `Exchanging auth code for activity token...`);

        let activityToken = null;
        try {
            const authRes = await requestJSON('POST', `https://${targetAppId}.discordsays.com/.proxy/acf/authorize`, { code: authCode });
            activityToken = authRes?.token;
        } catch (e) {
            userLog('ERROR', `Activity auth failed: ${e.message}`);
        }

        if (!activityToken) {
            userLog('ERROR', `Could not get activity token`);
            return;
        }
        userLog('INFO', `Sending achievement progress ${c.dim}(target: ${required})${c.reset}`);

        try {
            const progressRes = await requestJSON('POST', `https://${targetAppId}.discordsays.com/.proxy/acf/quest/progress`, { progress: required }, {
                'x-auth-token': activityToken,
            });
            userLog('OK', `Achievement progress sent`);
        } catch (e) {
            userLog('ERROR', `Achievement progress failed: ${e.message}`);
            return;
        }

        await new Promise(r => setTimeout(r, 3000));
        try {
            const data = await api('GET', `/quests/@me`);
            const updated = data?.quests?.find(q => q.id === questId);
            if (updated && isCompleted(updated)) {
                userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                fireCompleted(updated);
            } else {
                userLog('INFO', `Progress sent — ${c.dim}check Discord for status${c.reset}`);
            }
        } catch { }
        return;
    }

    if (type === 'WATCH_VIDEO' || type === 'WATCH_VIDEO_ON_MOBILE') {
        userLog('INFO', `Video progress for "${c.bold}${name}${c.reset}"...`);
        return new Promise((resolve) => {
            const iv = setInterval(async () => {
                const nextProgress = Math.min(progress + VIDEO_INCREMENT, required);
                try {
                    await api('POST', `/quests/${questId}/video-progress`, { timestamp: nextProgress });
                    progress = nextProgress;
                    userLog('INFO', `${c.magenta}[${name}]${c.reset} ${formatProgress(progress, required)}`);
                    if (progress >= required) {
                        clearInterval(iv);
                        userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                        fireCompleted(quest);
                        resolve();
                    }
                } catch (e) {
                    userLog('WARN', `${c.red}[${name}]${c.reset} Video progress request failed: ${e.message} ${c.dim}(will retry)${c.reset}`);
                }
            }, VIDEO_TICK_MS);
        });
    }

    if (['PLAY_ON_DESKTOP', 'PLAY_ON_DESKTOP_V2', 'STREAM_ON_DESKTOP'].includes(type)) {
        const appId = quest.config?.application?.id;
        const appName = quest.config?.application?.name || name;
        const streamKey = `call:${questId}:1`;

        userLog('INFO', `Simulating ${c.bold}${appName}${c.reset} ${c.dim}(${appId})${c.reset}`);
        setPresence([{
            name: appName,
            type: 0,
            application_id: appId,
            timestamps: { start: Date.now() },
        }]);

        await new Promise(r => setTimeout(r, PRESENCE_SETTLE_MS));
        userLog('INFO', `${c.dim}Heartbeats every ${HEARTBEAT_INTERVAL_MS / 1000}s${c.reset}`);

        return new Promise((resolve) => {
            const sendHB = async () => {
                try {
                    const res = await api('POST', `/quests/${questId}/heartbeat`, {
                        stream_key: streamKey,
                        terminal: false,
                    });
                    if (res?.progress) {
                        const first = Object.values(res.progress)[0];
                        progress = first?.value || progress;
                    }
                    userLog('INFO', `${c.magenta}[${name}]${c.reset} ${formatProgress(progress, required)}`);
                    return progress >= required;
                } catch (e) {
                    userLog('ERROR', `${c.red}[${name}]${c.reset} Heartbeat failed: ${e.message}`);
                    return false;
                }
            };

            sendHB().then(done => {
                if (done) {
                    userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                    fireCompleted(quest);
                    setPresence([]);
                    resolve();
                    return;
                }
                const iv = setInterval(async () => {
                    const complete = await sendHB();
                    if (complete) {
                        clearInterval(iv);
                        userLog('OK', `Quest "${c.bold}${name}${c.reset}" completed`);
                        fireCompleted(quest);
                        setPresence([]);
                        resolve();
                    }
                }, HEARTBEAT_INTERVAL_MS);
            });
        });
    }

    userLog('WARN', `Unsupported quest type: ${type}`);
}

async function checkAndComplete(setPresence, api, userLog, user, questPollState) {
    userLog('INFO', `Checking for available quests...`);

    try {
        const { active, pending, completed, leftToClaim } = await fetchActiveQuestSnapshot(api);

        if (active.length === 0) {
            userLog('INFO', `${c.dim}No active quests found${c.reset}`);
            questPollState.lastActiveIds = new Set();
            return;
        }

        if (questPollState.lastActiveIds !== null) {
            for (const q of active) {
                if (!questPollState.lastActiveIds.has(q.id)) {
                    notifyNewQuest(user, q);
                }
            }
        }
        questPollState.lastActiveIds = new Set(active.map(q => q.id));

        userLog('INFO', `Found ${c.bold}${active.length}${c.reset} quest(s): ${c.yellow}${pending.length} pending${c.reset}, ${c.green}${completed.length} completed${c.reset}, ${c.magenta}${leftToClaim} left to claim${c.reset}`);

        if (pending.length === 0) {
            userLog('OK', `All quests completed ${c.dim}— ${c.bold}${leftToClaim}${c.reset}${c.dim} reward(s) left to claim in Discord${c.reset}`);
            return;
        }

        for (const quest of pending) {
            const name = quest.config?.messages?.quest_name || quest.id;
            if (!quest.user_status?.enrolled_at) {
                try {
                    await api('POST', `/quests/${quest.id}/enroll`, { location: 0 });
                    userLog('OK', `Enrolled in quest: ${c.bold}${name}${c.reset}`);
                } catch (e) {
                    userLog('ERROR', `Failed to enroll in "${name}": ${e.message}`);
                    continue;
                }
            }
            await completeQuest(quest, setPresence, api, userLog, user);
        }
    } catch (e) {
        userLog('ERROR', `Quest check failed: ${e.message}`);
    }
}

async function runUserSession(token, index) {
    const bootLog = userLogForIndex(index);
    let routeLog = bootLog;
    const bridge = (level, ...args) => routeLog(level, ...args);
    const { api, connectGateway } = createClient(token);
    bridge('INFO', `Connecting to Discord Gateway...`);
    const { user, setPresence } = await connectGateway(bridge);
    routeLog = userLogForAccount(user);
    const userLog = routeLog;
    userLog('OK', `Logged in as ${c.bold}${accountLabel(user)}${c.reset}`);
    userLog('INFO', `${c.dim}Check interval: ${CHECK_INTERVAL_MS / 60_000}min${c.reset}`);

    const questPollState = { lastActiveIds: null };
    await checkAndComplete(setPresence, api, userLog, user, questPollState);
    setInterval(() => checkAndComplete(setPresence, api, userLog, user, questPollState), CHECK_INTERVAL_MS);
}

async function main() {
    console.log(`\n${c.bold}${c.cyan}  ╔═══════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.cyan}  ║     Quest Completer       ║${c.reset}`);
    console.log(`${c.bold}${c.cyan}  ╚═══════════════════════════╝${c.reset}\n`);
    log('INFO', `${c.bold}${TOKENS.length}${c.reset} account(s) — ${c.dim}DISCORD_TOKEN${c.reset} comma-separated`);
    log('INFO', `Presence: ${c.bold}${PRESENCE_STATUS}${c.reset} ${c.dim}(DISCORD_PRESENCE: online | idle | dnd | invisible)${c.reset}`);
    if (WEBHOOK_NEW || WEBHOOK_COMPLETED || WEBHOOK_GATEWAY) {
        const wh = [];
        if (WEBHOOK_GATEWAY) wh.push('gateway');
        if (WEBHOOK_NEW) wh.push('new quest');
        if (WEBHOOK_COMPLETED) wh.push('completed');
        log('INFO', `Webhooks: ${wh.join(' · ')}`);
    }
    await Promise.all(TOKENS.map((token, i) => runUserSession(token, i)));
}

main().catch((e) => {
    log('ERROR', `Fatal: ${e.message}`);
    process.exit(1);
});
