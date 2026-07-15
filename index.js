import express from 'express'
import mc from 'minecraft-protocol'
import fs from 'fs'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
let client = null
let reconnectTimer = null
let leaveTimer = null
let posTimer = null
let posX = 0, posY = 64, posZ = 0
let connectedAt = null

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

function createClient(useName) {
  if (client) {
    client.end()
    client = null
  }

  currentName = useName || randomName()
  console.log(`[*] Attempting join as ${currentName}`)

  client = mc.createClient({
    host: config.server.host,
    port: config.server.port,
    username: currentName,
    version: config.server.version,
    auth: 'offline',
    hideErrors: true
  })

  client.on('playerJoin', () => {
    console.log(`[+] ${currentName} joined`)
    sendClientSettings()
    connectedAt = Date.now()
    startPositionUpdates()
    scheduleLeave()

    if (config.server.password) {
      setTimeout(() => client.chat(`/login ${config.server.password}`), 2000)
      setTimeout(() => client.chat(`/register ${config.server.password} ${config.server.password}`), 2000)
    }
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
      console.log('[!] Server offline')
    }
    scheduleReconnect()
  })

  client.on('end', () => {
    if (connectedAt) {
      console.log(`[-] ${currentName} left (was online ${Math.floor((Date.now() - connectedAt) / 60000)}m)`)
    } else {
      console.log('[-] Disconnected')
    }
    connectedAt = null
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
  const stayMin = config.bot.stayMin || 30
  const stayMax = config.bot.stayMax || 180
  const stay = randomInt(stayMin, stayMax) * 60 * 1000
  console.log(`[*] Will leave in ${Math.floor(stay / 60000)}m`)
  leaveTimer = setTimeout(() => {
    console.log(`[*] ${currentName} leaving...`)
    connectedAt = null
    if (client) client.end()
  }, stay)
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (posTimer) clearInterval(posTimer)

  const gapMin = config.bot.gapMin || 5
  const gapMax = config.bot.gapMax || 30
  const gap = randomInt(gapMin, gapMax) * 60 * 1000
  console.log(`[*] Rejoining in ${Math.floor(gap / 60000)}m`)
  reconnectTimer = setTimeout(() => createClient(), gap)
}

const app = express()

app.get('/', (req, res) => {
  const status = client ? (client.state === mc.states.PLAY ? 'connected' : 'connecting') : 'offline'
  let uptime = 'N/A'
  if (connectedAt) {
    uptime = Math.floor((Date.now() - connectedAt) / 1000) + 's'
  }
  res.json({
    status,
    name: currentName || 'N/A',
    uptime,
    leaveIn: leaveTimer ? Math.ceil((leaveTimer._idleStart + leaveTimer._idleTimeout - Date.now()) / 1000) + 's' : 'N/A'
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
  console.log(`[*] Web server on :${PORT}`)
  createClient()
})
