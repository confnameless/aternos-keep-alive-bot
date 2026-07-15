import express from 'express'
import mc from 'minecraft-protocol'
import fs from 'fs'
import { SocksClient } from 'socks'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
let client = null
let reconnectTimer = null
let leaveTimer = null
let posTimer = null
let posX = 0, posY = 64, posZ = 0
let connectedAt = null
let lastError = ''
let retryAt = null
let leaveAt = null

const names = [
  'xX_Builder_Xx', 'NightOwl_27', 'CraftMaster_', 'PixelPanda_',
  'MineKing_10', 'Luna_Builds', 'Shadow_Walker', 'BlockBuster_',
  'Redstone_Guy', 'SkyRunner_99', 'Aqua_Dragon', 'Fire_Spirit_',
  'Creeper_Fear', 'Diamond_Hunt', 'Nether_Rider', 'Ocean_Explorer',
  'Stone_Mason_', 'Iron_Fighter', 'Gold_Miner_', 'Ender_Player'
]

let currentName = ''

function randomName() {
  return names[Math.floor(Math.random() * names.length)]
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

let connectTimer = null

function createClient(useName) {
  if (client) {
    client.end()
    client = null
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
        proxy: {
          host: config.proxy.host,
          port: config.proxy.port,
          type: 5
        },
        command: 'connect',
        destination: {
          host: config.server.host,
          port: config.server.port
        }
      }).then(info => {
        client.setSocket(info.socket)
        client.emit('connect')
      }).catch(err => {
        lastError = 'Proxy: ' + err.message
        client.emit('error', err)
      })
    }
  }

  client = mc.createClient(opts)

  connectTimer = setTimeout(() => {
    if (!client || client.state === mc.states.PLAY) return
    lastError = 'Connection timed out'
    if (client) client.end()
  }, 10000)

  client.on('playerJoin', () => {
    if (connectTimer) clearTimeout(connectTimer)
    lastError = ''
    sendClientSettings()
    connectedAt = Date.now()
    startPositionUpdates()
    scheduleLeave()
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
    if (config.server.password) {
      const lower = (typeof msg === 'string' ? msg : JSON.stringify(msg)).toLowerCase()
      if (lower.includes('register')) {
        client.chat(`/register ${config.server.password} ${config.server.password}`)
      } else if (lower.includes('login')) {
        client.chat(`/login ${config.server.password}`)
      }
    }
  })

  client.on('player_chat', () => {})

  client.on('error', (err) => {
    if (connectTimer) clearTimeout(connectTimer)
    if (err.code === 'ECONNREFUSED') {
      lastError = 'Server offline'
    } else {
      lastError = err.message
    }
    scheduleReconnect()
  })

  client.on('end', () => {
    if (connectTimer) clearTimeout(connectTimer)
    connectedAt = null
    leaveAt = null
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

function scheduleLeave() {
  if (leaveTimer) clearTimeout(leaveTimer)
  const stayMin = config.bot.stayMin || 10
  const stayMax = config.bot.stayMax || 60
  const stay = randomInt(stayMin, stayMax) * 60 * 1000
  leaveAt = Date.now() + stay
  leaveTimer = setTimeout(() => {
    leaveAt = null
    if (client) client.end()
  }, stay)
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (posTimer) clearInterval(posTimer)
  if (connectTimer) clearTimeout(connectTimer)
  connectedAt = null
  leaveAt = null

  const gap = (config.bot.leaveGap || 5) * 1000
  retryAt = Date.now() + gap
  reconnectTimer = setTimeout(() => {
    retryAt = null
    createClient()
  }, gap)
}

const app = express()

app.get('/', (req, res) => {
  const connected = client && client.state === mc.states.PLAY
  const retryIn = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : null

  let status = 'offline'
  if (client) {
    if (connected) status = 'connected'
    else if (retryIn) status = 'retrying'
    else status = 'connecting'
  }

  const leaveInNum = leaveAt ? Math.max(0, Math.ceil((leaveAt - Date.now()) / 1000)) : null

  res.json({
    status,
    name: connected ? currentName : null,
    uptime: connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) + 's' : null,
    retryIn: retryIn ? retryIn + 's' : null,
    leaveIn: leaveInNum ? leaveInNum + 's' : null,
    error: lastError || null
  })
})

app.get('/restart', (req, res) => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  createClient()
  res.json({ status: 'restarting' })
})

const PORT = process.env.PORT || 7860
app.listen(PORT, () => {
  createClient()
})
