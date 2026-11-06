import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Views.js" as Views
import "Hotkey.js" as Hotkey
import "ui"

// The open tabs of every connected browser, in a launcher like Omarchy's menu.
// bin/browser-tab-search lists them and acts on them; Model.js decides which a query
// shows, Views.js what the rows, settings and footer say; ui/ draws them.
// This file holds the state, talks to bin/browser-tab-search and handles the keys.
Item {
  id: root

  property var shell: null
  property var manifest: null

  // ---------------------------------------------------------------- state

  property bool opened: false
  // "tabs", "keys" (Ctrl+/), "settings" (Ctrl+, or the gear), "edit" (one
  // search) or "hotkey" (the key picker)
  property string mode: "tabs"
  property string query: ""
  property var rows: []
  property int selectedIndex: 0
  readonly property var selectedRow: rows[selectedIndex] || null

  // From the last `bin/browser-tab-search list`, kept so the next opening shows it at once.
  property var tabs: []
  property var closed: []           // recently closed tabs and windows, newest first
  property var browsers: []
  property var windowCounts: ({})   // browser key -> how many windows it has
  property var dupes: ({})          // page -> how many tabs show it, for pages open twice or more
  property var icons: ({})          // site -> favicon as a data: URL
  property string status: "loading" // loading | ok | none | connected | error
  property var setup: null          // what is set up when no browser answers
  property string note: ""          // the last thing that went wrong
  property bool relist: false       // a list is still running; list again when it is done
  // Until a fresh list arrives, the rows are the last opening's, which may
  // already be out of date: the tab picked then is now the current one.
  property bool listed: false
  property bool userMoved: false    // the selection was moved by hand since opening
  property bool pendingEnter: false // Enter came before the fresh list

  property var found: null          // bookmarks and history for a query: { query, bookmarks, history }
  property int searchSeq: 0
  property string sentQuery: ""

  property var marks: ({})          // Views.markId -> true, for rows marked with Tab
  readonly property int markCount: Object.keys(marks).length
  property var hiddenClosed: ({})   // sessionId -> true: recently closed tabs hidden with Ctrl+W
  property string flash: ""         // a short line in the footer about what just happened
  property string doomed: ""        // "?x" or "reset" after the first of two presses

  // The config file: the key (Service.qml binds it), what is listed, the searches.
  readonly property string configPath: Quickshell.env("HOME") + "/.config/omarchy/extensions/browser-tab-search.json"
  property var config: ({})
  property bool configBroken: false // not JSON: left alone rather than overwritten
  readonly property var sites: Model.searches(config)
  readonly property var show: Model.shown(config)
  readonly property string hotkey: typeof config.hotkey === "string" ? config.hotkey.trim() : Hotkey.DEFAULT_HOTKEY
  property int editIndex: -1        // the search being edited, -1 for a new one
  property string bindsJson: ""     // `hyprctl binds -j`, for the key picker

  // Rows take the selection on hover only once the pointer really moved, so
  // a list that changes under a resting pointer does not move it.
  property point lastPointer: Qt.point(-1, -1)
  property bool pointerMoved: false

  readonly property string pluginId: (manifest && manifest.id) || "mani4.browser-tab-search"
  readonly property string pluginDir: {
    var s = String(Qt.resolvedUrl("."))
    return s.indexOf("file://") === 0 ? s.substring(7) : s
  }
  readonly property string tool: pluginDir + "bin/browser-tab-search"

  readonly property bool canConnect: !!setup && (!setup.manifests || !setup.flags || setup.flags.length === 0)
  readonly property string browserNames: {
    var names = setup && setup.running ? setup.running.map(Views.className) : []
    return names.length > 0 ? Views.listNames(names) : "your browser"
  }
  readonly property var badgeContext: ({ browsers: browsers.length, windowCounts: windowCounts, dupes: dupes })
  readonly property string message: Views.emptyMessage({
    rows: rows.length, status: status, note: note, setup: setup, canConnect: canConnect,
    browserNames: browserNames, mode: mode, query: query, sites: sites })

  // ---------------------------------------------------------------- look

  // Menu surface tokens, so a theme that styles the Omarchy menu styles this.
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color scrim: Color.menu.scrim
  readonly property color selectedBackground: Color.menu.selectedBackground
  readonly property color selectedText: Color.menu.selectedText
  readonly property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  readonly property int cornerRadius: Style.cornerRadius
  readonly property string fontFamily: Style.font.menuFamily
  readonly property int inputFont: Style.font.heading
  readonly property int inputHeight: Math.max(Style.space(38), inputFont + Style.spacing.controlPaddingY * 2)
  readonly property int rowHeight: Math.max(Style.space(44), Style.font.subtitle + Style.font.caption + Style.spacing.md * 2)
  readonly property int headerHeight: Math.max(Style.space(26), Style.font.caption + Style.spacing.md * 2)
  readonly property int maxRows: 9
  // All rows, headings shorter, up to about maxRows rows tall.
  readonly property int listHeight: {
    var h = 0
    for (var i = 0; i < rows.length; i++) h += rows[i].type === "header" ? headerHeight : rowHeight
    return Math.min(h, maxRows * rowHeight)
  }
  readonly property int cardWidth: Math.min(Style.space(720), panel.width - Style.gapsOut * 2)

  // ---------------------------------------------------------------- opening and closing

  // payloadJson may carry a starting query, '{"query": "github"}', or open
  // the settings or the key picker, '{"mode": "settings"}' / '{"mode": "hotkey"}'.
  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") || {} } catch (e) {}
    root.note = ""
    if (root.status !== "ok") root.status = "loading"
    root.lastPointer = Qt.point(-1, -1)
    root.pointerMoved = false
    root.listed = false
    root.userMoved = false
    root.pendingEnter = false
    root.found = null
    root.marks = {}
    root.flash = ""
    root.mode = payload.mode === "settings" || payload.mode === "hotkey" ? payload.mode : "tabs"
    if (root.mode === "hotkey") bindsReader.running = true
    if (!searcher.running) searcher.running = true
    input.text = typeof payload.query === "string" ? payload.query : ""
    root.recompute(true)
    root.refresh()
    root.opened = true
    Qt.callLater(function() { input.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    searchTimer.stop()
    searcher.running = false
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function setMode(next) {
    root.mode = next
    if (next === "hotkey") bindsReader.running = true
    root.userMoved = false
    if (input.text !== "") input.text = ""
    else root.recompute(true)
    Qt.callLater(function() { input.forceActiveFocus() })
  }

  // ---------------------------------------------------------------- the tabs: bin/browser-tab-search list

  function refresh() {
    if (lister.running) { root.relist = true; return }
    lister.running = true
  }

  Process {
    id: lister
    command: [root.tool, "list"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.received(String(text || ""))
    }
    onRunningChanged: {
      if (!running && root.relist) { root.relist = false; running = true }
    }
  }

  function received(text) {
    root.listed = true
    var data = null
    try { data = JSON.parse(text) } catch (e) {}
    if (!data || !Array.isArray(data.tabs)) {
      if (root.status === "loading") { root.status = "error"; root.note = "bin/browser-tab-search gave no answer." }
    } else {
      var counts = {}
      var browsers = data.browsers || []
      for (var i = 0; i < browsers.length; i++) counts[browsers[i].key] = browsers[i].windows || 1
      root.windowCounts = counts
      root.browsers = browsers
      root.icons = Object.assign({}, root.found ? root.found.icons : {}, data.icons || {})
      root.tabs = data.tabs
      root.closed = data.closed || []
      root.dupes = Model.duplicates(data.tabs)
      root.setup = data.setup || null
      if (!(data.status === "none" && root.status === "connected")) root.status = data.status === "ok" ? "ok" : "none"
    }
    root.recompute(false)
    if (root.pendingEnter && root.opened) {
      root.pendingEnter = false
      root.activate(root.selectedIndex)
    }
  }

  // Registers the native messaging host and adds the extension to the
  // browsers' start-up flags (the "Connect" row).
  Process {
    id: connector
    command: [root.tool, "connect"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var reply = null
        try { reply = JSON.parse(String(text || "")) } catch (e) {}
        var flags = reply && reply.ok ? ((root.setup && root.setup.flags) || []).concat(reply.flags || []) : []
        if (reply && reply.ok && flags.length > 0) {
          root.status = "connected"
          root.setup = { manifests: true, flags: flags, running: (root.setup && root.setup.running) || [] }
        } else if (reply && reply.ok) {
          root.status = "error"
          root.note = "No browser flags file found, such as ~/.config/brave-origin-flags.conf."
        } else {
          root.status = "error"
          root.note = (reply && reply.error) || "Could not connect the browser."
        }
        root.recompute(false)
      }
    }
  }

  // Bookmarks and history are searched by one process that lives while the
  // overlay is open; the query goes to it on stdin, never in an argument.
  Process {
    id: searcher
    command: [root.tool, "serve"]
    stdinEnabled: true
    stdout: SplitParser {
      onRead: function(line) {
        var reply = null
        try { reply = JSON.parse(String(line)) } catch (e) { return }
        if (!reply || reply.seq !== root.searchSeq || !root.opened) return
        root.found = { query: root.sentQuery, bookmarks: reply.bookmarks || [], history: reply.history || [], icons: reply.icons || {} }
        root.icons = Object.assign({}, root.icons, reply.icons || {})
        root.recompute(false)
      }
    }
  }

  Timer {
    id: searchTimer
    interval: 120
    onTriggered: {
      var text = Model.searchText(root.query)
      if (!searcher.running || text === "" || root.mode !== "tabs" || (!root.show.bookmarks && !root.show.history)) return
      root.searchSeq += 1
      root.sentQuery = text
      searcher.write(JSON.stringify({ seq: root.searchSeq, query: text }) + "\n")
    }
  }

  // ---------------------------------------------------------------- acting on tabs

  // Closing, muting, pinning, moving: when it is done, the list is read again.
  Process {
    id: actor
    property var args: []
    command: [root.tool].concat(args)
    onRunningChanged: if (!running) root.refresh()
    // A refused change is said, since the next list puts the tab back.
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var reply = null
        try { reply = JSON.parse(String(text || "")) } catch (e) {}
        if (!reply || !reply.ok)
          root.say(root.browsers.some(function(b) { return b.outdated })
            ? "Restart your browser to update Browser Tab Search" : "The browser refused that")
      }
    }
  }

  function run(args) {
    if (actor.running) return false
    actor.args = args
    actor.running = true
    return true
  }

  // Switching, reopening and opening end with the browser in front, so the
  // overlay goes at once and the command finishes on its own.
  function bring(args) {
    Quickshell.execDetached([root.tool].concat(args))
    root.dismiss()
  }

  // What the tab keys act on: the marked tabs, else the selected one.
  function targets() {
    if (root.markCount > 0) return root.tabs.filter(function(t) { return root.marks[Views.markId(t)] })
    var row = root.selectedRow
    return row && !row.type ? [row] : []
  }

  // The change shows at once; the next list says whether it really happened.
  function change(list, action, patch) {
    if (list.length === 0 || actor.running) return false
    var ids = {}
    list.forEach(function(t) { ids[Views.markId(t)] = true })
    if (action === "close") root.tabs = root.tabs.filter(function(t) { return !ids[Views.markId(t)] })
    else root.tabs = root.tabs.map(function(t) { return ids[Views.markId(t)] ? Object.assign({}, t, patch) : t })
    root.dupes = Model.duplicates(root.tabs)
    root.marks = {}
    root.recompute(false)
    root.run(["tabs", action].concat(list.map(Views.markId)))
    return true
  }

  // Ctrl+W: closes the marked tabs and hides the marked recently closed
  // ones, else the selected tab, or hides the selected recently closed one.
  // The browser keeps its own list of closed tabs, which no extension may
  // change, so they are only left out here.
  function closeTargets() {
    var row = root.selectedRow
    var hide = root.markCount > 0
      ? root.closed.filter(function(c) { return root.marks[Views.markId(Object.assign({ type: "closed" }, c))] })
      : row && row.type === "closed" ? [row] : []
    if (hide.length > 0) {
      var next = Object.assign({}, root.hiddenClosed)
      hide.forEach(function(c) { next[c.sessionId] = true })
      root.hiddenClosed = next
    }
    var list = root.targets()
    var closed = list.length > 0 && root.change(list, "close", null)
    if (hide.length > 0 && !closed) { root.marks = {}; root.recompute(false) }
    var said = []
    if (closed && list.length > 1) said.push("Closed " + list.length + " tabs")
    if (hide.length > 0) said.push("Hid " + hide.length + " from Recently closed")
    if (said.length > 0) root.say(said.join(", "))
  }

  // Ctrl+A: marks every tab listed, or unmarks them when all are marked.
  function markAll() {
    if (root.mode !== "tabs") return
    var listed = root.rows.filter(function(r) { return !r.type })
    if (listed.length === 0) return
    var next = Object.assign({}, root.marks)
    var all = listed.every(function(t) { return next[Views.markId(t)] })
    listed.forEach(function(t) { if (all) delete next[Views.markId(t)]; else next[Views.markId(t)] = true })
    root.marks = next
    root.say(all ? "Unmarked" : "Marked " + listed.length + (listed.length === 1 ? " tab" : " tabs"))
  }

  // Tab / Shift+Tab, as in fzf: marks or unmarks the selected row, then moves on.
  function markMove(step) {
    if (root.mode !== "tabs") return
    var row = root.selectedRow
    if (row && (!row.type || row.type === "closed")) {
      var next = Object.assign({}, root.marks)
      if (next[Views.markId(row)]) delete next[Views.markId(row)]
      else next[Views.markId(row)] = true
      root.marks = next
    }
    root.move(step)
  }

  // Ctrl+D: leaves this tab and closes the others showing the same page.
  function closeCopies(row) {
    if (!row || row.type || Model.copies(row, root.dupes) < 2 || actor.running) return
    var page = Model.pageKey(row)
    root.tabs = root.tabs.filter(function(t) { return (t.key === row.key && t.id === row.id) || Model.pageKey(t) !== page })
    root.dupes = Model.duplicates(root.tabs)
    root.recompute(false)
    root.run(["dedupe", String(row.key), String(row.id)])
  }

  function reopenLast() {
    if (root.closed.length > 0) root.bring(["restore", String(root.closed[0].key), String(root.closed[0].sessionId)])
  }

  function toggleMute() {
    var list = root.targets()
    var mute = list.some(function(t) { return !t.muted })
    if (root.change(list, mute ? "mute" : "unmute", { muted: mute })) root.say(mute ? "Muted" : "Unmuted")
  }

  function togglePin() {
    var list = root.targets()
    var pin = list.some(function(t) { return !t.pinned })
    // A tab pinned now goes to the end of the pinned ones, as in the browser.
    if (root.change(list, pin ? "pin" : "unpin", pin ? { pinned: true, index: 100000 } : { pinned: false }))
      root.say(pin ? "Pinned" : "Unpinned")
  }

  // Shift+↑↓: a pinned tab trades places with its pinned neighbour, here at
  // once and in the browser.
  function movePinned(step) {
    var row = root.selectedRow
    if (root.mode !== "tabs" || !row || row.type) return
    if (!row.pinned) { root.say("Only pinned tabs can be moved"); return }
    if (Model.parse(root.query).text.trim() !== "") { root.say("Clear the search to move tabs"); return }
    var other = Model.pinnedNeighbour(root.tabs, row, step)
    if (!other || actor.running) return
    root.tabs = root.tabs.map(function(t) {
      if (t.key === row.key && t.id === row.id) return Object.assign({}, t, { index: other.index })
      if (t.key === other.key && t.id === other.id) return Object.assign({}, t, { index: row.index })
      return t
    })
    root.userMoved = true
    root.recompute(false)
    root.run(["move", row.key, String(row.id), String(step)])
  }

  // ---------------------------------------------------------------- the web: searches and addresses

  // What to open goes to bin/browser-tab-search on stdin, never in an argument. The
  // process outlives the overlay, which goes at once.
  Process {
    id: webber
    property string pending: ""
    property string key: ""
    command: [root.tool, "web", key]
    stdinEnabled: true
    onStarted: {
      write(webber.pending)
      webber.pending = ""
      stdinEnabled = false
    }
  }

  function openWeb(row) {
    if (webber.running) return
    // A browser started before site searches and addresses existed would
    // turn them into a plain web search, so it is told to restart instead.
    var browser = root.browsers.filter(function(b) { return b.key === row.key })[0]
    if ((row.site || row.type === "open") && browser && browser.outdated) {
      root.say(browser.name + " runs an older Browser Tab Search. Quit it completely, including its web apps, and start it again")
      return
    }
    webber.key = String(row.key)
    webber.pending = JSON.stringify(row.type === "open" ? { address: String(row.url) }
      : { query: String(row.query), url: row.site ? row.site.url : "" })
    webber.stdinEnabled = true
    webber.running = true
    root.dismiss()
  }

  // The address goes to wl-copy on stdin, never in an argument.
  Process {
    id: copier
    property string pending: ""
    command: ["wl-copy", "--type", "text/plain"]
    stdinEnabled: true
    onStarted: {
      write(copier.pending)
      copier.pending = ""
      stdinEnabled = false
    }
  }

  function copyAddress() {
    var row = root.selectedRow
    if (!row || !row.url || copier.running) return
    copier.pending = row.url
    copier.stdinEnabled = true
    copier.running = true
    root.say("Address copied")
  }

  // ---------------------------------------------------------------- settings

  // Read here and by Service.qml; written only through bin/browser-tab-search
  // save-config, which keeps it 0600 and replaces it in one step.
  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.readConfig(text())
    onLoadFailed: root.readConfig("")
    onFileChanged: reload()
  }

  function readConfig(text) {
    var raw = String(text || "").trim()
    var c = {}
    var broken = false
    if (raw !== "") {
      try { c = JSON.parse(raw) } catch (e) { broken = true }
      if (!c || typeof c !== "object" || Array.isArray(c)) { c = {}; broken = true }
    }
    root.config = c
    root.configBroken = broken
    root.recompute(false)
  }

  Process {
    id: configWriter
    property string pending: ""
    command: [root.tool, "save-config"]
    stdinEnabled: true
    onStarted: {
      write(configWriter.pending)
      configWriter.pending = ""
      stdinEnabled = false
    }
    onExited: function(code) { if (code !== 0) root.say("Could not save the settings") }
  }

  // Merges `patch` into the config and saves it. The file is read back by
  // configFile once written; until then, the new values are used here.
  function saveConfig(patch) {
    if (root.configBroken) { root.say("Settings file is not valid JSON: ~/.config/omarchy/extensions/browser-tab-search.json"); return false }
    if (configWriter.running) { root.say("Still saving, try again"); return false }
    root.config = Object.assign({}, root.config, patch)
    configWriter.pending = JSON.stringify(root.config, null, 2) + "\n"
    configWriter.stdinEnabled = true
    configWriter.running = true
    return true
  }

  function toggleShown(id) {
    var next = Object.assign({}, root.show)
    next[id] = !next[id]
    root.userMoved = true
    if (root.saveConfig({ show: next })) root.recompute(false)
  }

  function openEditor(index) {
    root.editIndex = index
    root.mode = "edit"
    root.rows = []
    form.load(index >= 0 ? root.sites[index] : { key: "", name: "", url: "" })
  }

  function leaveEditor(selectKey) {
    root.setMode("settings")
    for (var i = 0; selectKey && i < root.rows.length; i++)
      if (root.rows[i].type === "site" && root.rows[i].key === selectKey) root.selectedIndex = i
  }

  function saveEdit() {
    var entry = form.values()
    var problem = Model.searchProblem(entry, root.sites, root.editIndex)
    if (problem === "" && root.editIndex < 0 && root.sites.length >= Model.MAX_SEARCHES) problem = "You can have up to " + Model.MAX_SEARCHES + " searches."
    if (problem !== "") { form.problem = problem; return }
    var list = root.sites.slice()
    if (root.editIndex >= 0) list[root.editIndex] = entry
    else list.push(entry)
    if (!root.saveConfig({ searches: list })) return
    root.leaveEditor(entry.key)
    root.say("Saved ?" + entry.key)
  }

  // Ctrl+W twice removes a search, in the list or in its editor.
  function removeSite(key) {
    if (!key) return
    if (root.doomed !== "?" + key) {
      root.doomed = "?" + key
      root.say("Press Ctrl+W again to remove ?" + key)
      return
    }
    root.doomed = ""
    if (!root.saveConfig({ searches: root.sites.filter(function(s) { return s.key !== key }) })) return
    if (root.mode === "edit") root.leaveEditor("")
    else root.recompute(false)
    root.say("Removed ?" + key)
  }

  // Enter twice puts back the default searches.
  function resetSites() {
    if (root.doomed !== "reset") {
      root.doomed = "reset"
      root.say("Press Enter again to restore the defaults")
      return
    }
    root.doomed = ""
    if (root.saveConfig({ searches: Model.searches(null) })) {
      root.recompute(true)
      root.say("Default searches restored")
    }
  }

  // The key picker: free keys first, the typed combination at the top.
  Process {
    id: bindsReader
    command: ["hyprctl", "binds", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.bindsJson = String(text || "")
        if (root.mode === "hotkey") root.recompute(false)
      }
    }
  }

  // Service.qml sees the file change and binds the new key.
  function useHotkey(row) {
    if (row.off) { root.say(row.title + " is taken, pick a free one"); return }
    if (!root.saveConfig({ hotkey: row.title })) return
    root.setMode("settings")
    root.say(row.title + " opens Browser Tab Search")
  }

  // ---------------------------------------------------------------- the list

  // fresh: start at the top (a new query or a new opening); otherwise keep
  // the selected row selected while the list underneath it changes.
  function recompute(fresh) {
    var was = root.selectedRow
    var next
    if (root.mode === "hotkey") next = Views.hotkeyRows(Hotkey.choices(root.bindsJson, root.query), root.hotkey)
    else if (root.mode === "settings") next = Views.settingsRows({ query: root.query, hotkey: root.hotkey, show: root.show, sites: root.sites })
    else if (root.mode === "edit") next = []
    else if (root.mode === "keys") next = Views.keyRows(root.query)
    else next = Model.sections(root.tabs, root.closed.filter(function(c) { return !root.hiddenClosed[c.sessionId] }),
                               root.found, root.query, root.dupes, root.sites, root.show)
    if (next.length === 0 && root.mode === "tabs" && root.status === "none" && root.canConnect && root.query.trim() === "")
      next = [{ type: "connect", title: "Connect " + root.browserNames + " to Browser Tab Search", url: "" }]
    root.rows = next
    var index = Model.firstIndex(next, root.query)
    // Kept on the same row only when it was picked by hand; otherwise the
    // fresh list decides, so the previous tab is the one selected.
    if (!fresh && was && was.type !== "header" && root.userMoved) {
      var same = -1
      for (var i = 0; i < next.length && same < 0; i++) if (Views.sameRow(next[i], was)) same = i
      index = same >= 0 ? same : Model.nextSelectable(next, Math.min(root.selectedIndex, Math.max(0, next.length - 1)), -1)
      if (index < 0) index = Model.firstIndex(next, root.query)
    }
    root.selectedIndex = index
    root.reveal(index, fresh)
  }

  function heightOf(row) { return row && row.type === "header" ? root.headerHeight : root.rowHeight }

  // Scrolls the list so the selected row shows, with the heading above it
  // when it is the first row under one. A fresh list starts at the top.
  // Every row's place is known from the heights, so nothing is guessed.
  function reveal(index, fresh) {
    var top = 0
    for (var i = 0; i < index; i++) top += root.heightOf(root.rows[i])
    var bottom = top + root.heightOf(root.rows[index])
    if (index > 0 && root.rows[index - 1].type === "header") top -= root.headerHeight
    var y = fresh ? 0 : list.contentY
    if (top < y) y = top
    if (bottom > y + root.listHeight) y = bottom - root.listHeight
    var total = 0
    for (var j = 0; j < root.rows.length; j++) total += root.heightOf(root.rows[j])
    list.contentY = Math.max(0, Math.min(y, total - root.listHeight))
  }

  // Headings are stepped over.
  function move(step) {
    if (root.rows.length === 0) return
    root.userMoved = true
    var to = Math.max(0, Math.min(root.rows.length - 1, root.selectedIndex + step))
    var dir = step > 0 ? 1 : -1
    var land = Model.nextSelectable(root.rows, to, dir)
    if (land < 0) land = Model.nextSelectable(root.rows, to, -dir)
    if (land >= 0) root.selectedIndex = land
    root.reveal(root.selectedIndex, false)
  }

  function activate(index) {
    var row = root.rows[index]
    if (!row) return
    if (!root.listed && !row.type) { root.pendingEnter = true; return }
    switch (row.type || "") {
    case "": root.bring(["activate", String(row.key), String(row.id)]); break
    case "connect": if (!connector.running) connector.running = true; break
    case "closed": root.bring(["restore", String(row.key), String(row.sessionId)]); break
    case "bookmark": case "history": root.bring(["open", String(row.key), String(row.token)]); break
    case "web": case "open": root.openWeb(row); break
    case "site": root.openEditor(row.index); break
    case "add": root.openEditor(-1); break
    case "reset": root.resetSites(); break
    case "toggle": root.toggleShown(row.id); break
    case "keyset": root.setMode("hotkey"); break
    case "hotkey": root.useHotkey(row); break
    }
  }

  // A row reports where the pointer is; it takes the selection only once
  // the pointer moved a few pixels from where it rested on opening.
  function pointerAt(x, y, index) {
    if (root.lastPointer.x < 0) { root.lastPointer = Qt.point(x, y); return }
    if (!root.pointerMoved && Math.abs(x - root.lastPointer.x) + Math.abs(y - root.lastPointer.y) < 6) return
    root.pointerMoved = true
    if (root.selectedIndex !== index) {
      root.userMoved = true
      root.selectedIndex = index
    }
  }

  function clickRow(index) {
    input.forceActiveFocus()
    root.userMoved = true
    root.selectedIndex = index
    root.activate(index)
  }

  // ---------------------------------------------------------------- keys and paste

  function say(text) {
    root.flash = text
    flashTimer.restart()
  }

  Timer {
    id: flashTimer
    interval: 2600
    onTriggered: { root.flash = ""; root.doomed = "" }
  }

  function onKey(event) {
    var ctrl = event.modifiers & Qt.ControlModifier
    var shift = event.modifiers & Qt.ShiftModifier
    var key = event.key
    var row = root.selectedRow
    if (event.matches(StandardKey.Paste)) root.pasteInto(input)
    else if (key === Qt.Key_Escape) {
      if (root.mode === "hotkey") root.setMode("settings")
      else if (root.mode !== "tabs") root.setMode("tabs")
      else if (root.markCount > 0) root.marks = {}
      else if (input.text) input.text = ""
      else root.dismiss()
    }
    else if (key === Qt.Key_Return || key === Qt.Key_Enter) root.activate(root.selectedIndex)
    else if (key === Qt.Key_Tab || key === Qt.Key_Backtab) root.markMove(key === Qt.Key_Tab ? 1 : -1)
    else if (shift && !ctrl && (key === Qt.Key_Up || key === Qt.Key_Down)) root.movePinned(key === Qt.Key_Down ? 1 : -1)
    else if (key === Qt.Key_Down || (ctrl && (key === Qt.Key_N || key === Qt.Key_J))) root.move(1)
    else if (key === Qt.Key_Up || (ctrl && !shift && (key === Qt.Key_P || key === Qt.Key_K))) root.move(-1)
    else if (key === Qt.Key_PageDown) root.move(root.maxRows - 1)
    else if (key === Qt.Key_PageUp) root.move(1 - root.maxRows)
    else if (ctrl && key === Qt.Key_Comma) root.setMode(root.mode === "settings" ? "tabs" : "settings")
    else if (ctrl && (key === Qt.Key_Slash || key === Qt.Key_Question)) root.setMode(root.mode === "keys" ? "tabs" : "keys")
    else if (ctrl && key === Qt.Key_W) {
      if (root.mode === "settings") root.removeSite(row && row.type === "site" ? row.key : "")
      else if (root.mode === "tabs") root.closeTargets()
    }
    else if (ctrl && shift && key === Qt.Key_P) root.togglePin()
    else if (ctrl && shift && key === Qt.Key_T) root.reopenLast()
    else if (ctrl && key === Qt.Key_A) root.markAll()
    else if (ctrl && key === Qt.Key_M) root.toggleMute()
    else if (ctrl && key === Qt.Key_D) root.closeCopies(row)
    else if (ctrl && key === Qt.Key_C && input.selectedText === "") root.copyAddress()
    else return
    event.accepted = true
  }

  // The clipboard is read only when asked to paste, and only its start.
  property var pasteTarget: null

  function pasteInto(field) {
    root.pasteTarget = field
    if (!paster.running) paster.running = true
  }

  Process {
    id: paster
    command: ["sh", "-c", "timeout 2 wl-paste --no-newline 2>/dev/null | head -c 1024"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var field = root.pasteTarget || input
        if (!root.opened || !field.activeFocus) return
        var line = String(text || "").split(/[\r\n]/)[0].replace(/\t/g, " ")
        field.remove(field.selectionStart, field.selectionEnd)
        var room = field.limit - field.text.length
        if (room > 0 && line) field.insert(field.cursorPosition, line.substring(0, room))
      }
    }
  }

  // ---------------------------------------------------------------- the window

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omarchy-browser-tab-search"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: contentTopInset + contentBottomInset + layout.implicitHeight
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      y: Math.round(panel.height * 0.2)
      color: root.background
      borderSpec: root.borderSpec
      padding: Style.spacing.panelPadding

      MouseArea { anchors.fill: parent; onClicked: if (root.mode !== "edit") input.forceActiveFocus() }

      Column {
        id: layout
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: card.contentTopInset
        anchors.leftMargin: card.contentLeftInset
        anchors.rightMargin: card.contentRightInset
        spacing: Style.spacing.md

        // ---------- the search field ----------
        Item {
          width: parent.width
          height: root.inputHeight
          visible: root.mode !== "edit"

          Text {
            id: glyph
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            text: root.mode === "settings" || root.mode === "hotkey" ? "󰒓" : "󰓩"
            color: root.foreground
            opacity: 0.6
            font.family: root.fontFamily
            font.pixelSize: root.inputFont
          }

          // A TextEdit, not a TextInput: those read the clipboard every time
          // it changes, to know whether pasting is possible.
          TextEdit {
            id: input
            anchors.left: glyph.right
            anchors.leftMargin: Style.space(10)
            anchors.right: tally.left
            anchors.rightMargin: Style.spacing.md
            anchors.verticalCenter: parent.verticalCenter
            textFormat: TextEdit.PlainText
            wrapMode: TextEdit.NoWrap
            color: root.foreground
            selectionColor: root.selectedBackground
            selectedTextColor: root.selectedText
            font.family: root.fontFamily
            font.pixelSize: root.inputFont
            clip: true
            focus: true

            // One line of at most 200 characters; an edit that breaks either is taken back.
            readonly property int limit: 200
            property string kept: ""
            onTextChanged: {
              var line = text.replace(/[\n\r\t]/g, "")
              if (line.length > limit) line = kept
              if (line !== text) {
                var at = cursorPosition
                text = line
                cursorPosition = Math.min(at, line.length)
                return
              }
              kept = line
              root.query = line
              root.recompute(true)
              if (line.trim() !== "") searchTimer.restart()
              else { searchTimer.stop(); root.found = null }
            }

            Text {
              textFormat: Text.PlainText
              anchors.fill: parent
              verticalAlignment: Text.AlignVCenter
              visible: !input.text
              text: Views.placeholder(root.mode)
              elide: Text.ElideRight
              color: root.foreground
              opacity: 0.4
              font: input.font
            }

            // No pasting the primary selection with the middle button.
            MouseArea {
              anchors.fill: parent
              acceptedButtons: Qt.MiddleButton
            }

            Keys.priority: Keys.BeforeItem
            Keys.onPressed: function(event) { root.onKey(event) }
          }

          // The gear opens the settings, as in mani4.instant-snippets; Ctrl+, too.
          Text {
            id: gear
            textFormat: Text.PlainText
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            text: "󰒓"
            color: root.foreground
            opacity: root.mode === "settings" || gearHover.hovered ? 0.9 : 0.4
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            HoverHandler { id: gearHover; cursorShape: Qt.PointingHandCursor }
            TapHandler { onTapped: root.setMode(root.mode === "settings" ? "tabs" : "settings") }
          }

          Text {
            id: tally
            textFormat: Text.PlainText
            anchors.right: gear.left
            anchors.rightMargin: Style.spacing.lg
            anchors.verticalCenter: parent.verticalCenter
            visible: root.tabs.length > 0 && root.mode === "tabs"
            readonly property int shown: root.rows.filter(function(r) { return !r.type }).length
            text: root.query.trim() ? shown + " of " + root.tabs.length + " tabs" : root.tabs.length + (root.tabs.length === 1 ? " tab" : " tabs")
            color: root.foreground
            opacity: 0.4
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Rectangle {
          width: parent.width
          height: 1
          visible: root.mode !== "edit"
          color: Util.alpha(root.foreground, 0.1)
        }

        // ---------- the rows ----------
        // A plain column rather than a ListView: rows differ in height, and
        // a ListView only guesses where the ones it has not drawn yet are.
        Flickable {
          id: list
          width: parent.width
          height: root.listHeight
          visible: root.rows.length > 0
          contentHeight: rowColumn.height
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          Column {
            id: rowColumn
            width: list.width
            Repeater {
              model: root.rows
              TabRow {
                view: root
                width: rowColumn.width
                onClicked: function(index) { root.clickRow(index) }
              }
            }
          }
        }

        // ---------- one search, being edited ----------
        SearchForm {
          id: form
          view: root
          width: parent.width
          visible: root.mode === "edit"
          editing: root.editIndex >= 0
          onSubmitted: root.saveEdit()
          onCancelled: root.leaveEditor("")
          onRemoveAsked: if (root.editIndex >= 0) root.removeSite(root.sites[root.editIndex].key)
        }

        // ---------- nothing to list ----------
        Text {
          textFormat: Text.PlainText
          width: parent.width
          height: root.rowHeight * 1.6
          visible: root.message !== ""
          horizontalAlignment: Text.AlignHCenter
          verticalAlignment: Text.AlignVCenter
          wrapMode: Text.WordWrap
          text: root.message
          color: root.foreground
          opacity: 0.55
          font.family: root.fontFamily
          font.pixelSize: Style.font.subtitle
        }

        // ---------- what the keys do ----------
        Footer {
          view: root
          width: parent.width
          visible: root.rows.length > 0 || root.flash !== "" || root.mode === "edit"
          note: root.flash
          marks: root.markCount
          hints: Views.hints({ mode: root.mode, row: root.selectedRow, marks: root.markCount, editing: root.editIndex,
                               copies: root.selectedRow && !root.selectedRow.type ? Model.copies(root.selectedRow, root.dupes) : 0 })
          keysHint: root.mode === "tabs" && root.markCount === 0
          escText: Views.escLabel(root.mode, root.markCount, input.text !== "")
        }
      }
    }
  }
}
