import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import mc from 'minecraft-protocol'
import fs from 'fs'
import net from 'net'
import { SocksClient } from 'socks'
import { spawn } from 'child_process'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
const apiKey = process.env.API_KEY || config.apiKey

let client = null
let reconnectTimer = null
let leaveTimer = null
let posTimer = null
let tickTimer = null
let botEnabled = true
let posX = 0, posY = 64, posZ = 0
let connectedAt = null
let lastError = ''
let retryAt = null
let leaveAt = null
let currentVpn = null
let sslocalProcess = null
let replacingClient = false
let intentionalLeave = false
let failStreak = 0
let useDirect = true
let triedVpn = false

const defaultNames = [
  'xX_Builder_Xx', 'NightOwl_27', 'CraftMaster_', 'PixelPanda_',
  'MineKing_10', 'Luna_Builds', 'Shadow_Walker', 'BlockBuster_',
  'Redstone_Guy', 'SkyRunner_99', 'Aqua_Dragon', 'Fire_Spirit_',
  'Creeper_Fear', 'Diamond_Hunt', 'Nether_Rider', 'Ocean_Explorer',
  'Stone_Mason_', 'Iron_Fighter', 'Gold_Miner_', 'Ender_Player'
]

let names = config.bot.names && config.bot.names.length ? config.bot.names : defaultNames
let stats = { connections: 0, totalUptime: 0, lastConnected: null, kicks: 0 }
let currentName = ''
let lastNameUsed = ''

function randomName() {
  let name
  do {
    name = names[Math.floor(Math.random() * names.length)]
  } while (name === lastNameUsed && names.length > 1)
  lastNameUsed = name
  return name
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = new net.Socket()
    sock.setTimeout(timeout)
    sock.on('connect', () => {
      const ms = Date.now() - start
      sock.destroy()
      resolve(ms)
    })
    sock.on('error', () => { sock.destroy(); resolve(null) })
    sock.on('timeout', () => { sock.destroy(); resolve(null) })
    sock.connect(port, host)
  })
}

async function waitForPort(host, port, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ms = await tcpPing(host, port, 500)
    if (ms !== null) return true
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

async function selectFastestVpn() {
  const vpns = config.vpns || []
  if (vpns.length === 0) return null
  const results = await Promise.all(vpns.map(async (vpn) => {
    const ms = await tcpPing(vpn.host, vpn.port)
    return { vpn, ms }
  }))
  const valid = results.filter(r => r.ms !== null).sort((a, b) => a.ms - b.ms)
  if (valid.length === 0) return null
  return valid[0].vpn
}

async function stopVpnAsync() {
  if (sslocalProcess) {
    sslocalProcess.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 500))
    if (sslocalProcess) {
      sslocalProcess.kill('SIGKILL')
      await new Promise(r => setTimeout(r, 200))
    }
    sslocalProcess = null
  }
  currentVpn = null
}

async function startVpn(vpn) {
  if (!vpn) return
  await stopVpnAsync()
  currentVpn = vpn
  const pass = process.env.VPN_PASSWORD || vpn.password
  sslocalProcess = spawn('sslocal', [
    '-s', `${vpn.host}:${vpn.port}`,
    '-k', pass,
    '-m', vpn.method || 'chacha20-ietf-poly1305',
    '-b', '127.0.0.1:1080'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  sslocalProcess.on('exit', (code) => {
    if (sslocalProcess) {
      lastError = `sslocal exited (${code})`
      sslocalProcess = null
    }
  })

  const ok = await waitForPort('127.0.0.1', 1080)
  if (!ok) {
    lastError = 'sslocal failed to bind :1080'
    stopVpnAsync()
    return false
  }
  return true
}

function stopVpn() {
  stopVpnAsync()
}

function safeWrite(name, data) {
  if (!client || client.state !== mc.states.PLAY) return
  try {
    client.write(name, data)
  } catch (err) {
    lastError = `write ${name}: ${err.message}`
  }
}

let connectTimer = null

function createClient(useName) {
  if (!botEnabled) return
  if (client) {
    replacingClient = true
    try { client.end() } catch (_) {}
    client = null
    replacingClient = false
  }

  currentName = useName || randomName()
  lastError = ''

  const opts = {
    host: config.server.host,
    port: config.server.port,
    username: currentName,
    version: config.server.version,
    auth: 'offline',
    hideErrors: true
  }

  if (config.proxy && config.proxy.host) {
    opts.connect = (client) => {
      SocksClient.createConnection({
        proxy: { host: config.proxy.host, port: config.proxy.port, type: 5 },
        command: 'connect',
        destination: { host: config.server.host, port: config.server.port }
      }).then(info => {
        client.setSocket(info.socket)
        client.emit('connect')
      }).catch(err => {
        lastError = 'Proxy: ' + err.message
        client.emit('error', err)
      })
    }
  }

  try {
    client = mc.createClient(opts)
  } catch (err) {
    lastError = 'createClient: ' + err.message
    if (botEnabled) scheduleReconnect('error')
    return
  }

  connectTimer = setTimeout(() => {
    if (!client || client.state === mc.states.PLAY) return
    lastError = 'Connection timed out (15s)'
    if (client) { intentionalLeave = false; try { client.end() } catch (_) {} }
  }, 15000)

  client.on('playerJoin', () => {
    if (connectTimer) clearTimeout(connectTimer)
    failStreak = 0
    triedVpn = false
    lastError = ''
    safeWrite('settings', {
      locale: 'en_US',
      viewDistance: 2,
      chatFlags: 0,
      chatColors: true,
      skinParts: 0x7f,
      mainHand: 1,
      enableTextFiltering: false,
      enableServerListing: false,
      particleStatus: 'minimal'
    })
    connectedAt = Date.now()
    stats.connections++
    stats.lastConnected = Date.now()
    startPositionUpdates()
    startTickUpdates()
    scheduleLeave()
  })

  client.on('position', (packet) => {
    const f = packet.flags || {}
    posX = f.x ? posX + packet.x : packet.x
    posY = f.y ? posY + packet.y : packet.y
    posZ = f.z ? posZ + packet.z : packet.z
    if (packet.teleportId !== undefined) {
      safeWrite('teleport_confirm', { teleportId: packet.teleportId })
    }
    safeWrite('position_look', {
      x: posX, y: posY, z: posZ,
      yaw: 0, pitch: 0,
      flags: { onGround: true, hasHorizontalCollision: false }
    })
  })

  function handleAuth(raw) {
    if (!config.server.password) return
    const lower = String(raw).toLowerCase()
    if (lower.includes('register') || lower.includes('please register')) {
      safeWrite('chat', { message: `/register ${config.server.password} ${config.server.password}` })
    } else if (lower.includes('/login') || lower.includes('please login')) {
      safeWrite('chat', { message: `/login ${config.server.password}` })
    }
  }

  client.on('system_chat', (p) => handleAuth(p.formattedMessage || p.content || ''))
  client.on('systemChat', (p) => handleAuth(p.formattedMessage || p.message || ''))
  client.on('playerChat', (p) => handleAuth(p.formattedMessage || p.message || ''))

  client.on('error', (err) => {
    if (connectTimer) clearTimeout(connectTimer)
    if (err.code === 'ECONNREFUSED') {
      lastError = 'Server offline'
      if (!triedVpn) {
        triedVpn = true
        fallbackToVpn()
        return
      }
    } else {
      lastError = err.message
      if (connectedAt) stats.kicks++
    }
  })

  client.on('end', () => {
    if (connectTimer) clearTimeout(connectTimer)
    if (connectedAt) stats.totalUptime += Date.now() - connectedAt
    connectedAt = null
    leaveAt = null
    if (botEnabled && !replacingClient) {
      scheduleReconnect(intentionalLeave ? 'leave' : 'error')
      intentionalLeave = false
    }
  })

  client.on('kick_disconnect', (packet) => {
    lastError = 'Kicked: ' + (packet.reason || 'unknown')
    stats.kicks++
  })
}

function startPositionUpdates() {
  if (posTimer) clearInterval(posTimer)
  posTimer = setInterval(() => {
    if (!client || client.state !== mc.states.PLAY) return
    safeWrite('position_look', {
      x: posX, y: posY, z: posZ,
      yaw: Math.random() * 360 - 180,
      pitch: Math.random() * 20 - 10,
      flags: { onGround: true, hasHorizontalCollision: false }
    })
  }, 30000)
}

function startTickUpdates() {
  if (tickTimer) clearInterval(tickTimer)
  const interval = config.bot.tickInterval || 50
  tickTimer = setInterval(() => {
    if (!client || client.state !== mc.states.PLAY) return
    safeWrite('tick_end', {})
  }, interval)
}

function scheduleLeave() {
  if (leaveTimer) clearTimeout(leaveTimer)
  const stayMin = config.bot.stayMin || 10
  const stayMax = config.bot.stayMax || 60
  const stay = randInt(stayMin, stayMax) * 60 * 1000
  leaveAt = Date.now() + stay
  leaveTimer = setTimeout(() => {
    leaveAt = null
    if (client) { intentionalLeave = true; try { client.end() } catch (_) {} }
  }, stay)
}

function scheduleReconnect(reason) {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (posTimer) clearInterval(posTimer)
  if (tickTimer) clearInterval(tickTimer)
  if (connectTimer) clearTimeout(connectTimer)
  connectedAt = null
  leaveAt = null

  let gap
  if (reason === 'leave') {
    failStreak = 0
    gap = (config.bot.leaveGap || 5) * 1000
  } else {
    failStreak++
    gap = Math.min(60000, 5000 * Math.pow(2, Math.min(failStreak, 4)))
  }
  retryAt = Date.now() + gap
  reconnectTimer = setTimeout(() => {
    retryAt = null
    createClient()
  }, gap)
}

async function fallbackToVpn() {
  lastError = 'Direct failed, starting VPN...'
  if (client) { try { client.end() } catch (_) {} client = null }
  config.proxy.host = '127.0.0.1'
  if (!currentVpn) {
    const v = await selectFastestVpn()
    if (v) await startVpn(v)
  } else {
    await startVpn(currentVpn)
  }
  scheduleReconnect('error')
}

function stopBot() {
  botEnabled = false
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (posTimer) clearInterval(posTimer)
  if (tickTimer) clearInterval(tickTimer)
  if (connectTimer) clearTimeout(connectTimer)
  if (client) {
    try { client.end() } catch (_) {}
    client = null
  }
  connectedAt = null
  retryAt = null
  leaveAt = null
}

function startBot() {
  if (botEnabled) return
  botEnabled = true
  createClient()
}

const app = express()

function requireAuth(req, res, next) {
  const key = req.headers['x-api-key']
  if (!key || key !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-api-key header.' })
  }
  next()
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'))
})

app.get('/', (req, res) => {
  const connected = client && client.state === mc.states.PLAY
  const retryIn = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : null

  let status = 'stopped'
  if (!botEnabled) status = 'stopped'
  else if (client) {
    if (connected) status = 'connected'
    else if (retryIn) status = 'retrying'
    else status = 'connecting'
  } else if (botEnabled) status = 'starting'

  const leaveInNum = leaveAt ? Math.max(0, Math.ceil((leaveAt - Date.now()) / 1000)) : null

  res.json({
    status,
    enabled: botEnabled,
    name: connected ? currentName : null,
    uptime: connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) + 's' : null,
    retryIn: retryIn ? retryIn + 's' : null,
    leaveIn: leaveInNum ? leaveInNum + 's' : null,
    vpn: currentVpn ? `${currentVpn.host}:${currentVpn.port} (${currentVpn.label || ''})` : 'none',
    error: lastError || null,
    stats: {
      connections: stats.connections,
      kicks: stats.kicks,
      totalUptime: Math.floor(stats.totalUptime / 1000) + 's',
      lastConnected: stats.lastConnected ? new Date(stats.lastConnected).toISOString() : null
    }
  })
})

app.post('/start', requireAuth, (req, res) => {
  startBot()
  res.json({ status: 'starting' })
})

app.post('/stop', requireAuth, (req, res) => {
  if (!botEnabled) return res.json({ status: 'already_stopped' })
  stopBot()
  res.json({ status: 'stopped' })
})

app.post('/restart', requireAuth, (req, res) => {
  stopBot()
  setTimeout(() => startBot(), 1000)
  res.json({ status: 'restarting' })
})

app.post('/vpn', requireAuth, async (req, res) => {
  const mode = req.query.mode || 'status'
  if (mode === 'select' && req.query.host) {
    const vpn = (config.vpns || []).find(v => v.host === req.query.host && String(v.port) === String(req.query.port))
    if (!vpn) return res.json({ error: 'VPN not found' })
    stopBot()
    const ok = await startVpn(vpn)
    if (!ok) return res.json({ error: 'VPN failed to start' })
    startBot()
    return res.json({ status: 'vpn_changed', vpn: `${vpn.host}:${vpn.port}` })
  }
  if (mode === 'auto') {
    stopBot()
    const vpns = config.vpns || []
    const results = await Promise.all(vpns.map(async (v) => {
      const ms = await tcpPing(v.host, v.port)
      return { vpn: v, ms }
    }))
    const valid = results.filter(r => r.ms !== null).sort((a, b) => a.ms - b.ms)
    if (valid.length === 0) return res.json({ error: 'No VPN reachable' })
    const best = valid[0]
    const ok = await startVpn(best.vpn)
    if (!ok) return res.json({ error: 'VPN failed to start' })
    startBot()
    return res.json({ status: 'auto_selected', vpn: `${best.vpn.host}:${best.vpn.port} (${best.ms}ms)` })
  }
  res.json({
    current: currentVpn ? `${currentVpn.host}:${currentVpn.port}` : null,
    available: (config.vpns || []).map(v => ({
      label: v.label, host: v.host, port: v.port, method: v.method || 'chacha20-ietf-poly1305'
    }))
  })
})

app.post('/vpntest', requireAuth, async (req, res) => {
  const vpns = config.vpns || []
  if (vpns.length === 0) return res.json({ error: 'No VPNs configured' })
  const results = await Promise.all(vpns.map(async (vpn) => {
    const ms = await tcpPing(vpn.host, vpn.port)
    return { label: vpn.label, host: vpn.host, port: vpn.port, latency: ms }
  }))
  res.json(results)
})

process.on('SIGTERM', () => { stopBot(); stopVpnAsync(); process.exit(0) })
process.on('SIGINT', () => { stopBot(); stopVpnAsync(); process.exit(0) })
process.on('uncaughtException', (e) => { lastError = 'uncaught: ' + e.message; console.error(e) })
process.on('unhandledRejection', (e) => { lastError = 'unhandled: ' + String(e); console.error(e) })

const PORT = process.env.PORT || 7860
app.listen(PORT, '0.0.0.0', () => {
  createClient()
})
