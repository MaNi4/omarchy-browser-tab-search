import QtQuick
import qs.Commons

// A key and what it does, in the footer. Part of Browser Tab Search (mani4.browser-tab-search).
Row {
  id: hint
  required property var view
  property string keyLabel: ""
  property string text: ""
  spacing: Style.space(5)

  Keycap { view: hint.view; label: hint.keyLabel; anchors.verticalCenter: parent.verticalCenter }

  Text {
    textFormat: Text.PlainText
    anchors.verticalCenter: parent.verticalCenter
    text: hint.text
    color: hint.view.foreground
    opacity: 0.5
    font.family: hint.view.fontFamily
    font.pixelSize: Style.font.caption
  }
}
