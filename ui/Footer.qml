import QtQuick
import qs.Commons
import "../Views.js" as Views

// The line under the list: what the keys do for the selected row, or for a
// moment what just happened. Part of Browser Tab Search (mani4.browser-tab-search).
Item {
  id: footer
  required property var view
  // [{ key, text }] for the left side, from Views.hints().
  property var hints: []
  property string note: ""          // replaces the hints for a moment
  property int marks: 0
  property bool keysHint: false     // "ctrl / Keys" on the right
  property string escText: "Close"

  height: Math.max(Style.space(30), Style.font.caption + Style.spacing.md * 2)

  Rectangle {
    anchors.top: parent.top
    width: parent.width
    height: 1
    color: Util.alpha(footer.view.foreground, 0.1)
  }

  Text {
    textFormat: Text.PlainText
    anchors.left: parent.left
    anchors.leftMargin: Style.space(4)
    anchors.bottom: parent.bottom
    visible: footer.note !== ""
    text: footer.note
    color: footer.view.foreground
    opacity: 0.75
    font.family: footer.view.fontFamily
    font.pixelSize: Style.font.caption
  }

  Row {
    anchors.left: parent.left
    anchors.leftMargin: Style.space(4)
    anchors.bottom: parent.bottom
    spacing: Style.spacing.xxl
    visible: footer.note === ""

    Text {
      textFormat: Text.PlainText
      anchors.verticalCenter: parent.verticalCenter
      visible: footer.marks > 0
      text: footer.marks + " marked"
      color: footer.view.foreground
      opacity: 0.75
      font.family: footer.view.fontFamily
      font.pixelSize: Style.font.caption
    }

    Repeater {
      model: footer.hints
      Hint {
        required property var modelData
        view: footer.view
        keyLabel: modelData.key
        text: modelData.text
      }
    }
  }

  Row {
    anchors.right: parent.right
    anchors.rightMargin: Style.space(4)
    anchors.bottom: parent.bottom
    spacing: Style.spacing.xxl

    Hint { view: footer.view; keyLabel: "ctrl /"; text: "Keys"; visible: footer.keysHint }
    Hint { view: footer.view; keyLabel: "esc"; text: footer.escText }
  }
}
