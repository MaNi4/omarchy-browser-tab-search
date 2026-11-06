import QtQuick
import qs.Commons

// The editor of one search (Settings › Searches): its shortcut, name and
// address with %s. Tab steps through the fields, Enter saves, Esc gives up,
// Ctrl+W twice removes. The overlay (BrowserTabSearch.qml) checks and saves.
// Part of Browser Tab Search (mani4.browser-tab-search).
Column {
  id: form
  required property var view
  property bool editing: false      // an existing search, rather than a new one
  property string problem: ""       // what is wrong with what was typed

  signal submitted()
  signal cancelled()
  signal removeAsked()

  spacing: Style.spacing.sm

  readonly property var fields: [keyField, nameField, urlField]

  function load(entry) {
    keyField.text = entry.key
    nameField.text = entry.name
    urlField.text = entry.url
    form.problem = ""
    Qt.callLater(function() { keyField.focusInput() })
  }

  function values() {
    return { key: keyField.text.trim().toLowerCase(), name: nameField.text.trim(), url: urlField.text.trim() }
  }

  function step(from, by) {
    var i = form.fields.indexOf(from)
    form.fields[(i + by + form.fields.length) % form.fields.length].focusInput()
  }

  component Caption: Text {
    width: parent ? parent.width : 0
    textFormat: Text.PlainText
    color: form.view.foreground
    opacity: 0.55
    font.family: form.view.fontFamily
    font.pixelSize: Style.font.caption
  }

  component Field: FormField {
    id: f
    view: form.view
    width: form.width
    onEdited: form.problem = ""
    onTabbed: function(by) { form.step(f, by) }
    onSubmitted: form.submitted()
    onCancelled: form.cancelled()
    onRemoveAsked: form.removeAsked()
  }

  Caption {
    text: form.editing ? "EDIT SEARCH" : "NEW SEARCH"
    font.letterSpacing: 1
  }

  Caption { text: "Shortcut (you type it after ?)" }
  Field { id: keyField; limit: 6; placeholderText: "so" }

  Caption { text: "Name" }
  Field { id: nameField; limit: 40; placeholderText: "Stack Overflow" }

  Caption { text: "Search URL (%s marks the search words)" }
  Field { id: urlField; limit: 500; placeholderText: "https://stackoverflow.com/search?q=%s" }

  Caption {
    wrapMode: Text.WordWrap
    text: form.problem !== "" ? form.problem : "Tip: search something on the site, copy the URL and replace your search words with %s."
    color: form.problem !== "" ? Color.urgent : form.view.foreground
    opacity: form.problem !== "" ? 1 : 0.5
  }
}
