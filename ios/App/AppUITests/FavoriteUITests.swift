import XCTest

/// Favorites are the vault's list (vault.json): the section Home and the
/// desktop sidebar show. Until #810 a phone could not add to it, because the
/// only routes were the desktop sidebar's context menu and a Vim leader
/// chord, so the Home Favorites section stayed empty on the iPhone. The •••
/// sheet (Open menu → More) and the long-press note menu now carry
/// "Add to Favorites" / "Remove from Favorites", and toggling through one
/// flips what the other shows, because both read the same shell snapshot.
///
/// The test opens a fresh inbox note through `zennotes://new` (the widget
/// link, same as DeepLinkUITests) so it never depends on which notes the
/// simulator's vault holds, favorites it from the ••• sheet, checks the
/// long-press menu on the drawer row sees that state and removes it again,
/// then trashes the note it made.
final class FavoriteUITests: XCTestCase {
    private let newNoteLink = URL(string: "zennotes://new")!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let stale = springboard.buttons["Cancel"]
        if stale.exists {
            stale.tap()
        }
    }

    private var springboard: XCUIApplication {
        XCUIApplication(bundleIdentifier: "com.apple.springboard")
    }

    func testMoreSheetAndLongPressMenuToggleFavorite() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        guard app.windows.firstMatch.frame.width < 768 else {
            throw XCTSkip("phone shell only: the iPad runs the desktop layout with the sidebar's context menu")
        }

        open(newNoteLink)
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        let noteName = try XCTUnwrap(waitForOpenNoteName(in: app, timeout: 20), "no note title field after zennotes://new")
        putKeyboardAway(in: app)

        // 1. ••• sheet on the open note: Add, then the label flips to Remove.
        openMoreSheet(in: app)
        let add = element(label: "Add to Favorites", in: app)
        XCTAssertTrue(add.waitForExistence(timeout: 5), "the ••• sheet has no Add to Favorites row")
        add.tap()

        openMoreSheet(in: app)
        let remove = element(label: "Remove from Favorites", in: app)
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "the ••• sheet did not flip to Remove from Favorites")
        dismissSheet(in: app)

        // 2. Long-press menu on the drawer row sees the same state and undoes it.
        openBrowse(in: app)
        let row = hittableButton(label: noteName, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "drawer row for \(noteName) not found")
        scrollUntilHittable(row, in: app)
        row.press(forDuration: 0.8)
        let removeFromRow = element(label: "Remove from Favorites", in: app)
        XCTAssertTrue(removeFromRow.waitForExistence(timeout: 5), "the long-press menu has no Remove from Favorites row")
        removeFromRow.tap()

        row.press(forDuration: 0.8)
        let addFromRow = element(label: "Add to Favorites", in: app)
        XCTAssertTrue(addFromRow.waitForExistence(timeout: 5), "the long-press menu did not flip back to Add to Favorites")
        dismissSheet(in: app)
        closeDrawer(in: app)

        // 3. ••• sheet agrees, and cleans up the note this test created.
        openMoreSheet(in: app)
        XCTAssertTrue(element(label: "Add to Favorites", in: app).waitForExistence(timeout: 5), "the ••• sheet did not follow the long-press removal")
        let delete = element(label: "Delete", in: app)
        XCTAssertTrue(delete.exists)
        delete.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Move to'")).firstMatch
        if confirm.waitForExistence(timeout: 3) {
            confirm.tap()
        }
    }

    /// Opens the link the way a widget tap does; the simulator may first ask
    /// "Open in ZenNotes?", which a real widget tap never does.
    private func open(_ url: URL) {
        XCUIDevice.shared.system.open(url)
        let confirm = springboard.buttons["Open"]
        if confirm.waitForExistence(timeout: 3) {
            confirm.tap()
        }
    }

    /// The phone title field is labelled "Untitled" and carries the note's
    /// name as its value ("Untitled", "Untitled 3", ...).
    private func waitForOpenNoteName(in app: XCUIApplication, timeout: TimeInterval) -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for field in app.textFields.allElementsBoundByIndex {
                if let value = field.value as? String, value.hasPrefix("Untitled") {
                    return value
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return nil
    }

    private func openMoreSheet(in app: XCUIApplication) {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        // The keyboard must be down here: with it up the ensō button is
        // display:none, and a dismiss that left DOM focus in the editor
        // brought the keyboard back on this very tap (the bug this test
        // caught). Assert both sides of that so a regression names itself.
        XCTAssertEqual(app.keyboards.count, 0, "keyboard still up before tapping the ensō button")
        openMenu.tap()
        let more = element(label: "More", in: app)
        XCTAssertTrue(
            more.waitForExistence(timeout: 5),
            "the ensō menu did not open (keyboards=\(app.keyboards.count))"
        )
        more.tap()
    }

    private func openBrowse(in app: XCUIApplication) {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()
        let browse = element(label: "Browse", in: app)
        XCTAssertTrue(browse.waitForExistence(timeout: 5))
        browse.tap()
    }

    /// A fresh note opens with its title focused and the keyboard up, and the
    /// ensō hides for as long as the keyboard shows (mobile.css `.zn-kb-open`).
    /// The title field has no dismiss control; the editor's formatting toolbar
    /// does, so Return first moves focus into the body (the title's Enter
    /// behaviour), then the toolbar's button puts the keyboard away. A
    /// simulator with a hardware keyboard attached never raised it, so the
    /// ensō is already there and nothing needs doing.
    private func putKeyboardAway(in app: XCUIApplication) {
        let openMenu = app.buttons["Open menu"]
        if openMenu.waitForExistence(timeout: 2) {
            return
        }
        let dismiss = app.buttons["Dismiss keyboard"]
        if !dismiss.exists {
            app.typeText("\n")
        }
        XCTAssertTrue(dismiss.waitForExistence(timeout: 5), "no Dismiss keyboard button: the editor toolbar did not come up")
        dismiss.tap()
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5), "the ensō stayed hidden: the keyboard did not go away")
    }

    /// Bottom sheets close on a tap on their backdrop, which covers the top
    /// of the screen.
    private func dismissSheet(in app: XCUIApplication) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
    }

    /// The drawer is a left panel at most 330pt wide; its backdrop is the
    /// strip to its right, so the tap that closes it goes near the right edge.
    private func closeDrawer(in app: XCUIApplication) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
    }

    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 where !element.isHittable {
            app.swipeUp()
        }
    }

    private func element(label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label))
            .firstMatch
    }

    private func hittableButton(label: String, in app: XCUIApplication) -> XCUIElement {
        let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
        for index in 0..<matches.count {
            let candidate = matches.element(boundBy: index)
            if candidate.isHittable {
                return candidate
            }
        }
        return matches.element(boundBy: max(matches.count - 1, 0))
    }
}
