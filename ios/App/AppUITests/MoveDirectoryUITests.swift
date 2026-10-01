import XCTest

/// Browse's folder and database rows carry a "Move to…" row in their
/// long-press sheet (1.11.0). Before it, a phone could rename or delete a
/// folder but not re-parent it: the only routes were the desktop sidebar's
/// drag and its context menu, neither of which exists on the phone. The row
/// runs core 2.53.0's requestMoveBrowseDirectory, the same store action as
/// desktop's sidebar drag, so the leaf name (and a database's .base suffix)
/// is kept and open tabs, icons, favorites and manual order travel along.
///
/// The test builds its own fixture in the drawer — two root folders with a
/// unique suffix, created through "New folder" — so it never depends on what
/// the simulator's vault holds, moves one into the other through the sheet
/// and the core's Move prompt, checks the root listing lost the row and the
/// destination gained it, then deletes the destination (and the moved folder
/// inside it) through the same sheet.
final class MoveDirectoryUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLongPressSheetMovesFolderIntoAnotherFolder() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        guard app.windows.firstMatch.frame.width < 768 else {
            throw XCTSkip("phone shell only: the iPad runs the desktop layout with the sidebar's drag and context menu")
        }

        let suffix = String(Int(Date().timeIntervalSince1970) % 1_000_000)
        let source = "MoveSrc\(suffix)"
        let destination = "MoveDst\(suffix)"

        try openBrowse(in: app)
        try createFolder(named: source, in: app)
        try createFolder(named: destination, in: app)

        // 1. Long-press the source row: the sheet has Move to…, and since core
        //    2.55.0 (zennotes#844) the core's prompt spells destinations the
        //    way the sidebar does: a folder of the notes area by its own path,
        //    with no inbox/ in front, so the same text works on an Inbox vault
        //    and on one whose notes live at the vault root.
        let sourceRow = try row(labelPrefix: source, in: app)
        sourceRow.press(forDuration: 0.8)
        let move = try button(label: "Move to…", in: app, failure: "the folder sheet has no Move to… row")
        attachScreenshot("folder sheet", of: app)
        move.tap()

        let target = promptField(placeholderSuffix: "(type a folder to change)", in: app)
        // The typed path filters the list and Move submits the typed value.
        waitUntilHittable(target, failure: "the Move prompt did not open")
        focusPromptField(target)
        app.typeText(destination)
        attachScreenshot("move prompt", of: app)
        try button(label: "Move", in: app, failure: "the Move prompt has no Move button").tap()

        // 2. The root listing lost the source; the destination holds it.
        XCTAssertTrue(sourceRow.waitForNonExistence(timeout: 10), "\(source) is still listed at the root after the move")
        try row(labelPrefix: destination, in: app).tap()
        _ = try row(labelPrefix: source, in: app, failure: "\(source) is not listed inside \(destination) after the move")
        attachScreenshot("moved folder inside destination", of: app)

        // 3. Back to the root and delete the fixture: the destination goes,
        //    and the moved folder inside it with it.
        try row(labelPrefix: "All notes", in: app, failure: "no back row to the root").tap()
        let destinationRow = try row(labelPrefix: destination, in: app)
        destinationRow.press(forDuration: 0.8)
        try button(label: "Delete", in: app, failure: "the folder sheet has no Delete row").tap()
        // The sheet unmounts while the confirm dialog paints, and SwipeRow keeps
        // its off-screen Delete actions in the DOM, so wait for a hittable one.
        try button(label: "Delete", in: app, failure: "no Delete confirmation").tap()
        XCTAssertTrue(destinationRow.waitForNonExistence(timeout: 10), "\(destination) is still listed after deleting it")
    }

    private func openBrowse(in app: XCUIApplication) throws {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()
        // The ensō menu's items are role=menuitem, so they are matched by any
        // type; and the open note can carry the same word (the welcome note's
        // "**Browse** — your folders" sits earlier in the tree than the menu),
        // so the match is the one that can take the tap, not the first one.
        try hittable(label: "Browse", in: app, failure: "the ensō menu did not open").tap()
    }

    /// "New folder" at the drawer's current directory.
    private func createFolder(named name: String, in app: XCUIApplication) throws {
        try row(labelPrefix: "New folder", in: app, failure: "no New folder row in Browse").tap()
        let field = promptField(placeholder: "Folder name", in: app)
        waitUntilHittable(field, failure: "the New folder prompt did not open")
        focusPromptField(field)
        app.typeText(name)
        try button(label: "Create", in: app, failure: "the New folder prompt has no Create button").tap()
        _ = try row(labelPrefix: name, in: app, failure: "created folder \(name) did not appear in Browse")
    }

    /// The core's PromptModal field is an unlabelled input; WebKit exposes its
    /// placeholder, which is what tells it apart from the drawer's search box.
    private func promptField(placeholder: String, in app: XCUIApplication) -> XCUIElement {
        app.textFields
            .matching(NSPredicate(format: "placeholderValue == %@ OR label == %@", placeholder, placeholder))
            .firstMatch
    }

    /// The Move prompt's placeholder opens with the notes root's name (the
    /// Inbox folder's, or "Vault root"), which depends on the vault, so only
    /// its fixed ending identifies the field.
    private func promptField(placeholderSuffix suffix: String, in app: XCUIApplication) -> XCUIElement {
        app.textFields
            .matching(NSPredicate(format: "placeholderValue ENDSWITH %@", suffix))
            .firstMatch
    }

    /// A prompt's field may arrive focused or not. PromptModal keeps touch
    /// pickers tap-first, but with core 2.52.0 to 2.60.0 the dialog shell
    /// (useDialogFocus) focused a panel's first control on open, so the Move
    /// prompt raised the keyboard itself and its sheet rose with it. A
    /// tap aimed at the field's frame from before that rise blurred the field
    /// again, and typing then had no target. So the field gets time to take
    /// focus on its own, and a tap only when it did not (a tap-first prompt,
    /// or a hardware keyboard keeping the software one down).
    private func focusPromptField(_ field: XCUIElement, timeout: TimeInterval = 2) {
        if waitForKeyboardFocus(field, timeout: timeout) { return }
        field.tap()
        XCTAssertTrue(waitForKeyboardFocus(field, timeout: 5), "the prompt field did not take keyboard focus")
    }

    private func waitForKeyboardFocus(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if (element.value(forKey: "hasKeyboardFocus") as? Bool) == true { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return false
    }

    /// Menus, sheets and dialogs animate in, and an element reports its final
    /// frame before it can take a tap there.
    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval = 10, failure: String) {
        let deadline = Date().addingTimeInterval(timeout)
        while !element.isHittable && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(element.isHittable, failure)
    }

    /// Kept on success too, so a run's xcresult shows what the sheet and the
    /// prompt looked like on that simulator.
    private func attachScreenshot(_ name: String, of app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Drawer rows carry a trailing chevron or pin glyph in their label, so
    /// they are matched by prefix. They live in the scroll area between the
    /// fixed "Search notes" button and the Settings footer, and WebKit's
    /// accessibility hit-test ignores overflow clipping: a row scrolled under
    /// the footer still reports hittable, and the tap lands on the footer
    /// (how "New folder" went missing once the vault held one more note). So
    /// the row's frame against that visible band decides, and the list is
    /// dragged toward the row, without momentum, until it is inside.
    private func row(labelPrefix: String, in app: XCUIApplication, failure: String? = nil) throws -> XCUIElement {
        try XCTUnwrap(visibleDrawerRow(labelPrefix: labelPrefix, in: app), failure ?? "drawer row for \(labelPrefix) not found")
    }

    private func visibleDrawerRow(labelPrefix: String, in app: XCUIApplication, timeout: TimeInterval = 10) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let band = drawerVisibleBand(in: app)
            let matches = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", labelPrefix))
            var offScreen: CGRect?
            for index in 0..<matches.count {
                let candidate = matches.element(boundBy: index)
                let frame = candidate.frame
                if frame.minY >= band.minY - 1 && frame.maxY <= band.maxY + 1 {
                    if candidate.isHittable {
                        return candidate
                    }
                } else if offScreen == nil {
                    offScreen = frame
                }
            }
            if let frame = offScreen {
                dragDrawerList(in: app, band: band, toward: frame)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        } while Date() < deadline
        return nil
    }

    /// The part of the drawer where rows can take a tap: below the fixed
    /// "Search notes" button, above the Settings footer, as wide as the panel.
    private func drawerVisibleBand(in app: XCUIApplication) -> CGRect {
        let window = app.windows.firstMatch.frame
        let search = app.buttons["Search notes"].firstMatch
        let settings = app.buttons["Settings"].firstMatch
        let top = search.exists ? search.frame.maxY : window.minY
        let bottom = settings.exists ? settings.frame.minY : window.maxY
        let width = search.exists ? search.frame.maxX : window.width * 0.8
        return CGRect(x: window.minX, y: top, width: width, height: max(bottom - top, 1))
    }

    /// One slow drag of about half the band, toward the row; a short hold at
    /// the end so the list does not coast past it. An empty frame (a row
    /// WebKit has not laid out) counts as below the fold, the common case.
    private func dragDrawerList(in app: XCUIApplication, band: CGRect, toward frame: CGRect) {
        let rowIsBelow = frame.isEmpty || frame.midY > band.midY
        let step = band.height * 0.45
        let x = band.midX
        let from = CGPoint(x: x, y: band.midY + (rowIsBelow ? step / 2 : -step / 2))
        let to = CGPoint(x: x, y: band.midY + (rowIsBelow ? -step / 2 : step / 2))
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: from.x, dy: from.y)).press(
            forDuration: 0.1,
            thenDragTo: origin.withOffset(CGVector(dx: to.x, dy: to.y)),
            withVelocity: .slow,
            thenHoldForDuration: 0.2
        )
    }

    private func button(label: String, in app: XCUIApplication, failure: String) throws -> XCUIElement {
        try XCTUnwrap(hittableMatch(NSPredicate(format: "label == %@", label), in: app), failure)
    }

    /// Any element type: for controls WebKit does not expose as buttons.
    private func hittable(label: String, in app: XCUIApplication, failure: String) throws -> XCUIElement {
        try XCTUnwrap(hittableMatch(NSPredicate(format: "label == %@", label), in: app, type: .any), failure)
    }

    /// Polls for an element that is on screen and tappable: sheets and dialogs
    /// mount a moment after the tap that opens them, and hidden matches (a
    /// SwipeRow's off-screen actions, note text under a backdrop) must not win.
    private func hittableMatch(
        _ predicate: NSPredicate,
        in app: XCUIApplication,
        type: XCUIElement.ElementType = .button,
        timeout: TimeInterval = 10
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let matches = app.descendants(matching: type).matching(predicate)
            for index in 0..<matches.count {
                let candidate = matches.element(boundBy: index)
                if !isUnderKeyboard(candidate, in: app) && candidate.isHittable {
                    return candidate
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        } while Date() < deadline
        return nil
    }

    /// A prompt's sheet rises above the software keyboard a moment after the
    /// keyboard does. Until then its footer sits under the keyboard, where
    /// XCUITest cannot compute a hit point and fails the test ("Activation
    /// point invalid") instead of answering false. Typing right after a tap on
    /// a tap-first field lands in that moment, so such a control counts as not
    /// tappable yet and the poll waits for the sheet to settle.
    private func isUnderKeyboard(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return false }
        return element.frame.maxY > keyboard.frame.minY
    }
}
