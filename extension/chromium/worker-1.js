// The file name carries a number that goes up with every change: browsers
// keep running a cached service worker of an unpacked extension otherwise.

// Omarchy Browser Tab Search: answers the Browser Tab Search panel through a native messaging
// host (bin/browser-tab-search). The host is the only thing this talks to; the
// extension opens no network connections of its own.

const HOST = "com.mani4.tab_search"
const MAX_URL = 2048
const MAX_TITLE = 512
const MAX_ICON = 8192        // base64 characters per icon; bigger ones are left out
const MAX_ICONS = 400        // icons kept in memory

let port = null
let retry = null
const icons = new Map()      // origin -> data URL, or "" when there is none

function connect() {
  if (port) return
  clearTimeout(retry)
  try {
    port = chrome.runtime.connectNative(HOST)
  } catch (e) {
    port = null
    retry = setTimeout(connect, 10000)
    return
  }
  port.onMessage.addListener(answer)
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError // the host is not set up, or it exited
    port = null
    retry = setTimeout(connect, 10000)
  })
}

// The open port keeps the service worker alive; the alarm brings it back if
// it was stopped anyway.
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
chrome.alarms.create("browser-tab-search", { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(connect)
connect()

async function answer(message) {
  if (!message || typeof message.id !== "number") return
  let reply
  try {
    if (message.cmd === "list") reply = await list()
    else if (message.cmd === "activate") reply = await activate(Number(message.tabId))
    else if (message.cmd === "tabs") reply = await onTabs(String(message.action || ""), message.tabIds)
    else if (message.cmd === "dedupe") reply = await dedupe(Number(message.tabId))
    else if (message.cmd === "search") reply = await search(String(message.query || ""))
    else if (message.cmd === "open") reply = await openFound(Number(message.token))
    else if (message.cmd === "move") reply = await moveTab(Number(message.tabId), Number(message.step))
    else if (message.cmd === "web") reply = await webSearch(String(message.query || ""), String(message.url || ""))
    else if (message.cmd === "restore") reply = await restore(String(message.sessionId || ""))
    else reply = { error: "unknown command" }
  } catch (e) {
    reply = { error: String((e && e.message) || e).slice(0, 200) }
  }
  reply.id = message.id
  if (port) port.postMessage(reply)
}

function cut(text, max) {
  text = String(text || "")
  return text.length > max ? text.slice(0, max) : text
}

function originOf(url) {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : u.protocol
  } catch (e) {
    return ""
  }
}

async function list() {
  const [windows, focused, tabs] = await Promise.all([
    chrome.windows.getAll({ windowTypes: ["normal"] }),
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null),
    chrome.tabs.query({ windowType: "normal" }),
  ])
  const order = windows.map(w => w.id).sort((a, b) => a - b)
  const out = tabs.map(tab => ({
    id: tab.id,
    window: order.indexOf(tab.windowId) + 1,
    index: tab.index,
    title: cut(tab.title, MAX_TITLE),
    url: cut(tab.url || tab.pendingUrl, MAX_URL),
    active: !!tab.active,
    focusedWindow: !!(focused && tab.windowId === focused.id),
    pinned: !!tab.pinned,
    audible: !!tab.audible,
    muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
    incognito: !!tab.incognito,
    asleep: !!(tab.discarded || tab.frozen),
    lastAccessed: Math.round(tab.lastAccessed || 0),
    origin: originOf(tab.url || tab.pendingUrl),
  }))
  const closed = await recentlyClosed()
  await fillIcons(tabs.map(t => t.url || t.pendingUrl).concat(closed.map(c => c.url)))
  return { tabs: out, closed: closed, icons: iconsFor(out.concat(closed)), windows: order.length }
}

function iconsFor(items) {
  const used = {}
  for (const item of items) {
    const icon = icons.get(item.origin)
    if (icon) used[item.origin] = icon
  }
  return used
}

// ---------------------------------------------------------------- recently closed

async function recentlyClosed() {
  let sessions = []
  try { sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 }) } catch (e) { return [] }
  const out = []
  for (const session of sessions) {
    if (session.tab && session.tab.sessionId) {
      const url = session.tab.url || ""
      out.push({ sessionId: session.tab.sessionId, title: cut(session.tab.title, MAX_TITLE), url: cut(url, MAX_URL),
                 origin: originOf(url), tabs: 1, closedAt: (session.lastModified || 0) * 1000 })
    } else if (session.window && session.window.sessionId) {
      const tabs = session.window.tabs || []
      const first = tabs[0] || {}
      out.push({ sessionId: session.window.sessionId, title: cut(first.title, MAX_TITLE), url: cut(first.url, MAX_URL),
                 origin: originOf(first.url), tabs: tabs.length, closedAt: (session.lastModified || 0) * 1000 })
    }
  }
  return out
}

async function restore(sessionId) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(sessionId)) return { error: "bad session" }
  const session = await chrome.sessions.restore(sessionId)
  const tab = (session && (session.tab || (session.window && session.window.tabs && session.window.tabs[0]))) || null
  return { ok: true, title: cut(tab && tab.title, MAX_TITLE) }
}

// ---------------------------------------------------------------- duplicates

// The address a duplicate is told by: the same page, whatever its #anchor.
function samePage(url) {
  return String(url || "").replace(/#.*$/, "")
}

// Closes every other tab showing the page this one shows; this one stays.
async function dedupe(tabId) {
  const keep = await chrome.tabs.get(tabId)
  const page = samePage(keep.url || keep.pendingUrl)
  if (!page) return { ok: true, closed: 0 }
  const tabs = await chrome.tabs.query({ windowType: "normal" })
  const others = tabs.filter(t => t.id !== tabId && t.incognito === keep.incognito && samePage(t.url || t.pendingUrl) === page).map(t => t.id)
  if (others.length) await chrome.tabs.remove(others)
  return { ok: true, closed: others.length }
}

// ---------------------------------------------------------------- bookmarks and history

const MAX_FOUND = 8
let bookmarkCache = null     // [{ title, url, place }], dropped when bookmarks change
let historyCache = null      // { at, items }
let found = new Map()        // token -> url of the last search's results
let nextToken = 1

for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onImportEnded"]) {
  if (chrome.bookmarks && chrome.bookmarks[event]) chrome.bookmarks[event].addListener(() => { bookmarkCache = null })
}

function fold(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

async function bookmarks() {
  if (bookmarkCache) return bookmarkCache
  const out = []
  const walk = (nodes, folder) => {
    for (const node of nodes || []) {
      if (node.url) out.push({ title: cut(node.title, MAX_TITLE), url: cut(node.url, MAX_URL), folder: cut(folder, 120) })
      else walk(node.children, node.title || folder)
    }
  }
  walk(await chrome.bookmarks.getTree(), "")
  bookmarkCache = out
  return out
}

async function history() {
  if (historyCache && Date.now() - historyCache.at < 30000) return historyCache.items
  const items = await chrome.history.search({ text: "", startTime: Date.now() - 180 * 864e5, maxResults: 5000 })
  historyCache = { at: Date.now(), items: items.filter(i => i.url).map(i => ({
    title: cut(i.title, MAX_TITLE), url: cut(i.url, MAX_URL), visits: i.visitCount || 0, lastVisit: i.lastVisitTime || 0 })) }
  return historyCache.items
}

// Every word in the title or the address, accents aside, as the panel matches tabs.
function matches(item, words) {
  const title = fold(item.title)
  const url = fold(item.url).replace(/^[a-z-]+:\/\/(www\.)?/, "")
  let score = 0
  for (const word of words) {
    const at = title.indexOf(word)
    if (at === 0) score += 6
    else if (at > 0) score += 4
    else if (url.indexOf(word) >= 0) score += 2
    else return 0
  }
  return score
}

async function search(query) {
  const words = fold(query).split(/\s+/).filter(Boolean).slice(0, 8)
  found = new Map()
  if (words.length === 0) return { bookmarks: [], history: [], icons: {} }
  const [marks, visits, open] = await Promise.all([bookmarks(), history(), chrome.tabs.query({})])
  const openPages = new Set(open.map(t => samePage(t.url || t.pendingUrl)))

  const pick = (items, extra) => items
    .map(item => ({ item, score: matches(item, words) }))
    .filter(entry => entry.score > 0 && !openPages.has(samePage(entry.item.url)))
    .sort((a, b) => (b.score - a.score) || extra(a.item, b.item))

  const bookmarkHits = []
  const seen = new Set()
  for (const { item } of pick(marks, () => 0)) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    bookmarkHits.push(item)
    if (bookmarkHits.length >= MAX_FOUND) break
  }
  const historyHits = []
  for (const { item } of pick(visits, (a, b) => (b.visits - a.visits) || (b.lastVisit - a.lastVisit))) {
    if (seen.has(samePage(item.url)) || seen.has(item.url)) continue
    seen.add(samePage(item.url))
    historyHits.push(item)
    if (historyHits.length >= MAX_FOUND) break
  }

  const tag = item => {
    const token = nextToken++
    found.set(token, item.url)
    return Object.assign({ token: token, origin: originOf(item.url) }, item)
  }
  const out = { bookmarks: bookmarkHits.map(tag), history: historyHits.map(tag) }
  const all = out.bookmarks.concat(out.history)
  await fillIcons(all.map(i => i.url))
  out.icons = iconsFor(all)
  return out
}

// Opens a bookmark or a history entry from the last search in a new tab of
// the last used window. Only those addresses can be opened this way.
async function openFound(token) {
  const url = found.get(token)
  if (!url) return { error: "That result is gone; search again." }
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null)
  const tab = await chrome.tabs.create(win ? { url: url, windowId: win.id } : { url: url })
  if (win) await chrome.windows.update(win.id, { focused: true }).catch(() => {})
  return { ok: true, title: "" }
}

// The browser's own favicon cache, read through chrome://favicon's extension
// twin; nothing is fetched from the sites themselves.
async function fillIcons(urls) {
  const wanted = new Map()
  for (const url of urls) {
    const origin = originOf(url)
    if (origin && !icons.has(origin) && !wanted.has(origin)) wanted.set(origin, url)
  }
  await Promise.all([...wanted].map(async ([origin, url]) => {
    let data = ""
    try {
      const icon = new URL(chrome.runtime.getURL("/_favicon/"))
      icon.searchParams.set("pageUrl", url)
      icon.searchParams.set("size", "32")
      const response = await fetch(icon.href)
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ""
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const encoded = btoa(binary)
        const type = response.headers.get("content-type") || "image/png"
        if (encoded.length <= MAX_ICON && /^image\/[a-z+.-]+$/.test(type)) data = "data:" + type + ";base64," + encoded
      }
    } catch (e) {}
    if (icons.size >= MAX_ICONS) icons.delete(icons.keys().next().value)
    icons.set(origin, data)
  }))
}

async function activate(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
  return { ok: true, title: cut(tab.title, MAX_TITLE) }
}

// One change to several tabs at once; a tab that is gone is skipped.
async function onTabs(action, ids) {
  ids = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 500)
  if (action === "close") {
    try {
      await chrome.tabs.remove(ids)
      return { ok: true, done: ids.length }
    } catch (e) {
      // One of them is gone already: close the rest.
      let done = 0
      for (const id of ids) { try { await chrome.tabs.remove(id); done++ } catch (e2) {} }
      return { ok: true, done: done }
    }
  }
  const change = { mute: { muted: true }, unmute: { muted: false }, pin: { pinned: true }, unpin: { pinned: false } }[action]
  if (!change) return { error: "unknown action" }
  let done = 0
  for (const id of ids) {
    try { await chrome.tabs.update(id, change); done++ } catch (e) {}
  }
  return { ok: true, done: done }
}

// A pinned tab trades places with the pinned tab next to it.
async function moveTab(tabId, step) {
  if (step !== 1 && step !== -1) return { error: "bad step" }
  const tab = await chrome.tabs.get(tabId)
  if (!tab.pinned) return { error: "Only pinned tabs move." }
  const [next] = await chrome.tabs.query({ windowId: tab.windowId, index: tab.index + step })
  if (!next || !next.pinned) return { ok: true, moved: false }
  await chrome.tabs.move(tabId, { index: next.index })
  return { ok: true, moved: true }
}

// A search in a new tab of the last used window: the words with the
// browser's own search engine, or a site's search address made of them.
async function webSearch(query, url) {
  const text = query.trim().slice(0, 200)
  if (url && !/^https?:\/\/\S+$/.test(url)) return { error: "Only web addresses open." }
  if (!url && !text) return { error: "Nothing to search for." }
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null)
  if (url) {
    await chrome.tabs.create(win ? { url: cut(url, MAX_URL), windowId: win.id } : { url: cut(url, MAX_URL) })
  } else {
    await chrome.search.query({ text: text, disposition: "NEW_TAB" })
  }
  if (win) await chrome.windows.update(win.id, { focused: true }).catch(() => {})
  return { ok: true, title: "" }
}
