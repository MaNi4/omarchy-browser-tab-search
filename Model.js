.pragma library

// Which tabs a query shows, and in what order. Pure: tabs in, rows out, so it
// runs under node in tests/run.js.

// "Café Menü" -> "cafe menu"
function fold(text) {
  var s = String(text || "").toLowerCase()
  try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, "") } catch (e) {}
  return s
}

// What to show for where a tab is: the site for web pages, the address for
// the rest (brave://settings, file:///…).
function place(url) {
  var u = String(url || "")
  var m = /^https?:\/\/([^\/?#]+)/i.exec(u)
  if (m) return m[1].replace(/^www\./i, "").replace(/:\d+$/, "")
  if (/^data:/i.test(u)) return "data:"
  return u.length > 80 ? u.substring(0, 80) + "…" : u
}

// The address without its scheme and www., which is what people type.
function bareUrl(url) {
  return fold(url).replace(/^[a-z-]+:\/\/(www\.)?/, "")
}

function byRecent(a, b) {
  if (b.lastAccessed !== a.lastAccessed) return (b.lastAccessed || 0) - (a.lastAccessed || 0)
  return (a.window - b.window) || (a.index - b.index)
}

// How well one word matches a tab; 0 when it does not.
function wordScore(word, title, host, url) {
  var at = title.indexOf(word)
  if (at === 0) return 6
  if (at > 0) return /[\s\-–—|:·(\[\/.,_]/.test(title.charAt(at - 1)) ? 5 : 3
  var h = host.indexOf(word)
  if (h === 0) return 4
  if (h > 0) return 3
  if (url.indexOf(word) >= 0) return 1
  return 0
}

// Letters of `query` in order inside `text`, for typos like "gthb" -> GitHub.
function subsequence(query, text) {
  var j = 0
  for (var i = 0; i < text.length && j < query.length; i++) if (text.charAt(i) === query.charAt(j)) j++
  return j === query.length
}

// ---------------------------------------------------------------- filters

// "!audio", "!pin" and the like narrow the tabs to a kind; the start of the
// name is enough ("!au"). `test(tab, dupes)` says whether a tab is of it.
var FILTERS = [
  { name: "audio", about: "playing sound", test: function(t) { return !!t.audible } },
  { name: "muted", about: "muted", test: function(t) { return !!t.muted } },
  { name: "pin", about: "pinned", test: function(t) { return !!t.pinned } },
  { name: "dup", about: "open more than once", test: function(t, d) { return copies(t, d) > 1 } },
]

// ---------------------------------------------------------------- searches

// "!" narrows the tabs, "?" first searches outside them: "?rust" the web,
// as "?" does in the browsers' address bars, "?w linux" one of these sites.
// They can be changed in the overlay (Ctrl+,); %s is where the words go.
var DEFAULT_SEARCHES = [
  { key: "y", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { key: "w", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  { key: "gh", name: "GitHub", url: "https://github.com/search?q=%s" },
  { key: "m", name: "Google Maps", url: "https://www.google.com/maps/search/%s" },
  { key: "r", name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  { key: "x", name: "X", url: "https://x.com/search?q=%s" },
  { key: "a", name: "Amazon", url: "https://www.amazon.com/s?k=%s" },
]
var MAX_SEARCHES = 40

// What is wrong with a search, or "" when nothing is. `index` is its place
// in `list` when it is already there.
function searchProblem(entry, list, index) {
  var key = String(entry.key || "")
  if (!/^[a-z0-9]{1,6}$/.test(key)) return "Use 1 to 6 lowercase letters or digits for the shortcut."
  for (var i = 0; i < (list || []).length; i++)
    if (i !== index && list[i].key === key) return "?" + key + " is already used by " + list[i].name + "."
  var name = String(entry.name || "").trim()
  if (name === "" || name.length > 40) return "The name can be 1 to 40 characters long."
  var url = String(entry.url || "")
  if (!/^https?:\/\/[^\s\/]+\S*$/.test(url) || url.length > 500) return "The URL must start with https:// and contain no spaces."
  if (url.indexOf("%s") < 0) return "The URL needs %s where the search words go."
  return ""
}

// The searches from the config file: its list when it has one, the
// defaults otherwise. Broken entries are left out.
function searches(config) {
  var raw = config && Array.isArray(config.searches) ? config.searches : DEFAULT_SEARCHES
  var out = []
  for (var i = 0; i < raw.length && out.length < MAX_SEARCHES; i++) {
    var e = raw[i] || {}
    var entry = { key: String(e.key || "").toLowerCase(), name: String(e.name || "").trim(), url: String(e.url || "") }
    if (searchProblem(entry, out, -1) === "") out.push(entry)
  }
  return out
}

// "!au youtube" -> { text: "youtube", filters: [audio], engine: "" }; with
// "?" first, engine is "web" or the search whose shortcut follows ("?y").
// A "!" word that starts no filter name is left out, so half-typed ones do
// not empty the list.
function parse(query, sites) {
  var raw = String(query || "").replace(/^\s+/, "")
  if (raw.charAt(0) === "?") {
    var m = /^\?(\S+)(\s+|$)/.exec(raw)
    var site = null
    for (var s = 0; m && s < (sites || []).length; s++) if (sites[s].key === m[1].toLowerCase()) site = sites[s]
    return { text: raw.substring(site ? m[0].length : 1).trim(), filters: [], engine: site || "web" }
  }
  var words = raw.split(/\s+/)
  var text = []
  var filters = []
  for (var i = 0; i < words.length; i++) {
    var w = words[i]
    if (w.charAt(0) !== "!") { if (w) text.push(w); continue }
    var name = fold(w.substring(1))
    if (!name) continue
    for (var j = 0; j < FILTERS.length; j++) {
      if (FILTERS[j].name.indexOf(name) === 0) { if (filters.indexOf(FILTERS[j]) < 0) filters.push(FILTERS[j]); break }
    }
  }
  return { text: text.join(" "), filters: filters, engine: "" }
}

// The row that hands the words to a search engine, in the browser in front.
// `engine` is "web" for the browser's own one, or a search from the list.
function webRow(tabs, engine, text) {
  var front = frontTab(tabs)
  var site = engine !== "web" ? engine : null
  return { type: "web", key: front.key, site: site, query: text, url: "",
           title: "Search " + (site ? site.name : "the web") + " for “" + text + "”" }
}

// Pinned tabs in the order of the browser's tab strip.
function byStrip(a, b) {
  return String(a.key || "").localeCompare(String(b.key || "")) || (a.window - b.window) || (a.index - b.index)
}

// rows(tabs, "git hub") -> the tabs to list, best first. With no query, the
// pinned tabs come first in the browser's order, then the rest most recently
// used first, as in the browser's own tab switcher.
function rows(tabs, query, dupes) {
  var parsed = parse(query)
  var list = (tabs || []).filter(function(t) {
    for (var f = 0; f < parsed.filters.length; f++) if (!parsed.filters[f].test(t, dupes)) return false
    return true
  })
  var words = fold(parsed.text).split(/\s+/).filter(function(w) { return w !== "" })
  if (words.length === 0) {
    // The tab in front comes first even when the browser has not yet noted
    // it as used, which it may not do for a tab switched to from outside.
    var pinned = list.filter(function(t) { return t.pinned }).sort(byStrip)
    var rest = list.filter(function(t) { return !t.pinned }).sort(byRecent)
    var front = rest.filter(isFront)
    return pinned.concat(front, rest.filter(function(t) { return !isFront(t) }))
  }

  var scored = []
  for (var i = 0; i < list.length; i++) {
    var tab = list[i]
    var title = fold(tab.title)
    var host = fold(place(tab.url))
    var url = bareUrl(tab.url)
    var total = 0
    for (var w = 0; w < words.length; w++) {
      var s = wordScore(words[w], title, host, url)
      if (s === 0) { total = -1; break }
      total += s
    }
    if (total > 0) scored.push({ tab: tab, score: total })
  }

  // Nothing matched word by word: try the letters in order.
  if (scored.length === 0) {
    var joined = words.join("")
    for (var k = 0; k < list.length; k++) {
      var t = list[k]
      if (subsequence(joined, fold(t.title)) || subsequence(joined, fold(place(t.url)))) scored.push({ tab: t, score: 1 })
    }
  }

  scored.sort(function(a, b) { return (b.score - a.score) || byRecent(a.tab, b.tab) })
  return scored.map(function(entry) { return entry.tab })
}

function isFront(t) { return !!(t.active && t.focusedWindow) }

// The tab in front: new tabs open in its browser. bin/browser-tab-search keeps
// focusedWindow only for the browser used last.
function frontTab(tabs) {
  return tabs.filter(isFront)[0] || tabs[0]
}

// The row to start on. With no query that is the tab used before the one in
// front, wherever it is listed, so Enter flips between the two, like Alt+Tab.
// Headings are skipped.
function firstIndex(rows, query) {
  var first = nextSelectable(rows, 0, 1)
  if (first < 0) return 0
  if (String(query || "").trim() !== "") return first
  var best = -1
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    if (r.type || isFront(r)) continue
    if (best < 0 || (r.lastAccessed || 0) > (rows[best].lastAccessed || 0)) best = i
  }
  return best >= 0 ? best : first
}

// The pinned tab next to this one in its window, `step` places along; null if none.
function pinnedNeighbour(tabs, tab, step) {
  if (!tab || tab.type || !tab.pinned) return null
  for (var i = 0; i < (tabs || []).length; i++) {
    var t = tabs[i]
    if (t.pinned && t.key === tab.key && t.window === tab.window && t.index === tab.index + step) return t
  }
  return null
}

// The first row from `from` on, going `step`, that is not a heading; -1 if none.
function nextSelectable(rows, from, step) {
  for (var i = from; i >= 0 && i < rows.length; i += step) if (rows[i].type !== "header") return i
  return -1
}

// ---------------------------------------------------------------- duplicates

// The same page, whatever its #anchor, in the same browser and kind of window.
function pageKey(tab) {
  return tab.key + "|" + (tab.incognito ? 1 : 0) + "|" + String(tab.url || "").replace(/#.*$/, "")
}

// pageKey -> how many tabs show it, for pages open more than once.
function duplicates(tabs) {
  var counts = {}
  for (var i = 0; i < (tabs || []).length; i++) {
    var k = pageKey(tabs[i])
    counts[k] = (counts[k] || 0) + 1
  }
  var out = {}
  for (var key in counts) if (counts[key] > 1) out[key] = counts[key]
  return out
}

function copies(tab, dupes) {
  return (dupes && dupes[pageKey(tab)]) || 0
}

// ---------------------------------------------------------------- everything together

// How many recently closed to show with no query, and at most with one.
var CLOSED_SHOWN = 5

// matchScore(item, query) > 0 when every word of the query is in the title or address.
function matchScore(item, query) {
  var words = fold(query).split(/\s+/).filter(function(w) { return w !== "" })
  var title = fold(item.title)
  var host = fold(place(item.url))
  var url = bareUrl(item.url)
  var total = 0
  for (var w = 0; w < words.length; w++) {
    var s = wordScore(words[w], title, host, url)
    if (s === 0) return 0
    total += s
  }
  return total
}

// The rows: open tabs, then headed sections of recently closed tabs,
// bookmarks and history. `found` is the last answer for this query from
// `browser-tab-search serve`: { query, bookmarks, history }.
// "example.org", "localhost:3000/x", "https://…" -> the address to open, as the
// browser's address bar would; "" for anything else.
function address(query) {
  var q = String(query || "").trim()
  if (q === "" || /\s/.test(q) || q.length > 2000) return ""
  if (/^https?:\/\/[^\s\/]+/i.test(q)) return q
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(q)) return "http://" + q
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q)) return "https://" + q
  return ""
}

// Which sections are listed: the settings' "show", all of them by default.
function shown(config) {
  var show = (config && config.show) || {}
  return { closed: show.closed !== false, bookmarks: show.bookmarks !== false, history: show.history !== false }
}

function sections(tabs, closed, found, query, dupes, sites, show) {
  show = show || shown(null)
  var parsed = parse(query, sites)
  if (parsed.engine) return parsed.text !== "" && (tabs || []).length > 0 ? [webRow(tabs, parsed.engine, parsed.text)] : []
  var out = rows(tabs, query, dupes)
  // An address comes first, to open it, as in the address bar.
  var url = parsed.filters.length === 0 ? address(query) : ""
  if (url && (tabs || []).length > 0) out.unshift({ type: "open", key: frontTab(tabs).key, url: url, title: "Open " + query.trim() })
  // With no words typed, pinned tabs get a heading of their own.
  if (fold(parsed.text).trim() === "" && out.length > 0 && out[0].pinned) {
    var split = 0
    while (split < out.length && out[split].pinned) split++
    var head = [{ type: "header", title: "Pinned" }].concat(out.slice(0, split))
    out = split < out.length ? head.concat([{ type: "header", title: "Tabs" }], out.slice(split)) : head
  }
  // A filter is about open tabs; the other sections have nothing to match it.
  if (parsed.filters.length > 0) return out
  query = parsed.text
  var q = fold(query).trim()
  var open = {}
  for (var i = 0; i < (tabs || []).length; i++) open[String(tabs[i].url || "").replace(/#.*$/, "")] = true

  var gone = (closed || []).filter(function(c) {
    return !open[String(c.url || "").replace(/#.*$/, "")] && (q === "" || matchScore(c, query) > 0)
  }).slice(0, CLOSED_SHOWN)
  function add(title, items, type) {
    if (items.length === 0) return
    out.push({ type: "header", title: title })
    for (var j = 0; j < items.length; j++) out.push(Object.assign({ type: type }, items[j]))
  }
  if (show.closed) add("Recently closed", gone, "closed")
  if (q !== "" && found && fold(found.query).trim() === q) {
    if (show.bookmarks) add("Bookmarks", found.bookmarks || [], "bookmark")
    if (show.history) add("History", found.history || [], "history")
  }
  // Last, the words as a web search, in the browser in front.
  if (q !== "" && (tabs || []).length > 0) out.push(webRow(tabs, "web", query.trim()))
  return out
}

// The query bookmarks and history are searched for: the words, without filters.
function searchText(query) {
  var parsed = parse(query)
  return parsed.filters.length > 0 || parsed.engine ? "" : parsed.text.trim()
}

// "3 min ago", for a time in milliseconds.
function ago(ms, now) {
  var s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return Math.round(s / 60) + " min ago"
  if (s < 86400) return Math.round(s / 3600) + " h ago"
  return Math.round(s / 86400) + " d ago"
}

// What sits at the end of a row: the window number when there are several,
// the browser when there are several.
function badges(tab, browsers, windows, dupes) {
  var out = []
  var n = copies(tab, dupes)
  if (n > 1) out.push(n + " copies")
  if (browsers > 1) out.push(tab.browser)
  if (windows > 1) out.push("Window " + tab.window)
  return out
}
