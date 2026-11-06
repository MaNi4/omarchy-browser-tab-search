import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "Hotkey.js" as Hotkey

// Binds the key that opens Browser Tab Search (BrowserTabSearch.qml). A service is mounted
// with the shell, so the key works before the overlay has ever been opened.
Item {
  id: service
  visible: false

  readonly property string command: "omarchy-shell shell toggle mani4.browser-tab-search '{}'"
  readonly property string configPath: Quickshell.env("HOME") + "/.config/omarchy/extensions/browser-tab-search.json"
  readonly property string defaultHotkey: Hotkey.DEFAULT_HOTKEY

  // Set "hotkey" to "" in the config to bind nothing.
  property string hotkey: defaultHotkey
  property string boundHotkey: ""     // what we bound, so unloading can unbind it
  property string warnedConflict: ""  // notify once per key, not on every reload
  property bool queued: false

  function applyConfig(text) {
    var next = service.defaultHotkey
    try {
      var config = JSON.parse(text)
      if (config && typeof config.hotkey === "string") next = config.hotkey.trim()
    } catch (e) {
      if (text) console.warn("browser-tab-search: bad " + service.configPath + ": " + e)
    }
    service.hotkey = next
    startTimer.restart()
  }

  FileView {
    path: service.configPath
    watchChanges: true
    printErrors: false
    onLoaded: service.applyConfig(text())
    onLoadFailed: service.applyConfig("")
    onFileChanged: reload()
  }

  // The short delay lets a previous instance's unbind land first when the
  // plugin is reloaded.
  Timer {
    id: startTimer
    interval: 600
    onTriggered: service.ensureHotkey()
  }

  function ensureHotkey() {
    if (bindsProc.running) { service.queued = true; return }
    bindsProc.running = true
  }

  // The overlay appears at once, like Omarchy's own menus.
  function ruleOutAnimation() {
    Quickshell.execDetached(["hyprctl", "eval",
      'hl.layer_rule({ match = { namespace = "^omarchy-browser-tab-search$" }, no_anim = true, animation = "none" })'])
  }

  Component.onCompleted: service.ruleOutAnimation()

  function escapeMarkup(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function reconcile(bindsJson) {
    var plan = Hotkey.plan(bindsJson, service.hotkey, service.command)
    if (plan.lua.length > 0) Quickshell.execDetached(["hyprctl", "eval", plan.lua.join("\n")])
    service.boundHotkey = plan.bound ? service.hotkey : ""
    if (plan.conflict && service.warnedConflict !== service.hotkey) {
      service.warnedConflict = service.hotkey
      // The body of a notification is markup; what another binding is
      // called comes from elsewhere, so it is escaped.
      conflictNote.taken = service.escapeMarkup(service.hotkey + " is already used by \"" + plan.conflict + "\".")
      conflictNote.running = true
    }
    if (service.queued) { service.queued = false; service.ensureHotkey() }
  }

  // Clicking the notification opens Browser Tab Search on a list of free keys, as
  // in mani4.search-menu-items.
  Process {
    id: conflictNote
    property string taken: ""
    command: ["notify-send", "-a", "Browser Tab Search", "-A", "default=Choose a key", "--",
      "Browser Tab Search shortcut is taken", taken + " Click to choose another one."]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (String(text || "").trim() === "default")
          Quickshell.execDetached(["omarchy-shell", "shell", "summon", "mani4.browser-tab-search", '{"mode": "hotkey"}'])
      }
    }
  }

  Process {
    id: bindsProc
    command: ["hyprctl", "binds", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: service.reconcile(String(text || ""))
    }
  }

  // Hyprland drops runtime binds and rules when its config reloads.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event || String(event.name) !== "configreloaded") return
      service.ruleOutAnimation()
      service.ensureHotkey()
    }
  }

  // Disabling, removing or reloading the plugin takes the binding with it.
  Component.onDestruction: {
    var combo = Hotkey.parse(service.boundHotkey)
    if (combo) Quickshell.execDetached(["hyprctl", "eval", Hotkey.unbind(combo.mask, combo.key)])
  }
}
