import QtQuick
import qs.Commons

// One line of the search editor (SearchForm.qml). A TextEdit rather than a
// TextInput: those read the clipboard every time it changes, to know
// whether pasting is possible. Pasting goes through the overlay, which
// reads only the start of the clipboard, and only when asked.
// Part of Browser Tab Search (mani4.browser-tab-search).
Rectangle {
  id: field
  required property var view
  property alias text: edit.text
  property alias input: edit
  property string placeholderText: ""
  property int limit: 64

  signal edited()
  signal tabbed(int step)
  signal submitted()
  signal cancelled()
  signal removeAsked()

  function focusInput() { edit.forceActiveFocus(); edit.cursorPosition = edit.text.length }

  implicitHeight: edit.implicitHeight + Style.spacing.controlPaddingY * 2
  radius: view.cornerRadius > 0 ? Style.space(4) : 0
  color: Util.alpha(view.foreground, edit.activeFocus ? 0.08 : 0.04)
  border.width: 1
  border.color: Util.alpha(view.foreground, edit.activeFocus ? 0.45 : 0.15)

  TextEdit {
    id: edit
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    anchors.leftMargin: Style.spacing.md
    anchors.rightMargin: Style.spacing.md
    textFormat: TextEdit.PlainText
    wrapMode: TextEdit.NoWrap
    clip: true
    color: field.view.foreground
    selectionColor: field.view.selectedBackground
    selectedTextColor: field.view.selectedText
    font.family: field.view.fontFamily
    font.pixelSize: Style.font.subtitle

    // One line, no longer than the limit; an edit that breaks either is taken back.
    readonly property int limit: field.limit
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
      field.edited()
    }

    Keys.priority: Keys.BeforeItem
    Keys.onPressed: function(event) {
      if (event.matches(StandardKey.Paste)) field.view.pasteInto(edit)
      else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) field.submitted()
      else if (event.key === Qt.Key_Escape) field.cancelled()
      else if ((event.modifiers & Qt.ControlModifier) && event.key === Qt.Key_W) field.removeAsked()
      else if (event.key === Qt.Key_Tab) field.tabbed(1)
      else if (event.key === Qt.Key_Backtab) field.tabbed(-1)
      else return
      event.accepted = true
    }

    // No pasting the primary selection with the middle button.
    MouseArea { anchors.fill: parent; acceptedButtons: Qt.MiddleButton }

    Text {
      textFormat: Text.PlainText
      anchors.fill: parent
      verticalAlignment: Text.AlignVCenter
      visible: !edit.text
      text: field.placeholderText
      elide: Text.ElideRight
      color: field.view.foreground
      opacity: 0.35
      font: edit.font
    }
  }
}
