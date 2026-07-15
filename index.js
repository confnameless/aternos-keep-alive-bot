import express from 'express'
import mc from 'minecraft-protocol'
import fs from 'fs'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
let client = null
let reconnectTimer = null
let restartTimer = null
let posTimer = null
let posX = 0, posY = 64, posZ = 0

function createClient() {
  if (client) {
    client.end()
    client = null
  }

  client = mc.createClient({
    host: config.server.host,
    port: config.server.port,
    username: config.bot.name,
    version: config.server.version,
    auth: 'offline',
    hideErrors: false
  })

  client.on('playerJoin', () => {
    console.log(`[+] Logged in as ${client.username}`)
    sendClientSettings()

    if (config.server.password) {
      setTimeout(() => client.chat(`/login ${config.server.password}`), 2000)
      setTimeout(() => client.chat(`/register ${config.server.password} ${config.server.password}`), 2000)
    }

    startPositionUpdates()
  })

  client.on('position', (packet) => {
    if (packet.x !== undefined) posX = packet.x
    if (packet.y !== undefined) posY = packet.y
    if (packet.z !== undefined) posZ = packet.z
    client.write('position_look', {
      x: posX, y: posY, z: posZ,
      yaw: 0, pitch: 0,
      flags: 0
    })
  })

  client.on('system_chat', (packet) => {
    const msg = packet.formattedMessage || packet.content || ''
    console.log('[CHAT]', typeof msg === 'string' ? msg : JSON.stringify(msg))
    if (config.server.password) {
      const lower = (typeof msg === 'string' ? msg : JSON.stringify(msg)).toLowerCase()
      if (lower.includes('register')) {
        client.chat(`/register ${config.server.password} ${config.server.password}`)
      } else if (lower.includes('login')) {
        client.chat(`/login ${config.server.password}`)
      }
    }
  })

  client.on('player_chat', (packet) => {
    console.log('[CHAT]', packet.message || packet.formattedMessage || '')
  })

  client.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.log('[!] Server offline, retrying...')
    } else {
      console.log('[!] Error:', err.message)
    }
    scheduleReconnect()
  })

  client.on('end', () => {
    console.log('[-] Disconnected')
    scheduleReconnect()
  })
}

function sendClientSettings() {
  client.write('settings', {
    locale: 'en_US',
    viewDistance: 2,
    chatFlags: 0,
    chatColors: true,
    skinParts: 0x7f,
    mainHand: 1,
    textFiltering: false,
    serverListings: false
  })
}

function startPositionUpdates() {
  if (posTimer) clearInterval(posTimer)
  posTimer = setInterval(() => {
    if (!client || client.state !== mc.states.PLAY) return
    client.write('position_look', {
      x: posX, y: posY, z: posZ,
      yaw: Math.random() * 360 - 180,
      pitch: Math.random() * 20 - 10,
      flags: 0
    })
  }, 30000)
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (restartTimer) clearTimeout(restartTimer)
  if (posTimer) clearInterval(posTimer)
  const delay = config.reconnect.delay * 1000
  console.log(`[*] Reconnecting in ${config.reconnect.delay}s`)
  reconnectTimer = setTimeout(createClient, delay)
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer)
  const hours = config.bot.restartHours || 4
  console.log(`[*] Scheduled restart in ${hours}h`)
  restartTimer = setTimeout(() => {
    console.log('[*] Restarting bot...')
    scheduleReconnect()
  }, hours * 3600 * 1000)
}

const app = express()

app.get('/', (req, res) => {
  const status = client ? (client.state === mc.states.PLAY ? 'connected' : 'connecting') : 'offline'
  let uptime = 'N/A'
  if (client && client.connectTime) {
    uptime = Math.floor((Date.now() - client.connectTime) / 1000) + 's'
  }
  res.json({
    status,
    uptime,
    restartIn: restartTimer ? Math.ceil((restartTimer._idleStart + restartTimer._idleTimeout - Date.now()) / 1000) + 's' : 'N/A'
  })
})

app.get('/restart', (req, res) => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (restartTimer) clearTimeout(restartTimer)
  createClient()
  res.json({ status: 'restarting' })
})

const PORT = process.env.PORT || 7860
app.listen(PORT, () => {
  console.log(`[*] Web server on :${PORT}`)
  createClient()
})
