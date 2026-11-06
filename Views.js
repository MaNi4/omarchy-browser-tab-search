.pragma library
.import "Model.js" as Model

// What the overlay shows, apart from the tabs themselves (Model.js): the
// key list, the settings, the key picker, each row's icon and second line,
// the footer's hints and the line shown when there is nothing to list.
// Pure, so it runs under node in tests/run.js.

// ---------------------------------------------------------------- the key list (Ctrl+/)

var KEY_HELP = [
  { keys: ["↵"], about: "Switch to the tab, or open the selected item" },
  { keys: ["↑", "↓"], about: "Move up and down (also Ctrl+N/P and Ctrl+J/K)" },
  { keys: ["PgUp", "PgDn"], about: "Move a page at a time" },
  { keys: ["tab", "⇧ tab"], about: "Mark or unmark, then go to the next one" },
  { keys: ["ctrl w"], about: "Close the tab, or all marked tabs" },
  { keys: ["ctrl a"], about: "Mark all listed tabs (press again to unmark)" },
  { keys: ["ctrl d"], about: "Close the other copies of this page" },
  { keys: ["ctrl m"], about: "Mute or unmute" },
  { keys: ["ctrl ⇧ p"], about: "Pin or unpin" },
  { keys: ["⇧ ↑", "⇧ ↓"], about: "Move a pinned tab" },
  { keys: ["ctrl c"], about: "Copy the address" },
  { keys: ["ctrl ⇧ t"], about: "Reopen the last closed tab" },
  { keys: ["!a"], about: "Only tabs playing sound (!audio)" },
  { keys: ["!m"], about: "Only muted tabs (!muted)" },
  { keys: ["!p"], about: "Only pinned tabs (!pin)" },
  { keys: ["!d"], about: "Only pages open more than once (!dup)" },
  { keys: ["?"], about: "At the start: search the web" },
  { keys: ["?y"], about: "At the start: search YouTube (more in settings)" },
  { keys: ["ctrl ,"], about: "Settings" },
  { keys: ["ctrl /"], about: "Show this list" },
  { keys: ["esc"], about: "Go back, unmark, clear or close" },
]

function matches(query, text) {
  return String(query || "").trim() === "" || Model.matchScore({ title: text, url: "" }, query) > 0
}

function keyRows(query) {
  return KEY_HELP.filter(function(k) { return matches(query, k.about + " " + k.keys.join(" ")) })
    .map(function(k) { return { type: "key", title: k.about, keys: k.keys, url: "" } })
}

// ---------------------------------------------------------------- settings (Ctrl+,)

var TOGGLES = [
  { id: "closed", title: "Recently closed tabs", about: "Tabs you closed lately" },
  { id: "bookmarks", title: "Bookmarks", about: "Matching bookmarks as you type" },
  { id: "history", title: "History", about: "Matching pages you have visited" },
]

// s: { query, hotkey, show, sites }
function settingsRows(s) {
  var out = []
  if (matches(s.query, "Key that opens Browser Tab Search hotkey shortcut " + s.hotkey))
    out.push({ type: "header", title: "Key" },
             { type: "keyset", key: "keyset", title: "Shortcut", keys: [s.hotkey || "no key"], url: "" })

  var toggles = TOGGLES.filter(function(t) { return matches(s.query, t.title + " " + t.about + " show") })
  if (toggles.length > 0) out.push({ type: "header", title: "Show" })
  toggles.forEach(function(t) {
    out.push({ type: "toggle", id: t.id, key: t.id, title: t.title, about: t.about, on: !!s.show[t.id], url: "" })
  })

  out.push({ type: "header", title: "Searches, e.g. ?w linux" })
  s.sites.forEach(function(site, i) {
    if (matches(s.query, site.name + " " + site.key + " " + site.url + " search"))
      out.push({ type: "site", index: i, key: site.key, title: site.name, url: site.url, keys: ["?" + site.key] })
  })
  out.push({ type: "add", key: "add", title: "Add a search", url: "" })
  if (JSON.stringify(s.sites) !== JSON.stringify(Model.searches(null)))
    out.push({ type: "reset", key: "reset", title: "Restore the default searches", url: "" })
  return out
}

// choices: Hotkey.choices(); hotkey: the key now.
function hotkeyRows(choices, hotkey) {
  var out = [{ type: "header", title: "Shortcut" }]
  choices.forEach(function(c) {
    out.push({ type: "hotkey", key: c.hotkey, title: c.hotkey, off: c.holder !== "", url: "",
               about: c.hotkey === hotkey ? "Current" : c.holder ? "Used by “" + c.holder + "”" : "Free" })
  })
  return out
}

// ---------------------------------------------------------------- rows

// Whether two rows are the same thing, so the selection can stay on it
// while the list changes underneath.
function sameRow(a, b) {
  if (!a || !b || (a.type || "") !== (b.type || "") || a.key !== b.key) return false
  if (!a.type) return a.id === b.id
  if (a.type === "closed") return a.sessionId === b.sessionId
  if (a.type === "key") return a.title === b.title
  return a.url === b.url
}

// Marks are kept per tab, or per recently closed tab, across lists.
function markId(t) {
  return t.type === "closed" ? "closed:" + t.key + ":" + t.sessionId : t.key + ":" + t.id
}

var GLYPHS = { connect: "󰌷", closed: "󰕍", bookmark: "󰃀", history: "󰋚", key: "󰌌", web: "󰍉", open: "󰏌",
               site: "󰍉", add: "󰐕", reset: "󰑓", hotkey: "󰌌", keyset: "󰌌" }

// The glyph shown when a row has no favicon.
function glyph(row) {
  if (row.type === "toggle") return row.on ? "󰄵" : "󰄱"
  return GLYPHS[row.type || ""] || "󰖟"
}

// The second line of a row.
function subtitle(row) {
  switch (row.type || "") {
  case "connect": return "Installs a small helper and turns on the Browser Tab Search extension"
  case "key": case "header": return ""
  case "site": return row.url
  case "toggle": case "hotkey": return row.about
  case "keyset": return "Press Enter to change it"
  case "open": return row.url
  case "add": return "Search any site you like"
  case "reset": return Model.searches(null).map(function(s) { return s.name }).join(", ")
  case "web": return row.site ? Model.place(row.site.url) : "Your default search engine"
  default: return Model.place(row.url)
  }
}

// The small words at the end of a row. ctx: { browsers, windowCounts, dupes, now }
function badges(row, ctx) {
  switch (row.type || "") {
  case "": return Model.badges(row, ctx.browsers, ctx.windowCounts[row.key] || 1, ctx.dupes)
  case "closed": return [row.tabs > 1 ? "window · " + row.tabs + " tabs" : "", Model.ago(row.closedAt, ctx.now)].filter(function(b) { return b })
  case "bookmark": return row.folder ? [row.folder] : []
  case "toggle": return [row.on ? "Shown" : "Hidden"]
  default: return []
  }
}

// Muted or playing sound, pinned.
function stateGlyphs(row) {
  return [row.muted ? "󰖁" : row.audible ? "󰕾" : "", row.pinned ? "󰐃" : ""].filter(function(s) { return s }).join("  ")
}

// ---------------------------------------------------------------- footer and empty list

var ENTER = { connect: "Connect", closed: "Reopen", bookmark: "Open in a new tab", history: "Open in a new tab",
              web: "Search", open: "Open in a new tab", site: "Edit", add: "Add", reset: "Restore", keyset: "Change" }

function enterLabel(row) {
  if (!row || row.type === "key" || row.type === "header") return ""
  if (row.type === "toggle") return row.on ? "Hide" : "Show"
  if (row.type === "hotkey") return row.off ? "Taken" : "Use this key"
  return ENTER[row.type || ""] || "Switch to tab"
}

// The hints on the left of the footer, [{ key, text }].
// s: { mode, row, marks, editing (index of the search being edited), copies }
function hints(s) {
  var out = []
  var onTab = !!s.row && !s.row.type && s.mode === "tabs"
  if (s.mode === "edit") {
    out.push({ key: "↵", text: "Save" }, { key: "tab", text: "Next field" })
    if (s.editing >= 0) out.push({ key: "ctrl w", text: "Remove" })
    return out
  }
  if (s.marks > 0) return [{ key: "ctrl w", text: "Close" }, { key: "ctrl m", text: "Mute" }]
  var enter = enterLabel(s.row)
  if (enter) out.push({ key: "↵", text: enter })
  if (onTab) out.push({ key: "ctrl w", text: "Close tab" })
  if (onTab && s.copies > 1) out.push({ key: "ctrl d", text: "Close copies" })
  if (s.mode === "tabs" && s.row && s.row.type === "closed") out.push({ key: "ctrl w", text: "Hide" })
  if (s.mode === "settings" && s.row && s.row.type === "site") out.push({ key: "ctrl w", text: "Remove" })
  return out
}

function escLabel(mode, marks, typed) {
  if (mode === "edit") return "Cancel"
  if (mode !== "tabs") return "Back"
  return marks > 0 ? "Unmark" : typed ? "Clear" : "Close"
}

function placeholder(mode) {
  return ({ keys: "Search the keys", settings: "Filter the settings",
            hotkey: "Pick one or type your own, e.g. SUPER + ALT + T" })[mode] || "Search tabs"
}

// "brave-origin" -> "Brave Origin", for the browser classes Hyprland reports.
function className(c) {
  var s = String(c || "")
  if (/^brave-origin/i.test(s)) return "Brave Origin"
  if (/^brave/i.test(s)) return "Brave"
  if (/^chromium/i.test(s)) return "Chromium"
  if (/^microsoft-edge/i.test(s)) return "Edge"
  if (/^vivaldi/i.test(s)) return "Vivaldi"
  return s
}

// "Brave", "Brave and Chromium", "Brave, Chromium and Vivaldi".
function listNames(names) {
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]
}

// The line shown instead of an empty list; "" when the list has rows.
// s: { rows, status, note, setup, canConnect, browserNames, mode, query, sites }
function emptyMessage(s) {
  if (s.rows > 0 || s.mode === "edit") return ""
  if (s.status === "loading") return "Reading your tabs…"
  if (s.status === "error") return s.note || "Could not read the tabs."
  if (s.status === "connected") return "Done. Restart " + s.browserNames + " to finish."
  if (s.status === "none") {
    if (s.canConnect) return ""
    if (s.setup && s.setup.stale && s.setup.stale.length > 0)
      return listNames(s.setup.stale.map(className)) + (s.setup.stale.length > 1 ? " are" : " is")
        + " still running with its old settings. Quit it completely, including its web apps, then start it again."
    // Started with the extension, yet it does not answer (yet).
    if (s.setup && s.setup.loaded && s.setup.loaded.length > 0) {
      var names = s.setup.loaded.map(className)
      return listNames(names) + (names.length > 1 ? " have" : " has")
        + " the extension but it does not answer. Quit it completely, including its web apps, and start it again."
    }
    if (s.setup && s.setup.running && s.setup.running.length > 0)
      return "Restart " + s.browserNames + " to turn on Browser Tab Search."
    return "Open your browser and its tabs show up here."
  }
  var q = String(s.query || "").trim()
  if (s.mode !== "tabs") return "Nothing matches “" + q + "”."
  var parsed = Model.parse(s.query, s.sites)
  if (parsed.engine) return "Type what to search for on " + (parsed.engine.name || "the web") + "."
  if (parsed.filters.length > 0) return "No tab is " + parsed.filters.map(function(f) { return f.about }).join(" and ") + "."
  if (q !== "") return "Nothing matches “" + q + "”."
  return "No tabs are open."
}
