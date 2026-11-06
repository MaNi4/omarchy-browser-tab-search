import QtQuick
import qs.Commons

// A key as a small box, in the key list, the footer and the settings.
// Part of Browser Tab Search (mani4.browser-tab-search).
Rectangle {
  id: cap
  required property var view
  property string label: ""
  property color tint: view.foreground

  implicitWidth: Math.max(implicitHeight, capText.implicitWidth + Style.space(10))
  implicitHeight: capText.implicitHeight + Style.space(4)
  radius: view.cornerRadius > 0 ? Style.space(4) : 0
  color: Util.alpha(cap.tint, 0.08)
  border.width: 1
  border.color: Util.alpha(cap.tint, 0.18)

  Text {
    id: capText
    textFormat: Text.PlainText
    anchors.centerIn: parent
    text: cap.label
    color: cap.tint
    opacity: 0.8
    font.family: cap.view.fontFamily
    font.pixelSize: Style.font.caption
  }
}
