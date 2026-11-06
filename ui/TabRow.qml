import QtQuick
import qs.Commons
import "../Views.js" as Views

// One row of the list: a tab, a recently closed tab, a bookmark, a search,
// a setting, or a heading above a group of them. What it shows comes from
// Views.js; picking it is the overlay's (BrowserTabSearch.qml).
// Part of Browser Tab Search (mani4.browser-tab-search).
Item {
  id: row
  required property var view
  required property int index
  required property var modelData

  signal clicked(int index)

  readonly property bool selected: index === view.selectedIndex
  readonly property string kind: modelData.type || "tab"
  readonly property bool header: kind === "header"
  readonly property bool current: kind === "tab" && !!modelData.active && !!modelData.focusedWindow
  readonly property bool marked: (kind === "tab" || kind === "closed") && !!view.marks[Views.markId(modelData)]
  readonly property color ink: selected ? view.selectedText : view.foreground
  readonly property string icon: kind === "connect" || header ? "" : (view.icons[modelData.origin] || "")
  readonly property var badges: Views.badges(modelData, view.badgeContext)

  height: header ? view.headerHeight : view.rowHeight
  clip: header

  // A section heading covers the row it is drawn as.
  Rectangle {
    z: 2
    anchors.fill: parent
    visible: row.header
    color: row.view.background

    Text {
      textFormat: Text.PlainText
      anchors.left: parent.left
      anchors.leftMargin: Style.spacing.md
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.space(3)
      text: row.header ? row.modelData.title : ""
      color: row.view.foreground
      opacity: 0.45
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Rectangle {
    anchors.fill: parent
    radius: row.view.cornerRadius > 0 ? Style.space(6) : 0
    color: row.selected ? row.view.selectedBackground : row.marked ? Util.alpha(row.view.foreground, 0.08) : "transparent"
  }

  // A marked row carries a bar on its left edge.
  Rectangle {
    visible: row.marked
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(3)
    height: parent.height - Style.space(10)
    radius: width / 2
    color: row.ink
  }

  Item {
    id: iconBox
    anchors.left: parent.left
    anchors.leftMargin: Style.spacing.md
    anchors.verticalCenter: parent.verticalCenter
    width: Math.round(Style.font.subtitle * 1.3)
    height: width

    Image {
      anchors.fill: parent
      visible: row.icon !== "" && status === Image.Ready
      source: row.icon
      sourceSize.width: 64
      sourceSize.height: 64
      fillMode: Image.PreserveAspectFit
      smooth: true
      asynchronous: true
    }

    Text {
      textFormat: Text.PlainText
      anchors.centerIn: parent
      visible: row.icon === ""
      text: Views.glyph(row.modelData)
      color: row.ink
      opacity: 0.6
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.subtitle
    }
  }

  Column {
    anchors.left: iconBox.right
    anchors.leftMargin: Style.spacing.md
    anchors.right: trailing.left
    anchors.rightMargin: Style.spacing.lg
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(1)

    Text {
      textFormat: Text.PlainText
      width: parent.width
      text: row.modelData.title || row.modelData.url || "Untitled"
      color: row.ink
      opacity: row.modelData.asleep && !row.selected ? 0.75 : 1
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.subtitle
      elide: Text.ElideRight
    }

    Text {
      textFormat: Text.PlainText
      width: parent.width
      visible: text !== ""
      text: row.header ? "" : Views.subtitle(row.modelData)
      color: row.ink
      opacity: 0.5
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.caption
      elide: Text.ElideRight
    }
  }

  Row {
    id: trailing
    anchors.right: parent.right
    anchors.rightMargin: Style.spacing.lg
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(8)

    Repeater {
      model: row.modelData.keys || []
      Keycap {
        required property string modelData
        view: row.view
        anchors.verticalCenter: parent.verticalCenter
        label: modelData
        tint: row.ink
      }
    }

    Repeater {
      model: row.badges
      Text {
        required property string modelData
        textFormat: Text.PlainText
        anchors.verticalCenter: parent.verticalCenter
        text: modelData
        color: row.ink
        opacity: 0.45
        font.family: row.view.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Text {
      textFormat: Text.PlainText
      anchors.verticalCenter: parent.verticalCenter
      visible: text !== ""
      text: row.header ? "" : Views.stateGlyphs(row.modelData)
      color: row.ink
      opacity: 0.7
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.subtitle
    }

    Text {
      textFormat: Text.PlainText
      anchors.verticalCenter: parent.verticalCenter
      visible: row.current
      text: "current"
      color: row.ink
      opacity: 0.45
      font.family: row.view.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  MouseArea {
    anchors.fill: parent
    enabled: !row.header
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onPositionChanged: function(mouse) {
      var p = mapToItem(null, mouse.x, mouse.y)
      row.view.pointerAt(p.x, p.y, row.index)
    }
    onClicked: row.clicked(row.index)
  }
}
