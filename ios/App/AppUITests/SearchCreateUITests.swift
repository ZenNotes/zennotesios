import XCTest

/// Core 2.54.0 gives note search a Create row for a name that matches no
/// note, and Enter or a tap on it swaps the results for a New note form
/// inside the same palette (zennotes#826). On the phone the palette is a
/// full-screen takeover with a shell-injected Cancel at its top right
/// (mobile.css), the corner where the form's header puts its destination
/// label ("in Inbox"). Until 1.12.0 the two overlapped: Cancel was drawn
/// across the faded label. The header now ends before Cancel begins.
///
/// The test opens the form for a name no vault holds, requires the label
/// and Cancel to occupy separate space, and leaves through Cancel, so no
/// note is written to the simulator's vault.
final class SearchCreateUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testNewNoteFormHeaderLeavesRoomForCancel() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        guard app.windows.firstMatch.frame.width < 768 else {
            throw XCTSkip("phone shell only: the iPad shows the desktop palette card, which has no injected Cancel")
        }

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()
        try hittable(label: "Search", in: app, failure: "the ensō menu did not open").tap()

        let search = app.textFields
            .matching(NSPredicate(format: "placeholderValue BEGINSWITH 'Search notes'"))
            .firstMatch
        waitUntilHittable(search, failure: "the search palette did not open")
        search.tap()
        let name = "Create row check \(Int(Date().timeIntervalSince1970) % 1_000_000)"
        app.typeText(name)

        let createRow = try XCTUnwrap(
            hittableMatch(NSPredicate(format: "label BEGINSWITH %@", "Create \"\(name)\""), in: app),
            "no Create row for a name that matches no note"
        )
        createRow.tap()

        let heading = app.staticTexts["New note"]
        XCTAssertTrue(heading.waitForExistence(timeout: 5), "the New note form did not open")
        let cancel = try button(label: "Cancel", in: app, failure: "the shell did not inject Cancel into the form")
        // The label reads "in <folder>" and sits on the heading's row; the
        // status line under the fields also names the folder, but as part
        // of a longer sentence, so the prefix and the row tell them apart.
        let destination = try XCTUnwrap(
            staticText(prefix: "in ", onRowOf: heading, in: app),
            "the form header names no destination"
        )
        attachScreenshot("search-create-form", of: app)

        let labelFrame = destination.frame
        let cancelFrame = cancel.frame
        XCTAssertFalse(
            labelFrame.intersects(cancelFrame),
            "the destination label \(labelFrame) runs under Cancel \(cancelFrame)"
        )
        XCTAssertLessThanOrEqual(
            labelFrame.maxX, cancelFrame.minX,
            "the destination label \(labelFrame) ends after Cancel \(cancelFrame) begins"
        )

        // Focus returns to the editor with the keyboard still up, and the
        // ensō hides under a raised keyboard, so the form's own elements are
        // the honest signal that the palette closed, not "Open menu".
        cancel.tap()
        waitUntilGone(heading, failure: "Cancel did not close the palette: the New note heading is still there")
        XCTAssertFalse(cancel.exists, "Cancel outlived the palette it belongs to")
    }

    /// Core 2.54.0 lost the first tap on Create while a tag was still typed
    /// in the Tags field: the button took focus, the field blurred and
    /// committed the word as a chip, the suggestion row under the fields
    /// went away and the footer moved before the tap completed (found on
    /// this shell, fixed in core 2.54.1). One tap must create the note.
    /// This test writes one note into the simulator's vault.
    func testFirstTapOnCreateLandsWhileATagIsTyped() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()
        try hittable(label: "Search", in: app, failure: "the ensō menu did not open").tap()

        let search = app.textFields
            .matching(NSPredicate(format: "placeholderValue BEGINSWITH 'Search notes'"))
            .firstMatch
        waitUntilHittable(search, failure: "the search palette did not open")
        search.tap()
        // The suffix keeps the name and the tag new on every run: the note
        // stays in the simulator's vault, and a tag it already holds would be
        // offered as an existing tag rather than a new one.
        let suffix = Int(Date().timeIntervalSince1970) % 1_000_000
        let name = "Tag tap check \(suffix)"
        let tag = "tap\(suffix)"
        app.typeText(name)
        try XCTUnwrap(
            hittableMatch(NSPredicate(format: "label BEGINSWITH %@", "Create \"\(name)\""), in: app),
            "no Create row for a name that matches no note"
        ).tap()

        let heading = app.staticTexts["New note"]
        XCTAssertTrue(heading.waitForExistence(timeout: 5), "the New note form did not open")
        let tags = app.textFields
            .matching(NSPredicate(format: "placeholderValue BEGINSWITH 'Add tags'"))
            .firstMatch
        waitUntilHittable(tags, failure: "the form has no Tags field")
        tags.tap()
        app.typeText(tag)
        // The word is still text, not a chip: the row offering it as a new
        // tag is what the blur used to take away.
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Add #\(tag)")).firstMatch
                .waitForExistence(timeout: 5),
            "typing in Tags did not offer the word as a new tag"
        )

        let create = try button(label: "Create", in: app, failure: "the form's Create button is not on screen")
        attachScreenshot("search-create-typed-tag", of: app)
        create.tap()
        waitUntilGone(heading, failure: "one tap on Create left the form open: the typed tag took the tap")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "#\(tag)")).firstMatch
                .waitForExistence(timeout: 5),
            "the created note does not show the #\(tag) tag"
        )
        attachScreenshot("search-create-note-open", of: app)
    }

    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval = 5, failure: String) {
        let deadline = Date().addingTimeInterval(timeout)
        while element.exists && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertFalse(element.exists, failure)
    }

    /// The static text with the given prefix whose vertical centre lies in
    /// the row of `anchor`. WebKit exposes the whole document, including
    /// text under the palette, so the row is what pins the header's label.
    private func staticText(prefix: String, onRowOf anchor: XCUIElement, in app: XCUIApplication) -> XCUIElement? {
        let row = anchor.frame
        let matches = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
        for index in 0..<matches.count {
            let candidate = matches.element(boundBy: index)
            let frame = candidate.frame
            if frame.midY >= row.minY && frame.midY <= row.maxY {
                return candidate
            }
        }
        return nil
    }

    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval = 10, failure: String) {
        let deadline = Date().addingTimeInterval(timeout)
        while !element.isHittable && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertTrue(element.isHittable, failure)
    }

    /// Kept on success too, so a run's xcresult shows the form on that simulator.
    private func attachScreenshot(_ name: String, of app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func button(label: String, in app: XCUIApplication, failure: String) throws -> XCUIElement {
        try XCTUnwrap(hittableMatch(NSPredicate(format: "label == %@", label), in: app), failure)
    }

    /// Any element type: the ensō menu's items are role=menuitem, and the
    /// open note can carry the same word earlier in the tree.
    private func hittable(label: String, in app: XCUIApplication, failure: String) throws -> XCUIElement {
        try XCTUnwrap(hittableMatch(NSPredicate(format: "label == %@", label), in: app, type: .any), failure)
    }

    /// Polls for an element that is on screen and tappable: the palette and
    /// the form mount a moment after the tap that opens them, and hidden
    /// matches (note text under the palette) must not win.
    private func hittableMatch(
        _ predicate: NSPredicate,
        in app: XCUIApplication,
        type: XCUIElement.ElementType = .button,
        timeout: TimeInterval = 10
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let matches = app.descendants(matching: type).matching(predicate)
            for index in 0..<matches.count where matches.element(boundBy: index).isHittable {
                return matches.element(boundBy: index)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        } while Date() < deadline
        return nil
    }
}
